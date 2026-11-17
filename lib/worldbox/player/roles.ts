// AGO WORLD BOX の冒険役職（純粋ロジック）。
// 国の役職（Discord 権限が決める）とは無関係に本人が選ぶ「職業」。
// 効果は常時効果1つ＋専門行為1つだけ。成長軸は役職ごとの熟練ランク 1〜5。
// 技はダブルクリック/ダブルタップの単一ジェスチャで発動する（ボタンは置かない）。
// 現在の技はテレポーターのポーター設置（移動支援）のみ。
import type { PlayerProfile, AdventureRoleId } from "./profile";
import { isAdventureRoleId, ADVENTURE_ROLE_IDS } from "./profile";
export type { AdventureRoleId } from "./profile";
export { isAdventureRoleId, ADVENTURE_ROLE_IDS };
import type { SkillFxKind } from "../media/fx";

/** スキル演出プリセット（fx.ts の SkillFxKind と対応）。 */
export type SkillId = "porter";

export type SkillDef = {
  id: SkillId;
  name: string;
  /** 演出プリセット名（fx.ts）。 */
  fx: SkillFxKind;
  minRank: number;
  cooldownMs: number;
  /** 効果半径（タイル）。0 は単体/自己。 */
  radius: number;
  /** 効果量（設置系では未使用）。 */
  power: number;
};

export const SKILLS: Record<SkillId, SkillDef> = {
  porter: {
    id: "porter",
    name: "ポーター設置",
    fx: "warp",
    minRank: 1,
    cooldownMs: 30_000,
    radius: 0,
    power: 0,
  },
};

export type AdventureRoleDef = {
  id: AdventureRoleId;
  name: string;
  /** ネームプレート等で使う短い記号（絵文字は使わない）。 */
  symbol: string;
  passiveName: string;
  specialtyName: string;
  /** ダブルタップ技（ランクで上位に置き換わるものは上位が優先）。 */
  skills: readonly SkillId[];
};

export const ADVENTURE_ROLES: Record<AdventureRoleId, AdventureRoleDef> = {
  free: {
    id: "free",
    name: "自由人",
    symbol: "—",
    passiveName: "なし",
    specialtyName: "なし",
    skills: [],
  },
  blade: {
    id: "blade",
    name: "剣士",
    symbol: "剣",
    passiveName: "剣の攻撃上昇",
    specialtyName: "大振り",
    skills: [],
  },
  guard: {
    id: "guard",
    name: "守護",
    symbol: "盾",
    passiveName: "最大HP上昇・味方を守る",
    specialtyName: "挑発",
    skills: [],
  },
  scout: {
    id: "scout",
    name: "斥候",
    symbol: "斥",
    passiveName: "移動スタミナ節約",
    specialtyName: "罠の探知",
    skills: [],
  },
  miner: {
    id: "miner",
    name: "採掘者",
    symbol: "採",
    passiveName: "鉱脈の追加ドロップ",
    specialtyName: "鉱脈探知",
    skills: [],
  },
  medic: {
    id: "medic",
    name: "薬師",
    symbol: "薬",
    passiveName: "回復アイテム強化",
    specialtyName: "蘇生",
    skills: [],
  },
  teleporter: {
    id: "teleporter",
    name: "テレポーター",
    symbol: "ポ",
    passiveName: "ポーター設置",
    specialtyName: "ポーター設置",
    skills: ["porter"],
  },
};

export function roleById(id: unknown): AdventureRoleDef {
  return isAdventureRoleId(id) ? ADVENTURE_ROLES[id] : ADVENTURE_ROLES.free;
}

// ---------------------------------------------------------------- 熟練
/** ランク到達に必要な累計 XP（ランク1は 0）。閾値はユーザー向けに開示しない。 */
export const MASTERY_THRESHOLDS: readonly number[] = [0, 30, 80, 160, 300];
export const MASTERY_MAX_RANK = 5;

export function rankForXp(xp: number): number {
  let rank = 1;
  for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
    if (xp >= MASTERY_THRESHOLDS[i]) rank = i + 1;
  }
  return Math.min(MASTERY_MAX_RANK, rank);
}

export function masteryRankOf(profile: PlayerProfile, role: AdventureRoleId): number {
  return rankForXp(profile.mastery[role]?.xp ?? 0);
}

/** 熟練 XP を足す。ランクが上がったら rankUp=true。 */
export function addMasteryXp(
  profile: PlayerProfile,
  role: AdventureRoleId,
  amount: number,
): { profile: PlayerProfile; rankUp: boolean } {
  if (role === "free" || amount <= 0) return { profile, rankUp: false };
  const before = masteryRankOf(profile, role);
  const xp = (profile.mastery[role]?.xp ?? 0) + amount;
  const next: PlayerProfile = {
    ...profile,
    mastery: { ...profile.mastery, [role]: { xp } },
  };
  return { profile: next, rankUp: rankForXp(xp) > before };
}

// ---------------------------------------------------------------- 常時効果
/** 採掘者の追加ドロップ抽選確率。 */
export const MINER_BONUS_CHANCE = 0.3;
/** 斥候の移動スタミナ消費倍率。 */
export const SCOUT_STAMINA_MULT = 0.8;

// ---------------------------------------------------------------- 技
/** その役職・ランクでダブルタップ発動できる技（上位ランクで置き換わる分は最上位のみ）。 */
export function activeSkillFor(profile: PlayerProfile): SkillDef | null {
  const def = roleById(profile.role);
  const rank = masteryRankOf(profile, profile.role);
  let best: SkillDef | null = null;
  for (const id of def.skills) {
    const skill = SKILLS[id];
    if (id === "porter") continue; // ポーター設置はダブルタップ地点への設置専用（戦闘技として返さない）
    if (rank >= skill.minRank) best = skill;
  }
  return best;
}

/** クールタイム中かと残りミリ秒。 */
export function skillCooldownLeft(profile: PlayerProfile, skillId: SkillId, now: number): number {
  const at = profile.skillAt[skillId] ?? 0;
  return Math.max(0, at + SKILLS[skillId].cooldownMs - now);
}

// ---------------------------------------------------------------- 転職コスト
/** 転職（2回目以降の役職変更）の価格（アゴコイン）。 */
export const ROLE_CHANGE_COST = 100_000;
/** 転職の spend オプの理由（ブリッジの spend は理由ホワイトリストを持たない）。 */
export const ROLE_CHANGE_REASON = "role_change";

/**
 * その変更に掛かるコイン。初めての役職選択は無料、同じ役職の再選択は
 * 無料（no-op）。一度でも選んだことがある人（rolePicked、または旧データで
 * 既に free でない役職を持っている人）の変更は ROLE_CHANGE_COST。
 */
export function roleChangeCost(profile: PlayerProfile, nextRole: AdventureRoleId): number {
  if (nextRole === profile.role) return 0;
  const picked = profile.rolePicked === true || profile.role !== "free";
  return picked ? ROLE_CHANGE_COST : 0;
}

/** 役職変更の遷移（コスト計算込み）。変更したら rolePicked を立てる。 */
export function applyRoleChange(
  profile: PlayerProfile,
  nextRole: AdventureRoleId,
): { profile: PlayerProfile; cost: number } {
  const cost = roleChangeCost(profile, nextRole);
  if (nextRole === profile.role) return { profile, cost: 0 };
  return { profile: { ...profile, role: nextRole, rolePicked: true }, cost };
}
