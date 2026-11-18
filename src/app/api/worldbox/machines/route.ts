import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { WORLD_COORD_LIMIT } from "@/lib/worldbox/world/mapgen";
import { loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { addItem } from "@/lib/worldbox/player/profile";
import { listPresence } from "@/lib/worldbox/player/presence-online";
import { presenceIdFor } from "@/lib/worldbox/player/presence";
import { parseSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave } from "@/lib/worldbox/core/save-online";
import { isOverrideActive, tileKey, type TileOverride } from "@/lib/worldbox/world/tiles";
import {
  isTilesEnabled,
  loadTileOverride,
  loadTileOverrides,
  storeTileOverride,
} from "@/lib/worldbox/world/tiles-online";
import {
  decodeProgram,
  defaultProgram,
  encodeProgram,
  evaluateMachine,
  isMachineItem,
  machineBufferCount,
  parseProgram,
  type MachineState,
} from "@/lib/worldbox/economy/machines";
import {
  isMachinesEnabled,
  loadMachine,
  storeMachine,
} from "@/lib/worldbox/economy/machines-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_ACTION_DISTANCE = 2;

function err(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

function checkedCoord(xRaw: unknown, yRaw: unknown): { x: number; y: number } | null {
  if (typeof xRaw !== "number" || typeof yRaw !== "number") return null;
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
  const x = Math.floor(xRaw);
  const y = Math.floor(yRaw);
  if (Math.abs(x) > WORLD_COORD_LIMIT || Math.abs(y) > WORLD_COORD_LIMIT) return null;
  return { x, y };
}

async function actorWorldPosition(ownerKey: string): Promise<{ x: number; y: number } | null> {
  const selfId = presenceIdFor(ownerKey);
  const entries = await listPresence();
  const now = Date.now();
  const entry = entries.find((e) => e.id === selfId && e.space === "world" && now - e.ts <= 15_000);
  if (entry) return { x: entry.x, y: entry.y };
  const saved = parseSave(await loadWorldBoxSave(ownerKey));
  if (saved && saved.space === "world") return { x: saved.x, y: saved.y };
  return null;
}

async function nearMachine(request: Request, ownerKey: string, x: number, y: number) {
  const pos = await actorWorldPosition(ownerKey);
  if (!pos) return err("position_unknown", 409);
  if (
    Math.max(Math.abs(Math.floor(pos.x) - x), Math.abs(Math.floor(pos.y) - y)) > MAX_ACTION_DISTANCE
  ) {
    return err("too_far", 409);
  }
  return null;
}

async function ensureMachine(
  ownerKey: string,
  x: number,
  y: number,
): Promise<{ state: MachineState } | { response: NextResponse }> {
  const ov = await loadTileOverride(x, y);
  const now = Date.now();
  if (!ov || !isOverrideActive(ov, now) || !ov.block || !isMachineItem(ov.block.itemId)) {
    return { response: err("no_machine", 404) };
  }
  const selfId = presenceIdFor(ownerKey);
  if (ov.block.ownerId !== selfId) return { response: err("not_owner", 403) };
  let state = await loadMachine(x, y);
  if (!state) {
    state = {
      ownerId: selfId,
      program: defaultProgram(),
      buffer: {},
      lastEvalAt: now,
      updatedAt: now,
    };
    await storeMachine(x, y, state);
  }
  return { state };
}

async function runEvaluation(x: number, y: number, state: MachineState): Promise<MachineState> {
  const now = Date.now();
  if (!state.program.enabled || now - state.lastEvalAt < state.program.intervalSec * 1000)
    return state;
  const all = await loadTileOverrides();
  const neighbors = new Map<string, TileOverride>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const key = tileKey(x + dx, y + dy);
      const ov = all[key];
      if (ov && isOverrideActive(ov, now)) neighbors.set(key, ov);
    }
  }
  const result = evaluateMachine(state, neighbors, now);
  if (!result.evaluated) return state;
  for (const [key, next] of result.changed) {
    const [tx, ty] = key.split(",").map(Number);
    await storeTileOverride(tx, ty, next);
  }
  if (result.harvested > 0 || result.state.lastEvalAt !== state.lastEvalAt) {
    await storeMachine(x, y, result.state);
  }
  return result.state;
}

function publicState(state: MachineState) {
  return {
    program: state.program,
    code: encodeProgram(state.program),
    buffer: state.buffer,
    buffered: machineBufferCount(state),
  };
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isMachinesEnabled() || !isTilesEnabled()) return err("machines_unavailable", 503);
  const url = new URL(request.url);
  const coord = checkedCoord(Number(url.searchParams.get("x")), Number(url.searchParams.get("y")));
  if (!coord) return err("invalid_coord", 400);
  const ownerKey = sessionOwnerKey(session);
  const far = await nearMachine(request, ownerKey, coord.x, coord.y);
  if (far) return far;
  const ensured = await ensureMachine(ownerKey, coord.x, coord.y);
  if ("response" in ensured) return ensured.response;
  const state = await runEvaluation(coord.x, coord.y, ensured.state);
  return NextResponse.json({ machine: publicState(state) }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isMachinesEnabled() || !isTilesEnabled()) return err("machines_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid_request", 400);
  }
  const fields = (body ?? {}) as {
    action?: unknown;
    x?: unknown;
    y?: unknown;
    program?: unknown;
    code?: unknown;
  };
  const coord = checkedCoord(
    typeof fields.x === "number" ? fields.x : Number(fields.x),
    typeof fields.y === "number" ? fields.y : Number(fields.y),
  );
  if (!coord) return err("invalid_coord", 400);
  const ownerKey = sessionOwnerKey(session);
  const far = await nearMachine(request, ownerKey, coord.x, coord.y);
  if (far) return far;

  return withUserLock(`machine:${coord.x},${coord.y}`, async () => {
    const ensured = await ensureMachine(ownerKey, coord.x, coord.y);
    if ("response" in ensured) return ensured.response;
    let state = await runEvaluation(coord.x, coord.y, ensured.state);
    const now = Date.now();

    if (fields.action === "set_program") {
      state = { ...state, program: parseProgram(fields.program), updatedAt: now };
      await storeMachine(coord.x, coord.y, state);
      return NextResponse.json({ machine: publicState(state) }, { headers: NO_STORE });
    }
    if (fields.action === "apply_code") {
      const program = decodeProgram(fields.code);
      if (!program) return err("bad_code", 400);
      state = { ...state, program, updatedAt: now };
      await storeMachine(coord.x, coord.y, state);
      return NextResponse.json({ machine: publicState(state) }, { headers: NO_STORE });
    }
    if (fields.action === "collect") {
      if (machineBufferCount(state) <= 0) return err("empty", 409);
      let profile = await loadProfile(ownerKey);
      for (const [itemId, count] of Object.entries(state.buffer)) {
        profile = addItem(profile, itemId, count);
      }
      await storeProfile(ownerKey, profile);
      state = { ...state, buffer: {}, updatedAt: now };
      await storeMachine(coord.x, coord.y, state);
      return NextResponse.json({ machine: publicState(state), profile }, { headers: NO_STORE });
    }
    return err("invalid_action", 400);
  });
}
