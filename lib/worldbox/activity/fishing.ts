import { CHUNK_SIZE } from "../world/mapgen";
import { objectsForChunk, specialObjectById, type PlacedObject } from "../world/objects";

export const FISHING_SPOT_ID = "fishing_spot";

export function fishingSpotAt(seed: number, x: number, y: number): PlacedObject | null {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  return (
    objectsForChunk(seed, cx, cy).find(
      (o) => o.objectId === FISHING_SPOT_ID && o.x === x && o.y === y,
    ) ?? null
  );
}

export function fishingReady(caughtAt: number | null, now: number): boolean {
  const def = specialObjectById(FISHING_SPOT_ID);
  if (!def) return false;
  if (caughtAt === null) return true;
  return now - caughtAt >= def.respawnMs;
}

export function fishingNonce(caughtAt: number | null, now: number): number {
  const def = specialObjectById(FISHING_SPOT_ID);
  if (!def || def.respawnMs <= 0) return 0;
  return Math.floor(now / def.respawnMs);
}
