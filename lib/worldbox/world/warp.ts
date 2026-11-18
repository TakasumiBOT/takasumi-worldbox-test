import { isSolidMapTile, WORLD_COORD_LIMIT, type TopDownMap } from "./mapgen";
import { findFreeNear } from "../player/move";

export type UnionPorter = {
  x: number;
  y: number;
  by: string;
  at: number;
};

export const PORTER_PLACE_RANGE = 8;

export function parsePorter(raw: unknown): UnionPorter | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { x?: unknown; y?: unknown; by?: unknown; at?: unknown };
  if (typeof v.x !== "number" || typeof v.y !== "number") return null;
  if (!Number.isInteger(v.x) || !Number.isInteger(v.y)) return null;
  if (Math.abs(v.x) > WORLD_COORD_LIMIT || Math.abs(v.y) > WORLD_COORD_LIMIT) return null;
  if (typeof v.by !== "string" || v.by.length === 0) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at <= 0) return null;
  return { x: v.x, y: v.y, by: v.by, at: Math.floor(v.at) };
}

export function porterInRange(fromX: number, fromY: number, tx: number, ty: number): boolean {
  return Math.max(Math.abs(tx - fromX), Math.abs(ty - fromY)) <= PORTER_PLACE_RANGE;
}

export function porterTileError(tileId: number, hasBlock: boolean): "blocked_tile" | null {
  if (hasBlock) return "blocked_tile";
  if (isSolidMapTile(tileId)) return "blocked_tile";
  return null;
}

export function porterDestination(map: TopDownMap, porter: UnionPorter): { x: number; y: number } {
  return findFreeNear(map, porter.x + 0.5, porter.y + 0.5, undefined, { swim: true });
}
