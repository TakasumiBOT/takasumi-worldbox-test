import { T_WATER, isSolidMapTile, mapTileAt, type TopDownMap } from "../world/mapgen";

export const WALK_SPEED = 4.4;
export const DASH_SPEED = 7.0;
export const SWIM_SPEED = 3.0;
export const SWIM_DASH_SPEED = 5.4;
export const PLAYER_RADIUS = 0.32;

export type MoveOptions = { swim?: boolean };

function isSolidFor(map: TopDownMap, tx: number, ty: number, swim: boolean): boolean {
  const id = mapTileAt(map, tx, ty);
  if (swim && id === T_WATER) return false;
  return isSolidMapTile(id);
}

export type MoveResult = {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
};

export type BlockedTiles = ReadonlySet<string>;

export function circleHitsSolid(
  map: TopDownMap,
  cx: number,
  cy: number,
  r: number,
  blocked?: BlockedTiles,
  opts?: MoveOptions,
): boolean {
  const swim = opts?.swim === true;
  const x0 = Math.floor(cx - r);
  const x1 = Math.floor(cx + r);
  const y0 = Math.floor(cy - r);
  const y1 = Math.floor(cy + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const solid = isSolidFor(map, tx, ty, swim) || (blocked?.has(`${tx},${ty}`) ?? false);
      if (!solid) continue;
      const closestX = Math.max(tx, Math.min(cx, tx + 1));
      const closestY = Math.max(ty, Math.min(cy, ty + 1));
      const dx = cx - closestX;
      const dy = cy - closestY;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

export function stepMove(
  map: TopDownMap,
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  dt: number,
  blocked?: BlockedTiles,
  opts?: MoveOptions,
): MoveResult {
  const r = PLAYER_RADIUS;
  let { x, y } = pos;
  let hitX = false;
  let hitY = false;

  const nx = x + vel.x * dt;
  if (circleHitsSolid(map, nx, y, r, blocked, opts)) hitX = true;
  else x = nx;

  const ny = y + vel.y * dt;
  if (circleHitsSolid(map, x, ny, r, blocked, opts)) hitY = true;
  else y = ny;

  return { x, y, hitX, hitY };
}

export function canStandAt(
  map: TopDownMap,
  x: number,
  y: number,
  blocked?: BlockedTiles,
  opts?: MoveOptions,
): boolean {
  return !circleHitsSolid(map, x, y, PLAYER_RADIUS, blocked, opts);
}

export function findFreeNear(
  map: TopDownMap,
  x: number,
  y: number,
  blocked?: BlockedTiles,
  opts?: MoveOptions,
): { x: number; y: number } {
  if (canStandAt(map, x, y, blocked, opts)) return { x, y };
  for (let ring = 1; ring <= 8; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (canStandAt(map, cx, cy, blocked, opts)) return { x: cx, y: cy };
      }
    }
  }
  return { x, y };
}

export function isWaterAt(map: TopDownMap, x: number, y: number): boolean {
  return mapTileAt(map, Math.floor(x), Math.floor(y)) === T_WATER;
}
