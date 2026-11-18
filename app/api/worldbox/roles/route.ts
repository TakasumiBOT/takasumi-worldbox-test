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
  activeSkillFor,
  addMasteryXp,
  applyRoleChange,
  isAdventureRoleId,
  masteryRankOf,
  ROLE_CHANGE_REASON,
  skillCooldownLeft,
  SKILLS,
  type SkillId,
} from "@/lib/worldbox/player/roles";
import { isNationsEnabled, loadNationsState } from "@/lib/worldbox/social/nations-online";
import { porterInRange, porterTileError } from "@/lib/worldbox/world/warp";
import { storePorter } from "@/lib/worldbox/world/warp-online";
import { isOverrideActive } from "@/lib/worldbox/world/tiles";
import { loadTileOverride } from "@/lib/worldbox/world/tiles-online";
import { buildEconomyOp } from "@/lib/worldbox/economy/economy-bridge";
import {
  isEconomyEnabled,
  readUserBalance,
  submitEconomyOp,
  waitForOpDone,
} from "@/lib/worldbox/economy/economy-bridge-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { parseInstanceSpace } from "@/lib/worldbox/world/instances";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function err(error: string, status = 409) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function actorPos(
  ownerKey: string,
  space: string,
  reported: { x: number; y: number } | null,
) {
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
  const skill = profile.role === "teleporter" ? SKILLS.porter : activeSkillFor(profile);
  return NextResponse.json(
    {
      role: profile.role,
      rank: masteryRankOf(profile, profile.role),
      mastery: profile.mastery,
      skill: skill
        ? { ...skill, cooldownLeftMs: skillCooldownLeft(profile, skill.id, Date.now()) }
        : null,
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
    action?: unknown;
    role?: unknown;
    skill?: unknown;
    tx?: unknown;
    ty?: unknown;
    space?: unknown;
    px?: unknown;
    py?: unknown;
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
    return withUserLock(ownerKey, async () => {
      const current = await loadProfile(ownerKey);
      if (!current) return err("roles_unavailable", 503);
      const { profile: next, cost } = applyRoleChange(current, targetRole);
      if (cost <= 0) {
        if (!(await storeProfile(ownerKey, next))) return err("store_failed", 503);
        return NextResponse.json({ ok: true, profile: next, cost: 0 }, { headers: NO_STORE });
      }
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
      const submitted = await submitEconomyOp(op);
      if (submitted.state === "unavailable") {
        await storeProfile(ownerKey, current);
        return err("economy_failed", 503);
      }
      const settled =
        submitted.state === "pending" ? await waitForOpDone(ownerKey, op.id) : submitted.op;
      if (settled && settled.status === "failed") {
        await storeProfile(ownerKey, current);
        return err("economy_failed", 409);
      }
      return NextResponse.json({ ok: true, profile: next, cost }, { headers: NO_STORE });
    });
  }

  const space = typeof fields.space === "string" ? fields.space : "world";
  const reported =
    typeof fields.px === "number" &&
    typeof fields.py === "number" &&
    Number.isFinite(fields.px) &&
    Number.isFinite(fields.py)
      ? { x: fields.px, y: fields.py }
      : null;
  const pos = await actorPos(ownerKey, space, reported);
  if (!pos) return err("position_unknown", 409);

  if (fields.action === "skill") {
    return withUserLock(ownerKey, async () => {
      const profile = await loadProfile(ownerKey);
      if (!profile) return err("roles_unavailable", 503);
      const skillId = typeof fields.skill === "string" ? (fields.skill as SkillId) : null;
      if (!skillId || !(skillId in SKILLS)) return err("invalid_request", 400);
      const skill = SKILLS[skillId];
      const rank = masteryRankOf(profile, profile.role);
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
        {
          ok: true,
          skill: skillId,
          fx: skill.fx,
          cx: gx + 0.5,
          cy: gy + 0.5,
          profile: next,
          results: [],
          porter,
        },
        { headers: NO_STORE },
      );
    });
  }

  return err("invalid_request", 400);
}
