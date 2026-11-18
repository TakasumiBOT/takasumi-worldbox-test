import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { WORLD_COORD_LIMIT } from "@/lib/worldbox/world/mapgen";
import { isProfileEnabled, loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { listPresence, putPresence } from "@/lib/worldbox/player/presence-online";
import { presenceIdFor } from "@/lib/worldbox/player/presence";
import { parseSave, serializeSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave, storeWorldBoxSave } from "@/lib/worldbox/core/save-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { activityForWindow, stepVitals } from "@/lib/worldbox/player/vitals";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

function errorResponse(error: string, status = 409) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function actorWorldPosition(
  ownerKey: string,
  reported?: { x: number; y: number } | null,
  space: string = "world",
): Promise<{ x: number; y: number } | null> {
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

async function movePresenceAndSave(
  ownerKey: string,
  dest: { space: string; x: number; y: number },
  now: number,
  name: string,
): Promise<boolean> {
  const prev = parseSave(await loadWorldBoxSave(ownerKey));
  const saved = await storeWorldBoxSave(
    ownerKey,
    serializeSave({
      space: dest.space,
      x: dest.x,
      y: dest.y,
      worldReturn: prev?.worldReturn ?? null,
    }),
  );
  if (!saved) return false;
  return putPresence(
    ownerKey,
    {
      name: name.trim() || "プレイヤー",
      x: dest.x,
      y: dest.y,
      vx: 0,
      vy: 0,
      face: 1,
      space: dest.space,
    },
    now,
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return errorResponse("unauthorized", 401);
  if (!isProfileEnabled()) return errorResponse("profile_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  const data = (body ?? {}) as {
    action?: unknown;
    px?: unknown;
    py?: unknown;
    space?: unknown;
  };
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();

  if (data.action === "sync") {
    return withUserLock(ownerKey, async () => {
      const current = await loadProfile(ownerKey);
      const reported =
        typeof data.px === "number" &&
        typeof data.py === "number" &&
        Number.isFinite(data.px) &&
        Number.isFinite(data.py) &&
        Math.abs(data.px) <= WORLD_COORD_LIMIT &&
        Math.abs(data.py) <= WORLD_COORD_LIMIT
          ? { x: data.px, y: data.py }
          : null;
      const space =
        typeof data.space === "string" && data.space.length > 0 ? data.space.slice(0, 64) : "world";
      const pos = await actorWorldPosition(ownerKey, reported, space);
      const prev =
        typeof current.vitalX === "number" &&
        typeof current.vitalY === "number" &&
        typeof current.vitalSpace === "string"
          ? { x: current.vitalX, y: current.vitalY, space: current.vitalSpace }
          : null;
      const cur = pos ? { x: pos.x, y: pos.y, space } : null;
      const elapsedSec = current.vitalAt > 0 ? (now - current.vitalAt) / 1000 : 0;
      const activity = activityForWindow(prev, cur, elapsedSec);
      const settled = stepVitals(current, now, activity);
      const profile = cur
        ? { ...settled.profile, vitalX: cur.x, vitalY: cur.y, vitalSpace: cur.space }
        : settled.profile;
      if (profile.pendingTeleport) {
        const teleport = profile.pendingTeleport;
        if (!(await movePresenceAndSave(ownerKey, teleport, now, session.username ?? ""))) {
          if (!(await storeProfile(ownerKey, profile))) return errorResponse("store_failed", 503);
          return NextResponse.json({ profile }, { headers: NO_STORE });
        }
        const cleared = { ...profile, pendingTeleport: null };
        if (!(await storeProfile(ownerKey, cleared))) return errorResponse("store_failed", 503);
        return NextResponse.json({ profile: cleared, teleport }, { headers: NO_STORE });
      }
      if (profile !== current && !(await storeProfile(ownerKey, profile))) {
        return errorResponse("store_failed", 503);
      }
      return NextResponse.json({ profile }, { headers: NO_STORE });
    });
  }

  return errorResponse("invalid_action", 400);
}
