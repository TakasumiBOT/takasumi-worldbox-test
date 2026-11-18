import { MAP_SEED, T_DIRT, T_GRASS, T_SAND, T_SNOW, tileAt } from "./mapgen";

export const SPAWN_RADIUS = 2000;
const SPAWN_TRIES = 256;

export function isSpawnableTile(id: number): boolean {
  return id === T_GRASS || id === T_DIRT || id === T_SAND || id === T_SNOW;
}

export function pickRandomSpawn(
  rand: () => number,
  seed: number = MAP_SEED,
): { x: number; y: number } {
  const span = SPAWN_RADIUS * 2 + 1;
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const tx = Math.floor(rand() * span) - SPAWN_RADIUS;
    const ty = Math.floor(rand() * span) - SPAWN_RADIUS;
    if (isSpawnableTile(tileAt(tx, ty, seed))) return { x: tx + 0.5, y: ty + 0.5 };
  }
  for (let r = 0; r <= 256; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isSpawnableTile(tileAt(dx, dy, seed))) return { x: dx + 0.5, y: dy + 0.5 };
      }
    }
  }
  return { x: 0.5, y: 0.5 };
}
