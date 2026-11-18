import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { WORLD_COORD_LIMIT } from "@/lib/worldbox/world/mapgen";
import { loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { listPresence } from "@/lib/worldbox/player/presence-online";
import { presenceIdFor } from "@/lib/worldbox/player/presence";
import { parseSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave } from "@/lib/worldbox/core/save-online";
import { isOverrideActive } from "@/lib/worldbox/world/tiles";
import { isTilesEnabled, loadTileOverride } from "@/lib/worldbox/world/tiles-online";
import {
  containerCapacity,
  emptyContainer,
  isContainerItem,
  moveContainerSlot,
  type ContainerState,
} from "@/lib/worldbox/economy/containers";
import {
  isContainersEnabled,
  loadContainer,
  storeContainer,
} from "@/lib/worldbox/economy/containers-online";
import { TENT_H, buildTent } from "@/lib/worldbox/world/tent";
import { buildLobby } from "@/lib/worldbox/world/lobby";
import { buildLobby2, buildLobby3 } from "@/lib/worldbox/world/lobby-floors";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const MAX_ACTION_DISTANCE = 2;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function checkedCoord(xRaw: unknown, yRaw: unknown): { x: number; y: number } | null {
  if (typeof xRaw !== "number" || typeof yRaw !== "number") return null;
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
  const x = Math.floor(xRaw);
  const y = Math.floor(yRaw);
  if (Math.abs(x) > WORLD_COORD_LIMIT || Math.abs(y) > WORLD_COORD_LIMIT) return null;
  return { x, y };
}

type ContainerSpace = "world" | "tent" | "lobby" | "lobby2" | "lobby3";

function parseContainerSpace(raw: unknown): ContainerSpace {
  return raw === "tent" || raw === "lobby" || raw === "lobby2" || raw === "lobby3" ? raw : "world";
}

function fixtureStoreSpace(space: ContainerSpace): string {
  return space;
}

async function actorPosition(
  ownerKey: string,
  space: ContainerSpace,
): Promise<{ x: number; y: number } | null> {
  const selfId = presenceIdFor(ownerKey);
  const entries = await listPresence();
  const now = Date.now();
  const entry = entries.find((e) => e.id === selfId && e.space === space && now - e.ts <= 15_000);
  if (entry) return { x: entry.x, y: entry.y };
  const saved = parseSave(await loadWorldBoxSave(ownerKey));
  if (saved && saved.space === space) return { x: saved.x, y: saved.y };
  return null;
}

type ResolvedContainer =
  | {
      ok: true;
      itemId: string;
      state: ContainerState;
      storeSpace: string;
      storeX: number;
      storeY: number;
    }
  | { ok: false; error: string; status: number };

async function resolveContainer(
  ownerKey: string,
  space: ContainerSpace,
  x: number,
  y: number,
): Promise<ResolvedContainer> {
  const selfId = presenceIdFor(ownerKey);
  if (space !== "world") {
    const tent = space === "tent" ? buildTent((await loadProfile(ownerKey)).tentTier) : null;
    const objects = tent
      ? tent.objects
      : space === "lobby"
        ? buildLobby().objects
        : space === "lobby2"
          ? buildLobby2().objects
          : buildLobby3().objects;
    const obj = objects.find(
      (o) => isContainerItem(o.sprite) && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h,
    );
    if (!obj) return { ok: false, error: "no_container", status: 404 };
    const storeSpace = fixtureStoreSpace(space);
    const storeX = obj.x;
    const storeY = tent ? obj.y - (tent.height - TENT_H) : obj.y;
    const stored = await loadContainer(storeSpace, storeX, storeY, obj.sprite);
    const state = stored ?? emptyContainer(selfId, obj.sprite);
    return { ok: true, itemId: obj.sprite, state, storeSpace, storeX, storeY };
  }
  const ov = await loadTileOverride(x, y);
  const block = ov && isOverrideActive(ov, Date.now()) ? ov.block : undefined;
  if (!block || !isContainerItem(block.itemId)) {
    return { ok: false, error: "no_container", status: 404 };
  }
  const stored = await loadContainer("world", x, y, block.itemId);
  const state = stored ?? emptyContainer(selfId, block.itemId);
  return { ok: true, itemId: block.itemId, state, storeSpace: "world", storeX: x, storeY: y };
}

function errorJson(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return errorJson("unauthorized", 401);
  if (!isContainersEnabled() || !isTilesEnabled()) {
    return errorJson("containers_unavailable", 503);
  }
  const url = new URL(request.url);
  const xRaw = url.searchParams.get("x");
  const yRaw = url.searchParams.get("y");
  const coord = checkedCoord(
    xRaw === null ? NaN : Number(xRaw),
    yRaw === null ? NaN : Number(yRaw),
  );
  if (!coord) return errorJson("invalid_tile", 400);
  const space = parseContainerSpace(url.searchParams.get("space"));
  const ownerKey = sessionOwnerKey(session);
  const pos = await actorPosition(ownerKey, space);
  if (!pos) return errorJson("position_unknown", 409);
  const dist = Math.max(
    Math.abs(Math.floor(pos.x) - coord.x),
    Math.abs(Math.floor(pos.y) - coord.y),
  );
  if (dist > MAX_ACTION_DISTANCE) return errorJson("too_far", 409);
  const resolved = await resolveContainer(ownerKey, space, coord.x, coord.y);
  if (!resolved.ok) return errorJson(resolved.error, resolved.status);
  return NextResponse.json(
    {
      ok: true,
      x: coord.x,
      y: coord.y,
      itemId: resolved.itemId,
      capacity: containerCapacity(resolved.itemId),
      container: resolved.state,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorJson("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return errorJson("unauthorized", 401);
  if (!isContainersEnabled() || !isTilesEnabled()) {
    return errorJson("containers_unavailable", 503);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("invalid_request", 400);
  }
  const fields = (body ?? {}) as {
    action?: unknown;
    x?: unknown;
    y?: unknown;
    from?: unknown;
    to?: unknown;
    space?: unknown;
  };
  if (fields.action !== "move") return errorJson("invalid_action", 400);
  const coord = checkedCoord(fields.x, fields.y);
  if (!coord) return errorJson("invalid_tile", 400);
  const space = parseContainerSpace(fields.space);
  const ownerKey = sessionOwnerKey(session);

  const pos = await actorPosition(ownerKey, space);
  if (!pos) return errorJson("position_unknown", 409);
  const dist = Math.max(
    Math.abs(Math.floor(pos.x) - coord.x),
    Math.abs(Math.floor(pos.y) - coord.y),
  );
  if (dist > MAX_ACTION_DISTANCE) return errorJson("too_far", 409);

  return withUserLock(ownerKey, async () => {
    const resolved = await resolveContainer(ownerKey, space, coord.x, coord.y);
    if (!resolved.ok) return errorJson(resolved.error, resolved.status);

    const profile = await loadProfile(ownerKey);
    const moved = moveContainerSlot(profile, resolved.state, fields.from, fields.to);
    if (!moved) return errorJson("invalid_action", 400);
    if (
      !(await storeContainer(
        resolved.storeSpace,
        resolved.storeX,
        resolved.storeY,
        moved.container,
      ))
    ) {
      return errorJson("containers_failed", 500);
    }
    if (!(await storeProfile(ownerKey, moved.profile))) {
      return errorJson("containers_failed", 500);
    }
    return NextResponse.json(
      { ok: true, profile: moved.profile, container: moved.container },
      { headers: NO_STORE },
    );
  });
}
