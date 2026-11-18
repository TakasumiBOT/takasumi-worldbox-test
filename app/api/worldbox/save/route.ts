import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { parseSave, serializeSave } from "@/lib/worldbox/core/save";
import {
  MAX_SAVE_JSON_LENGTH,
  isOnlineSaveEnabled,
  loadWorldBoxSave,
  storeWorldBoxSave,
} from "@/lib/worldbox/core/save-online";
import { loadMyPresence } from "@/lib/worldbox/player/presence-online";
import {
  checkMovementContinuity,
  checkSaveFallbackContinuity,
} from "@/lib/worldbox/player/presence";
import { pickRandomSpawn } from "@/lib/worldbox/world/spawn";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isOnlineSaveEnabled()) {
    return NextResponse.json({ error: "save_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const ownerKey = sessionOwnerKey(session);
  const save = await loadWorldBoxSave(ownerKey);
  if (save && parseSave(save)) {
    return NextResponse.json({ save }, { headers: NO_STORE });
  }
  const spawn = pickRandomSpawn(Math.random);
  const fresh = serializeSave({ space: "world", x: spawn.x, y: spawn.y, worldReturn: null });
  await storeWorldBoxSave(ownerKey, fresh);
  return NextResponse.json({ save: fresh }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isOnlineSaveEnabled()) {
    return NextResponse.json({ error: "save_unavailable" }, { status: 503, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const save = (body as { save?: unknown } | null)?.save;
  if (typeof save !== "string" || save.length === 0 || save.length > MAX_SAVE_JSON_LENGTH) {
    return NextResponse.json({ error: "invalid_save" }, { status: 400, headers: NO_STORE });
  }
  const parsed = parseSave(save);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_save" }, { status: 400, headers: NO_STORE });
  }
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();
  const freshPresence = await loadMyPresence(ownerKey);
  if (freshPresence) {
    if (!checkMovementContinuity(freshPresence, parsed, now).ok) {
      return NextResponse.json(
        {
          error: "position_jump",
          x: freshPresence.x,
          y: freshPresence.y,
          space: freshPresence.space,
        },
        { status: 409, headers: NO_STORE },
      );
    }
  } else {
    const storedSave = parseSave(await loadWorldBoxSave(ownerKey));
    if (storedSave && !checkSaveFallbackContinuity(storedSave, parsed).ok) {
      return NextResponse.json(
        { error: "position_jump", x: storedSave.x, y: storedSave.y, space: storedSave.space },
        { status: 409, headers: NO_STORE },
      );
    }
  }
  const stored = await storeWorldBoxSave(ownerKey, save);
  if (!stored) {
    return NextResponse.json({ error: "save_failed" }, { status: 500, headers: NO_STORE });
  }
  return NextResponse.json({ saved: true }, { headers: NO_STORE });
}
