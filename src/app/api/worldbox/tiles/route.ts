import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { WORLD_COORD_LIMIT, worldTileSource } from "@/lib/worldbox/world/mapgen";
import { loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { listPresence } from "@/lib/worldbox/player/presence-online";
import { presenceIdFor } from "@/lib/worldbox/player/presence";
import { parseSave } from "@/lib/worldbox/core/save";
import { loadWorldBoxSave } from "@/lib/worldbox/core/save-online";
import {
  applyDisplayAction,
  applyDrawWater,
  applyFlowerAction,
  applyMineBlock,
  applyPlaceBlock,
  applySetSign,
  applyTileAction,
  applyToggleGate,
  isOverrideActive,
  tileKey,
  type TileActionResult,
  type TileOverridesMap,
} from "@/lib/worldbox/world/tiles";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";
import { containerIsEmpty, isContainerItem } from "@/lib/worldbox/economy/containers";
import { isMachineItem, machineBufferCount } from "@/lib/worldbox/economy/machines";
import { deleteMachine, loadMachine } from "@/lib/worldbox/economy/machines-online";
import { isStallItem } from "@/lib/worldbox/economy/stalls";
import { loadStall } from "@/lib/worldbox/economy/stalls-online";
import { bumpMetric, recordFirstStep } from "@/lib/worldbox/core/metrics-online";
import { appendTileJournal, loadFrozen } from "@/lib/worldbox/core/ops-online";
import { loadContainer, storeContainer } from "@/lib/worldbox/economy/containers-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import {
  isTilesEnabled,
  loadTileOverride,
  loadTileOverrides,
  storeTileOverride,
} from "@/lib/worldbox/world/tiles-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const MAX_RECT_SPAN = 128;
const MAX_ACTION_DISTANCE = 2;

const BAD_REQUEST_ERRORS = new Set([
  "invalid_action",
  "invalid_request",
  "invalid_tile",
  "unknown_seed",
  "unknown_block",
]);

function errorStatus(error: string): number {
  if (error === "not_owner") return 403;
  return BAD_REQUEST_ERRORS.has(error) ? 400 : 409;
}

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

function intParam(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-WORLD_COORD_LIMIT, Math.min(WORLD_COORD_LIMIT, Math.floor(n)));
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

export async function GET(request: Request) {
  if (!isTilesEnabled()) {
    return NextResponse.json({ error: "tiles_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  const url = new URL(request.url);
  const x0 = intParam(url.searchParams.get("x0"), 0);
  const y0 = intParam(url.searchParams.get("y0"), 0);
  const x1 = Math.min(
    Math.max(intParam(url.searchParams.get("x1"), x0), x0),
    x0 + MAX_RECT_SPAN - 1,
  );
  const y1 = Math.min(
    Math.max(intParam(url.searchParams.get("y1"), y0), y0),
    y0 + MAX_RECT_SPAN - 1,
  );
  const all = await loadTileOverrides();
  const now = Date.now();
  const overrides: TileOverridesMap = {};
  for (const [key, ov] of Object.entries(all)) {
    const m = /^(-?\d+),(-?\d+)$/.exec(key);
    if (!m) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (!isOverrideActive(ov, now)) continue;
    overrides[key] = ov;
  }
  return NextResponse.json(
    {
      overrides,
      loggedIn: session !== null,
      selfId: session ? presenceIdFor(sessionOwnerKey(session)) : null,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isTilesEnabled()) {
    return NextResponse.json({ error: "tiles_unavailable" }, { status: 503, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const fields = (body ?? {}) as {
    action?: unknown;
    x?: unknown;
    y?: unknown;
    seedId?: unknown;
    itemId?: unknown;
    text?: unknown;
  };
  const ownerKey = sessionOwnerKey(session);
  if (await loadFrozen()) {
    return NextResponse.json({ error: "world_frozen" }, { status: 423, headers: NO_STORE });
  }

  if (typeof fields.x === "number" && typeof fields.y === "number") {
    const pos = await actorWorldPosition(ownerKey);
    if (!pos) {
      return NextResponse.json({ error: "position_unknown" }, { status: 409, headers: NO_STORE });
    }
    const dist = Math.max(
      Math.abs(Math.floor(pos.x) - Math.floor(fields.x)),
      Math.abs(Math.floor(pos.y) - Math.floor(fields.y)),
    );
    if (dist > MAX_ACTION_DISTANCE) {
      return NextResponse.json({ error: "too_far" }, { status: 409, headers: NO_STORE });
    }
  }

  const tx = typeof fields.x === "number" ? Math.floor(fields.x) : -1;
  const ty = typeof fields.y === "number" ? Math.floor(fields.y) : -1;
  const hasCoord = typeof fields.x === "number" && typeof fields.y === "number";

  return withUserLock(`tile:${tx},${ty}`, () =>
    withUserLock(ownerKey, async () => {
      const current = hasCoord ? await loadTileOverride(tx, ty) : null;
      const profile = await loadProfile(ownerKey);
      const map = worldTileSource();
      let result: TileActionResult;
      let minedContainerItem: string | null = null;
      let minedMachine = false;
      if (fields.action === "place_block") {
        const nationsState = await loadNationsState();
        const capitals = Object.values(nationsState.nations).map((n) => n.capital);
        result = applyPlaceBlock(
          current,
          profile,
          map,
          ownerKey,
          fields.x,
          fields.y,
          fields.itemId,
          Date.now(),
          {
            onCapital: hasCoord && capitals.some((c) => c.x === tx && c.y === ty),
          },
        );
      } else if (fields.action === "mine_block") {
        const blockItemId =
          current && isOverrideActive(current, Date.now()) ? current.block?.itemId : undefined;
        if (blockItemId && isContainerItem(blockItemId)) {
          const state = await loadContainer("world", tx, ty, blockItemId);
          if (state && !containerIsEmpty(state)) {
            return NextResponse.json({ error: "not_empty" }, { status: 409, headers: NO_STORE });
          }
          minedContainerItem = blockItemId;
        }
        if (blockItemId && isMachineItem(blockItemId)) {
          const machineState = await loadMachine(tx, ty);
          if (machineState && machineBufferCount(machineState) > 0) {
            return NextResponse.json({ error: "not_empty" }, { status: 409, headers: NO_STORE });
          }
          minedMachine = true;
        }
        if (blockItemId && isStallItem(blockItemId)) {
          const stallState = await loadStall(tx, ty);
          if (stallState && stallState.count > 0) {
            return NextResponse.json({ error: "not_empty" }, { status: 409, headers: NO_STORE });
          }
        }
        result = applyMineBlock(current, profile, map, ownerKey, fields.x, fields.y, Date.now(), {
          containerBreakAllowed: Boolean(blockItemId && isContainerItem(blockItemId)),
        });
      } else if (fields.action === "set_sign") {
        result = applySetSign(
          current,
          profile,
          map,
          ownerKey,
          fields.x,
          fields.y,
          fields.text,
          Date.now(),
        );
      } else if (fields.action === "set_display" || fields.action === "clear_display") {
        result = applyDisplayAction(
          current,
          profile,
          map,
          ownerKey,
          fields.x,
          fields.y,
          fields.action,
          fields.itemId,
          Date.now(),
        );
      } else if (fields.action === "draw_water") {
        result = applyDrawWater(current, profile, map, ownerKey, fields.x, fields.y, Date.now());
      } else if (fields.action === "plant_flower" || fields.action === "remove_flower") {
        result = applyFlowerAction(
          current,
          profile,
          map,
          ownerKey,
          fields.x,
          fields.y,
          fields.action,
          Date.now(),
        );
      } else if (fields.action === "toggle_gate") {
        result = applyToggleGate(current, profile, map, ownerKey, fields.x, fields.y, Date.now());
      } else {
        result = applyTileAction(
          current,
          profile,
          map,
          ownerKey,
          fields.action,
          fields.x,
          fields.y,
          fields.seedId,
          Date.now(),
        );
      }
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: errorStatus(result.error), headers: NO_STORE },
        );
      }
      if (!(await storeTileOverride(tx, ty, result.override))) {
        return NextResponse.json({ error: "tiles_failed" }, { status: 500, headers: NO_STORE });
      }
      void appendTileJournal({
        key: tileKey(tx, ty),
        prev: current,
        next: result.override,
        actor: ownerKey,
        at: Date.now(),
      });
      if (!(await storeProfile(ownerKey, result.profile))) {
        return NextResponse.json({ error: "tiles_failed" }, { status: 500, headers: NO_STORE });
      }
      if (fields.action === "place_block") {
        void bumpMetric("blocksPlaced", 1, Date.now());
        void recordFirstStep(ownerKey, "place", Date.now());
      }
      if (fields.action === "chop" || fields.action === "mine" || fields.action === "harvest") {
        void bumpMetric("harvests", 1, Date.now());
        void recordFirstStep(ownerKey, "gather", Date.now());
      }
      const blockBroken = fields.action === "mine_block" && !result.override?.block;
      if (minedContainerItem && blockBroken) await storeContainer("world", tx, ty, null);
      if (minedMachine && blockBroken) await deleteMachine(tx, ty);
      return NextResponse.json(
        {
          ok: true,
          tile: result.view,
          override: result.override,
          key: tileKey(tx, ty),
          profile: result.profile,
          gained: result.gained,
          ...(result.broke ? { broke: result.broke } : {}),
        },
        { headers: NO_STORE },
      );
    }),
  );
}
