import { T_GRASS, T_ROCK, tilesSource, type TopDownMap } from "./mapgen";
import {
  L_WALL,
  L_WOOD,
  isSeatSprite,
  isSolidLobbyTile,
  type LobbyData,
  type LobbyObject,
} from "./lobby";

export interface TentTier {
  w: number;
  h: number;
  price: number;
}

export const TENT_TIERS: readonly TentTier[] = [
  { w: 13, h: 10, price: 0 },
  { w: 17, h: 13, price: 3000 },
  { w: 22, h: 17, price: 10000 },
];

export const TENT_MAX_TIER = TENT_TIERS.length - 1;

export function tentTierOf(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(TENT_MAX_TIER, Math.max(0, Math.floor(raw)))
    : 0;
}

export function tentSizeForTier(tier: number): TentTier {
  return TENT_TIERS[tentTierOf(tier)];
}

export const TENT_MAX_W = TENT_TIERS[TENT_MAX_TIER].w;
export const TENT_MAX_H = TENT_TIERS[TENT_MAX_TIER].h;

export const TENT_W = TENT_TIERS[0].w;
export const TENT_H = TENT_TIERS[0].h;

export function tentExitFor(tier: number): { x: number; y: number } {
  const { w, h } = tentSizeForTier(tier);
  return { x: Math.floor(w / 2), y: h - 1 };
}

export function tentEntryFor(tier: number): { x: number; y: number } {
  const exit = tentExitFor(tier);
  return { x: exit.x + 0.5, y: exit.y - 0.5 };
}

export const TENT_ENTRY = tentEntryFor(0);
export const TENT_EXIT = tentExitFor(0);

function tentObjectsFor(tier: number): readonly LobbyObject[] {
  const { w, h } = tentSizeForTier(tier);
  const exit = tentExitFor(tier);
  return [
    { sprite: "furnace", x: 1, y: 1, w: 1, h: 1, solid: true, station: "smith" },
    { sprite: "anvil", x: 2, y: 1, w: 1, h: 1, solid: true, station: "smith" },
    { sprite: "lamp", x: w - 2, y: 1, w: 1, h: 1, solid: true },
    { sprite: "bookshelf", x: w - 3, y: 1, w: 1, h: 1, solid: true },
    { sprite: "crate", x: 1, y: h - 2, w: 1, h: 1, solid: true },
    { sprite: "barrel", x: 2, y: h - 2, w: 1, h: 1, solid: true },
    { sprite: "sofa", x: w - 2, y: h - 2, w: 1, h: 1, solid: true },
    { sprite: "workbench", x: exit.x + 1, y: h - 2, w: 1, h: 1, solid: true, station: "smith" },
    { sprite: "warp_pad", x: exit.x, y: exit.y, w: 1, h: 1, solid: false },
  ];
}

export function tentTileAt(
  tiles: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return tiles[y * width + x];
}

const tentCache = new Map<number, LobbyData>();

export function buildTent(tier = 0): LobbyData {
  const t = tentTierOf(tier);
  const cached = tentCache.get(t);
  if (cached) return cached;
  const { w, h } = tentSizeForTier(t);
  const exit = tentExitFor(t);
  const objects = tentObjectsFor(t);
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const door = x === exit.x && y === exit.y;
      tiles[y * w + x] = border && !door ? L_WALL : L_WOOD;
    }
  }
  const blocked = new Set<string>();
  for (const o of objects) {
    if (!o.solid) continue;
    if (isSeatSprite(o.sprite)) continue;
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) blocked.add(`${o.x + dx},${o.y + dy}`);
    }
  }
  const moveTiles = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) {
    moveTiles[i] = isSolidLobbyTile(tiles[i]) ? T_ROCK : T_GRASS;
  }
  const moveMap: TopDownMap = tilesSource(0, w, h, moveTiles);
  const data: LobbyData = {
    width: w,
    height: h,
    tiles,
    objects,
    npcs: [],
    blocked,
    moveMap,
  };
  tentCache.set(t, data);
  return data;
}
