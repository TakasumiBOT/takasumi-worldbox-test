import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { MAP_SEED, tileAt } from "@/lib/worldbox/world/mapgen";
import { isProfileEnabled, loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { type PlayerProfile } from "@/lib/worldbox/player/profile";
import { listPresence } from "@/lib/worldbox/player/presence-online";
import { presenceIdFor } from "@/lib/worldbox/player/presence";
import { parseSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave } from "@/lib/worldbox/core/save-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";
import {
  activeSkillFor, addMasteryXp, applyRoleChange, isAdventureRoleId, masteryRankOf,
  ROLE_CHANGE_REASON, skillCooldownLeft, SKILLS, type SkillId,
} from "@/lib/worldbox/player/roles";
import { isNationsEnabled, loadNationsState } from "@/lib/worldbox/social/nations-online";
import { porterInRange, porterTileError } from "@/lib/worldbox/world/warp";
import { storePorter } from "@/lib/worldbox/world/warp-online";
import { isOverrideActive } from "@/lib/worldbox/world/tiles";
import { loadTileOverride } from "@/lib/worldbox/world/tiles-online";
import { buildEconomyOp } from "@/lib/worldbox/economy/economy-bridge";
import {
  isEconomyEnabled, readUserBalance, submitEconomyOp, waitForOpDone,
} from "@/lib/worldbox/economy/economy-bridge-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { parseInstanceSpace } from "@/lib/worldbox/world/instances";

export const runtime = "nodejs";

// AGO WORLD BOX の冒険役職。
// POST { action: "set_role", role }: ギルドボード前でのみ変更可（インスタンス内は不可）。
//   初めての選択は無料、それ以降の変更は 100,000 コイン（spend role_change、
//   残高不足は 409 not_enough_coins で役職は変わらない）。
// POST { action: "skill", skill, tx, ty, space, px, py }: ダブルタップ技。
//   役職・ランク・クールタイム・対象はすべてサーバーが再計算して検証する。
//   現在の技はテレポーターの porter（ポーター設置）のみで、ダブルタップ
//   地点へのユニオンポーター設置として分岐する（利用は /api/worldbox/warp）。
// GET: 自分の役職情報。

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function err(error: string, status = 409) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function actorPos(ownerKey: string, space: string, reported: { x: number; y: number } | null) {
  const selfId = presenceIdFor(ownerKey);
  const entries = await listPresence();
  const now = Date.now();
  const entry = entries.find((e) => e.id === selfId && e.space === space && now - e.ts <= 15_000);
  if (entry) return { x: entry.x, y: entry.y };
  if (reported) return reported;
  const saved = parseSave(await loadWorldBoxSave(ownerKey));
  if (saved && saved.space === space) return { x: saved.x, y: saved.y };
  return null;
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isProfileEnabled()) return err("roles_unavailable", 503);
  const ownerKey = sessionOwnerKey(session);
  const profile = await loadProfile(ownerKey);
  if (!profile) return err("roles_unavailable", 503);
  // テレポーターの発動技はポーター設置（activeSkillFor は設置技として返さない）
  const skill = profile.role === "teleporter" ? SKILLS.porter : activeSkillFor(profile);
  return NextResponse.json(
    {
      role: profile.role,
      rank: masteryRankOf(profile, profile.role),
      mastery: profile.mastery,
      skill: skill ? { ...skill, cooldownLeftMs: skillCooldownLeft(profile, skill.id, Date.now()) } : null,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isProfileEnabled()) return err("roles_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid_request", 400);
  }
  const fields = (body ?? {}) as {
    action?: unknown; role?: unknown; skill?: unknown;
    tx?: unknown; ty?: unknown; space?: unknown; px?: unknown; py?: unknown;
  };
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();
  const profile = await loadProfile(ownerKey);
  if (!profile) return err("roles_unavailable", 503);

  if (fields.action === "set_role") {
    if (!isAdventureRoleId(fields.role)) return err("invalid_request", 400);
    const saved = parseSave(await loadWorldBoxSave(ownerKey));
    if (saved && parseInstanceSpace(saved.space)) return err("in_instance", 409);
    if ((await loadMyLobbyStation(ownerKey)) !== "guild") return err("not_at_guild_board", 409);
    const targetRole = fields.role;
    // 転職は課金を伴うため、プロフィールの RMW とオプ登録をユーザー単位
    // ロックで直列化し、ロック内で読み直してから判定する。
    return withUserLock(ownerKey, async () => {
      const current = await loadProfile(ownerKey);
      if (!current) return err("roles_unavailable", 503);
      const { profile: next, cost } = applyRoleChange(current, targetRole);
      if (cost <= 0) {
        if (!(await storeProfile(ownerKey, next))) return err("store_failed", 503);
        return NextResponse.json({ ok: true, profile: next, cost: 0 }, { headers: NO_STORE });
      }
      // 課金: 残高を確認し、プロフィールを先に保存してから spend オプを積む。
      // オプを積めなければプロフィールを戻す（購入フローと同じ原子性）。
      const discordId = session.provider === "discord" ? session.id : null;
      if (!discordId) return err("discord_required", 403);
      if (!isEconomyEnabled()) return err("economy_unavailable", 503);
      const balance = await readUserBalance(discordId);
      if (balance === null) return err("economy_unavailable", 503);
      if (balance < cost) return err("not_enough_coins", 409);
      const op = buildEconomyOp(
        { kind: "spend", userKey: ownerKey, discordId, amount: cost, reason: ROLE_CHANGE_REASON },
        crypto.randomUUID(),
        Date.now(),
      );
      if (!op) return err("economy_failed", 503);
      if (!(await storeProfile(ownerKey, next))) return err("store_failed", 503);
      // 提出は直接適用が正（submitEconomyOp）: spend はその場で終端する。
      // 直接適用できずキューへ寄せた（pending）ときだけ従来どおり待つ。
      const submitted = await submitEconomyOp(op);
      if (submitted.state === "unavailable") {
        await storeProfile(ownerKey, current);
        return err("economy_failed", 503);
      }
      // 決済が failed になったら役職を元へ戻す（構造問題#4「即時 spend
      // の無担保交付」の是正: 役職だけ変わって課金されない状態を
      // 作らない）。pending のままなら従来どおり返し、クライアントの
      // ポーリングに引き継ぐ。
      const settled = submitted.state === "pending" ? await waitForOpDone(ownerKey, op.id) : submitted.op;
      if (settled && settled.status === "failed") {
        await storeProfile(ownerKey, current);
        return err("economy_failed", 409);
      }
      return NextResponse.json({ ok: true, profile: next, cost }, { headers: NO_STORE });
    });
  }

  const space = typeof fields.space === "string" ? fields.space : "world";
  const reported =
    typeof fields.px === "number" && typeof fields.py === "number" && Number.isFinite(fields.px) && Number.isFinite(fields.py)
      ? { x: fields.px, y: fields.py }
      : null;
  const pos = await actorPos(ownerKey, space, reported);
  if (!pos) return err("position_unknown", 409);

  if (fields.action === "skill") {
    // 技は自分のプロフィール（skillAt・熟練）を書き換えるため、ユーザー
    // 単位ロックで直列化し、ロック内で読み直したプロフィールで検証・
    // 適用する（set_role と同じ型）。
    return withUserLock(ownerKey, async () => {
      const profile = await loadProfile(ownerKey);
      if (!profile) return err("roles_unavailable", 503);
      const skillId = typeof fields.skill === "string" ? (fields.skill as SkillId) : null;
      if (!skillId || !(skillId in SKILLS)) return err("invalid_request", 400);
      const skill = SKILLS[skillId];
      const rank = masteryRankOf(profile, profile.role);
      // 現在の技はテレポーターのポーター設置のみ（設置専用）。
      const isPorter = skillId === "porter" && profile.role === "teleporter";
      if (!isPorter) return err("skill_locked", 409);
      if (rank < SKILLS.porter.minRank) return err("skill_locked", 409);
      if (skillCooldownLeft(profile, skillId, now) > 0) return err("cooldown", 409);

      const tx = typeof fields.tx === "number" && Number.isFinite(fields.tx) ? fields.tx : pos.x;
      const ty = typeof fields.ty === "number" && Number.isFinite(fields.ty) ? fields.ty : pos.y;

      let next: PlayerProfile = {
        ...profile,
        skillAt: { ...profile.skillAt, [skillId]: now },
      };

      // ポーター設置: ワールド空間・ユニオン所属が前提。設置先は自分の
      // タイルから PORTER_PLACE_RANGE 以内で、通行できるタイルのみ。
      // 保存はギルド ID キーで1件だけ（置き直し = 移動）。
      if (space !== "world") return err("not_in_world", 409);
      if (!isNationsEnabled()) return err("warp_unavailable", 503);
      const nationsState = await loadNationsState();
      const mine = nationsState.members[ownerKey];
      const nation = mine ? nationsState.nations[mine.nationId] : undefined;
      if (!mine || !nation) return err("not_in_union", 409);
      const gx = Math.floor(tx);
      const gy = Math.floor(ty);
      if (!porterInRange(Math.floor(pos.x), Math.floor(pos.y), gx, gy)) {
        return err("too_far", 409);
      }
      const override = await loadTileOverride(gx, gy);
      const hasBlock = !!(override && isOverrideActive(override, now) && override.block);
      const tileError = porterTileError(tileAt(gx, gy, MAP_SEED), hasBlock);
      if (tileError) return err(tileError, 409);
      const porter = { x: gx, y: gy, by: ownerKey, at: now };
      if (!(await storePorter(nation.guildId, porter))) return err("store_failed", 503);
      next = addMasteryXp(next, "teleporter", 2).profile;
      if (!(await storeProfile(ownerKey, next))) return err("store_failed", 503);
      return NextResponse.json(
        { ok: true, skill: skillId, fx: skill.fx, cx: gx + 0.5, cy: gy + 0.5, profile: next, results: [], porter },
        { headers: NO_STORE },
      );
    });
  }

  return err("invalid_request", 400);
}
