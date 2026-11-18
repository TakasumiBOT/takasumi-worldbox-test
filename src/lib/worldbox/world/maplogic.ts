import {
  CHUNK_SIZE,
  MAP_SEED,
  T_GRASS,
  T_ROCK,
  T_SAND,
  T_SNOW_TREE,
  T_TREE,
  T_WATER,
  fbm,
  snowBoundaryAt,
} from "./mapgen";

export { CHUNK_SIZE };

export type BiomeId =
  | "lake"
  | "beach"
  | "plains"
  | "forest"
  | "dense_forest"
  | "dryland"
  | "wetland"
  | "highland"
  | "snowfield"
  | "snow_forest"
  | "cave_deep"
  | "ruins_belt";

export type BiomeDef = {
  id: BiomeId;
  name: string;
  resources: readonly string[];
};

export const BIOMES: readonly BiomeDef[] = [
  { id: "lake", name: "湖", resources: ["fish", "pearl", "salt"] },
  { id: "beach", name: "浜辺", resources: ["salt", "pearl", "fish", "stone"] },
  { id: "plains", name: "平原", resources: ["fiber", "flower", "herb", "egg"] },
  { id: "forest", name: "森", resources: ["wood", "mushroom", "berry", "herb", "honey"] },
  {
    id: "dense_forest",
    name: "深い森",
    resources: ["wood", "mushroom", "berry", "honey", "feather"],
  },
  { id: "dryland", name: "乾いた土地", resources: ["fiber", "flint", "stone"] },
  { id: "wetland", name: "湿地", resources: ["herb", "flower", "fish", "clay"] },
  { id: "highland", name: "岩場", resources: ["stone", "copper_ore", "iron_ore", "coal", "flint"] },
  { id: "snowfield", name: "雪原", resources: ["feather", "raw_meat"] },
  { id: "snow_forest", name: "雪の森", resources: ["wood", "raw_meat", "feather"] },
  { id: "cave_deep", name: "採掘場", resources: ["coal", "copper_ore", "iron_ore", "gold_ore"] },
  { id: "ruins_belt", name: "旧市街", resources: ["stone", "ancient_coin", "flint"] },
];

export function biomeForInstanceSpace(space: unknown): BiomeId | null {
  if (typeof space !== "string") return null;
  if (/^cave:-?\d+,-?\d+:\d+$/.test(space)) return "cave_deep";
  if (/^dungeon:-?\d+,-?\d+:\d+$/.test(space)) return "cave_deep";
  if (/^ruins:-?\d+,-?\d+:\d+$/.test(space)) return "ruins_belt";
  return null;
}

const BIOME_BY_ID = new Map(BIOMES.map((b) => [b.id, b]));
export function biomeById(id: unknown): BiomeDef | null {
  return typeof id === "string" ? (BIOME_BY_ID.get(id as BiomeId) ?? null) : null;
}

const WB_ELEV_CELLS = 7;
const WB_MOIST_CELLS = 9.5;
const WORLD_SPAN = 1024;

export function elevationAt(seed: number, x: number, y: number): number {
  return fbm((x * WB_ELEV_CELLS) / WORLD_SPAN, (y * WB_ELEV_CELLS) / WORLD_SPAN, seed, 4);
}

export function moistureAt(seed: number, x: number, y: number): number {
  return fbm(
    (x * WB_MOIST_CELLS) / WORLD_SPAN + 37.5,
    (y * WB_MOIST_CELLS) / WORLD_SPAN + 91.25,
    seed ^ 0x9e3779b9,
    3,
  );
}

export function isSnowZone(seed: number, x: number, y: number): boolean {
  return y < snowBoundaryAt(seed, x);
}

export function classifyBiome(
  elevation: number,
  moisture: number,
  snow: boolean,
  tile: number,
): BiomeId {
  if (tile === T_WATER || elevation < 0.35) return "lake";
  if (tile === T_SAND || elevation < 0.385) return "beach";
  if (tile === T_ROCK || elevation > 0.745) return "highland";
  if (snow) return tile === T_SNOW_TREE ? "snow_forest" : "snowfield";
  if (tile === T_TREE) return moisture > 0.68 ? "dense_forest" : "forest";
  if (moisture > 0.68) return "dense_forest";
  if (moisture > 0.585) return "forest";
  if (moisture < 0.3) return "dryland";
  if (elevation < 0.45 && moisture > 0.5) return "wetland";
  return "plains";
}

export function biomeAt(seed: number, x: number, y: number, tile?: number): BiomeId {
  const e = elevationAt(seed, x, y);
  const m = moistureAt(seed, x, y);
  const t =
    tile ??
    (e < 0.35 ? T_WATER : e < 0.385 ? T_SAND : e > 0.745 ? T_ROCK : m > 0.585 ? T_TREE : T_GRASS);
  return classifyBiome(e, m, isSnowZone(seed, x, y), t);
}

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export function parseChunkKey(key: string): { cx: number; cy: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

export function chunkLocal(x: number, y: number): { lx: number; ly: number } {
  const { cx, cy } = chunkOf(x, y);
  return { lx: x - cx * CHUNK_SIZE, ly: y - cy * CHUNK_SIZE };
}

export function chunkHash(seed: number, cx: number, cy: number, salt: number): number {
  let h = (cx * 374761393 + cy * 668265263 + seed * 974634211 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type StructureKind = "entrance" | "ruin" | "site";

export type StructureDef = {
  id: string;
  name: string;
  kind: StructureKind;
  targetSpace?: "cave" | "dungeon" | "ruins";
  biomes: readonly BiomeId[];
  cellChunks: number;
  chance: number;
  trait: "rare_ore" | "treasure_trap" | "strong_enemy" | "landmark" | "rest";
};

export const STRUCTURES: readonly StructureDef[] = [
  {
    id: "cave_entrance",
    name: "採掘場の入口",
    kind: "entrance",
    targetSpace: "cave",
    biomes: ["highland", "forest", "dense_forest"],
    cellChunks: 3,
    chance: 0.55,
    trait: "rare_ore",
  },
  {
    id: "dungeon_entrance",
    name: "廃ビルの入口",
    kind: "entrance",
    targetSpace: "dungeon",
    biomes: ["highland", "dense_forest", "snowfield"],
    cellChunks: 6,
    chance: 0.4,
    trait: "strong_enemy",
  },
  {
    id: "ruins_entrance",
    name: "旧市街の入口",
    kind: "entrance",
    targetSpace: "ruins",
    biomes: ["plains", "forest", "dryland"],
    cellChunks: 5,
    chance: 0.45,
    trait: "treasure_trap",
  },
  {
    id: "abandoned_camp",
    name: "廃れた野営地",
    kind: "site",
    biomes: ["plains", "forest", "beach"],
    cellChunks: 4,
    chance: 0.5,
    trait: "landmark",
  },
  {
    id: "ancient_shrine",
    name: "古い祠",
    kind: "site",
    biomes: ["forest", "dense_forest", "snow_forest", "plains"],
    cellChunks: 5,
    chance: 0.4,
    trait: "rest",
  },
  {
    id: "watchtower_ruins",
    name: "見張り塔の跡",
    kind: "ruin",
    biomes: ["plains", "highland", "dryland"],
    cellChunks: 6,
    chance: 0.35,
    trait: "landmark",
  },
  {
    id: "sunken_ruins",
    name: "水辺の遺構",
    kind: "ruin",
    biomes: ["beach", "wetland", "lake"],
    cellChunks: 6,
    chance: 0.3,
    trait: "treasure_trap",
  },
];

const STRUCTURE_BY_ID = new Map(STRUCTURES.map((s) => [s.id, s]));
export function structureById(id: unknown): StructureDef | null {
  return typeof id === "string" ? (STRUCTURE_BY_ID.get(id) ?? null) : null;
}

export type PlacedStructure = {
  structureId: string;
  x: number;
  y: number;
  biome: BiomeId;
};

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function structuresForChunk(seed: number, cx: number, cy: number): PlacedStructure[] {
  for (const def of STRUCTURES) {
    const cellX = floorDiv(cx, def.cellChunks);
    const cellY = floorDiv(cy, def.cellChunks);
    const candCx =
      cellX * def.cellChunks + Math.floor(chunkHash(seed, cellX, cellY, 11) * def.cellChunks);
    const candCy =
      cellY * def.cellChunks + Math.floor(chunkHash(seed, cellX, cellY, 23) * def.cellChunks);
    if (candCx !== cx || candCy !== cy) continue;
    if (chunkHash(seed, cx, cy, 37) >= def.chance) continue;
    const lx = 4 + Math.floor(chunkHash(seed, cx, cy, 41) * (CHUNK_SIZE - 8));
    const ly = 4 + Math.floor(chunkHash(seed, cx, cy, 53) * (CHUNK_SIZE - 8));
    const x = cx * CHUNK_SIZE + lx;
    const y = cy * CHUNK_SIZE + ly;
    const biome = biomeAt(seed, x, y);
    if (!def.biomes.includes(biome)) continue;
    return [{ structureId: def.id, x, y, biome }];
  }
  return [];
}

export const DEFAULT_SEED = MAP_SEED;
