// AGO WORLD BOX のプレイヤーバイタル（純粋ロジック、DOM 非依存）。
// 空腹と食事バフの規則はここに集約し、保存は呼び出し側（API ルート）が
// profile（bot_kv worldbox_profiles）に対して行う。
// 状態そのものは PlayerProfile の hunger / status / vitalAt 等に載る。
// - 空腹は時間で減る（放置では満腹から空まで約4時間。移動・ダッシュでは
//   少し速くなる。活動クラスはサーバー側が位置変化の平均速度から判定する）
// - 食事で空腹が回復し、温かい食事は一定時間 空腹の減りを緩やかにする
// 割合・間隔などの数値はユーザー向けに開示しない（探索優先の原則）。
import { ITEMS, itemById } from "../economy/items";
import {
  HUNGER_MAX, type PlayerProfile, type StatusEffect,
} from "./profile";


/** 空腹の活動クラス（サーバー側が位置変化の平均速度から判定する）。 */
export type HungerActivity = "idle" | "move" | "dash";
/** 放置中の空腹の減少（/秒）。満腹 100 → 0 まで約4時間。 */
export const HUNGER_DRAIN_IDLE_PER_SEC = 100 / 14400;
/** 移動中の空腹の減少倍率（対 放置）。 */
export const HUNGER_MOVE_MULT = 1.6;
/** ダッシュ中の空腹の減少倍率（対 放置）。 */
export const HUNGER_DASH_MULT = 2.5;

/** 活動クラスの空腹の減少（/秒）。 */
export function hungerDrainPerSec(activity: HungerActivity): number {
  if (activity === "dash") return HUNGER_DRAIN_IDLE_PER_SEC * HUNGER_DASH_MULT;
  if (activity === "move") return HUNGER_DRAIN_IDLE_PER_SEC * HUNGER_MOVE_MULT;
  return HUNGER_DRAIN_IDLE_PER_SEC;
}

/**
 * 活動判定に使う平均速度の上限（タイル/秒）。歩行 4.4 / 泳ぎ 3.0 /
 * ダッシュ泳 5.4 / ダッシュ 7.0 が根拠で、テレポート等の跳びは
 * この速度で頭打ちにして過大評価しない。
 */
export const ACTIVITY_SPEED_CAP = 7;
/** この平均速度未満は放置（idle）。 */
export const ACTIVITY_IDLE_MAX_SPEED = 0.3;
/** この平均速度以上はダッシュ（dash）。未満は移動（move）。 */
export const ACTIVITY_DASH_MIN_SPEED = 5.6;

/** 平均速度（タイル/秒）から活動クラスを決める。 */
export function classifyActivity(avgSpeed: number): HungerActivity {
  if (!Number.isFinite(avgSpeed)) return "idle";
  const s = Math.min(Math.max(0, avgSpeed), ACTIVITY_SPEED_CAP);
  if (s < ACTIVITY_IDLE_MAX_SPEED) return "idle";
  if (s < ACTIVITY_DASH_MIN_SPEED) return "move";
  return "dash";
}

/**
 * 精算窓の活動クラス: 前回精算位置と現在位置の平均速度で決める。
 * 前回位置が無い・空間が変わった・現在位置が不明・窓が無い場合は idle
 * （空間が変わった窓は移動として数えない）。
 */
export function activityForWindow(
  prev: { x: number; y: number; space: string } | null,
  cur: { x: number; y: number; space: string } | null,
  elapsedSec: number,
): HungerActivity {
  if (!prev || !cur || prev.space !== cur.space || !(elapsedSec > 0)) return "idle";
  return classifyActivity(Math.hypot(cur.x - prev.x, cur.y - prev.y) / elapsedSec);
}
/** バイタル精算で進める時間の上限（ミリ秒）。長期離脱で空腹が一気に尽きないよう頭打ちにする。 */
export const VITAL_SETTLE_CAP_MS = 30 * 60 * 1000;

function statusOf(profile: PlayerProfile): StatusEffect[] {
  return Array.isArray(profile.status) ? profile.status : [];
}

/**
 * 持続効果（バフ）の長さ。定義の正はアイテム側（ItemDef.buff.minutes）で、
 * ここは種類ごとの代表アイテムから導出するだけ（二重定義にしない）。
 * バフ持ちアイテムが無い種類は従来値にフォールバックする。
 */
function buffDurationFromCatalog(kind: "warm", fallbackMinutes: number): number {
  const def = ITEMS.find((i) => i.buff?.kind === kind);
  return (def?.buff?.minutes ?? fallbackMinutes) * 60 * 1000;
}
export const BUFF_DURATION_MS: Record<"warm", number> = {
  warm: buffDurationFromCatalog("warm", 10),
};
/** warm の間、空腹の減りがこの倍率になる。 */
export const WARM_HUNGER_MULT = 0.6;

/** バフを付ける（同種は付け直し）。 */
export function applyBuff(
  profile: PlayerProfile,
  kind: "warm",
  now: number,
): PlayerProfile {
  const status = statusOf(profile).filter((e) => e.kind !== kind);
  status.push({ kind, until: now + BUFF_DURATION_MS[kind] });
  return { ...profile, status };
}

/**
 * バフが精算窓 [vitalAt, windowEnd] と重なる区間（窓起点からの秒）。
 * 重なりが無ければ null。windowEnd は精算キャップ後の窓の終端。
 */
function buffWindowSec(
  profile: PlayerProfile,
  kind: "warm",
  windowEnd: number,
): { startSec: number; endSec: number } | null {
  const e = statusOf(profile).find((x) => x.kind === kind);
  if (!e) return null;
  const start = Math.max(profile.vitalAt, e.until - BUFF_DURATION_MS[kind]);
  const end = Math.min(e.until, windowEnd);
  if (end <= start) return null;
  return { startSec: (start - profile.vitalAt) / 1000, endSec: (end - profile.vitalAt) / 1000 };
}

/**
 * バイタルを now まで精算する: 空腹の減少（活動クラスと warm バフで
 * レートが変わる）と、期限切れバフの掃除。
 * vitalAt が 0（未精算）なら now を起点にするだけ。精算で進める時間は
 * VITAL_SETTLE_CAP_MS で頭打ちにする。
 */
export function stepVitals(
  profile: PlayerProfile,
  now: number,
  activity: HungerActivity = "idle",
): { profile: PlayerProfile } {
  if (profile.vitalAt <= 0 || now <= profile.vitalAt) {
    return { profile: { ...profile, vitalAt: now } };
  }
  const elapsedMs = Math.min(now - profile.vitalAt, VITAL_SETTLE_CAP_MS);
  const elapsedSec = elapsedMs / 1000;
  const windowEnd = profile.vitalAt + elapsedMs;
  // 空腹の減少。レートは活動クラスで変わり、warm（温かい食事）の間は
  // さらに緩やかになるため、warm 区間だけ倍率を分けて積算する。
  const rate = hungerDrainPerSec(activity);
  const warmWin = buffWindowSec(profile, "warm", windowEnd);
  const warmSec = warmWin ? warmWin.endSec - warmWin.startSec : 0;
  const drainSec = elapsedSec - warmSec + warmSec * WARM_HUNGER_MULT;
  const hunger = Math.max(0, profile.hunger - rate * drainSec);
  const status = statusOf(profile).filter((e) => e.until > now);
  // 空腹は端数を保持する（profile.ts の clampVital と同じ理由）。
  // 精算ごとに整数化すると、放置の空腹減少（15秒で約0.1）が毎回 -1 に
  // 化けて約25分で空になり、活動倍率の差も消える。
  return {
    profile: { ...profile, hunger: Math.round(hunger * 1000) / 1000, status, vitalAt: now },
  };
}

/**
 * 食事の効果を適用する（消費はしない。消費は economy.eatItem が担い、
 * 効果の数式はここを正とする）。hunger / buff を持つアイテムが対象で、
 * それ以外は null。
 */
export function consumeEffect(
  profile: PlayerProfile,
  itemId: string,
  now: number = Date.now(),
): { profile: PlayerProfile; hungerGain: number } | null {
  const item = itemById(itemId);
  if (!item || (!item.hunger && !item.buff)) return null;
  let next = profile;
  const hungerGain = item.hunger ? Math.min(HUNGER_MAX, next.hunger + item.hunger) - next.hunger : 0;
  next = { ...next, hunger: next.hunger + hungerGain };
  if (item.buff) next = applyBuff(next, item.buff.kind, now);
  return { profile: next, hungerGain };
}
