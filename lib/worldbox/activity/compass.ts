import { CHUNK_SIZE, STRUCTURES, chunkHash, structuresForChunk } from "../world/maplogic";

export type CompassEntranceKind = "cave" | "dungeon";

export type CompassTarget = {
  kind: CompassEntranceKind;
  structureId: string;
  x: number;
  y: number;
  dist: number;
  angle: number;
};

export const COMPASS_MAX_TILES = 3072;

const COMPASS_TARGETS: readonly { kind: CompassEntranceKind; structureId: string }[] = [
  { kind: "cave", structureId: "cave_entrance" },
  { kind: "dungeon", structureId: "dungeon_entrance" },
];

function divFloor(a: number, b: number): number {
  return Math.floor(a / b);
}

export function nearestEntrance(
  seed: number,
  kind: CompassEntranceKind,
  x: number,
  y: number,
  maxTiles: number = COMPASS_MAX_TILES,
): CompassTarget | null {
  const target = COMPASS_TARGETS.find((t) => t.kind === kind);
  const def = STRUCTURES.find((s) => s.id === target?.structureId);
  if (!target || !def) return null;
  const cell = def.cellChunks;
  const cellTiles = cell * CHUNK_SIZE;
  const psx = divFloor(Math.floor(x / CHUNK_SIZE), cell);
  const psy = divFloor(Math.floor(y / CHUNK_SIZE), cell);
  let best: CompassTarget | null = null;
  for (let r = 0; ; r++) {
    const lowerBound = r === 0 ? 0 : (r - 1) * cellTiles;
    if (lowerBound > maxTiles) break;
    if (best && lowerBound > best.dist) break;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const sx = psx + dx;
        const sy = psy + dy;
        const candCx = sx * cell + Math.floor(chunkHash(seed, sx, sy, 11) * cell);
        const candCy = sy * cell + Math.floor(chunkHash(seed, sx, sy, 23) * cell);
        for (const st of structuresForChunk(seed, candCx, candCy)) {
          if (st.structureId !== def.id) continue;
          const tx = st.x + 0.5;
          const ty = st.y + 0.5;
          const dist = Math.hypot(tx - x, ty - y);
          if (dist > maxTiles) continue;
          if (!best || dist < best.dist) {
            best = {
              kind,
              structureId: def.id,
              x: tx,
              y: ty,
              dist,
              angle: Math.atan2(ty - y, tx - x),
            };
          }
        }
      }
    }
  }
  return best;
}

export function nearestEntrances(
  seed: number,
  x: number,
  y: number,
  maxTiles: number = COMPASS_MAX_TILES,
): { cave: CompassTarget | null; dungeon: CompassTarget | null } {
  return {
    cave: nearestEntrance(seed, "cave", x, y, maxTiles),
    dungeon: nearestEntrance(seed, "dungeon", x, y, maxTiles),
  };
}
