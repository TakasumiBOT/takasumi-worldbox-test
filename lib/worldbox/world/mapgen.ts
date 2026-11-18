export const T_GRASS = 0;
export const T_WATER = 1;
export const T_SAND = 2;
export const T_TREE = 3;
export const T_ROCK = 4;
export const T_DIRT = 5;
export const T_SNOW = 6;
export const T_SNOW_TREE = 7;

export const MAP_SEED = 20251115;

export const WORLD_COORD_LIMIT = 1_000_000;

export type CoordBounds = { minX: number; maxX: number; minY: number; maxY: number };

export function rectBounds(width: number, height: number): CoordBounds {
  return { minX: 0, maxX: width, minY: 0, maxY: height };
}

export function worldBounds(): CoordBounds {
  return {
    minX: -WORLD_COORD_LIMIT,
    maxX: WORLD_COORD_LIMIT,
    minY: -WORLD_COORD_LIMIT,
    maxY: WORLD_COORD_LIMIT,
  };
}

function latticeHash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = latticeHash(ix, iy, seed);
  const b = latticeHash(ix + 1, iy, seed);
  const c = latticeHash(ix, iy + 1, seed);
  const d = latticeHash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

export type TileIvs = {
  fertility: number;
  purity: number;
  altitude: number;
};

const IV_ELEV_CELLS = 7;
const IV_SPAN = 1024;

function ivClamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ivStretch(v: number): number {
  return ivClamp01(0.5 + (v - 0.5) * 1.7);
}

export function tileIvsAt(x: number, y: number): TileIvs {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const altitude = fbm((tx * IV_ELEV_CELLS) / IV_SPAN, (ty * IV_ELEV_CELLS) / IV_SPAN, MAP_SEED, 4);
  const jitter = latticeHash(tx, ty, MAP_SEED ^ 0x27d4eb2d);
  const soil = fbm(
    (tx * 15) / IV_SPAN + 71.25,
    (ty * 15) / IV_SPAN + 13.5,
    MAP_SEED ^ 0x3f4a5b6,
    3,
  );
  const fertility = Math.round(100 * ivClamp01(0.9 * ivStretch(soil) + 0.1 * jitter));
  const pureNoise = fbm(
    (tx * 25) / IV_SPAN + 11.75,
    (ty * 25) / IV_SPAN + 53.5,
    MAP_SEED ^ 0x51ab3c7,
    3,
  );
  const purity = Math.round(
    100 * ivClamp01(0.6 * ivStretch(pureNoise) + 0.4 * ivStretch(altitude)),
  );
  return { fertility, purity, altitude: Math.round(100 * ivClamp01(altitude)) };
}

export function isSolidMapTile(id: number): boolean {
  return id === T_WATER || id === T_TREE || id === T_ROCK || id === T_SNOW_TREE;
}

export type TileSource = {
  seed: number;
  tileAt: (x: number, y: number) => number;
  width?: number;
  height?: number;
};

export type TopDownMap = TileSource;

export function mapTileAt(map: TileSource, x: number, y: number): number {
  return map.tileAt(x, y);
}

export function tilesSource(
  seed: number,
  width: number,
  height: number,
  tiles: Uint8Array,
): TileSource {
  return {
    seed,
    width,
    height,
    tileAt: (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? T_ROCK : tiles[y * width + x]),
  };
}

const ELEV_FREQ = 7 / 1024;
const MOIST_FREQ = 9.5 / 1024;
export const SNOW_BASE_Y = 1024 * 0.22;
const SNOW_EDGE_AMP = 26;

export function snowBoundaryAt(seed: number, x: number): number {
  return SNOW_BASE_Y + (fbm(x * 0.006, 13.7, seed ^ 0x53c1, 2) - 0.5) * 2 * SNOW_EDGE_AMP;
}

const RIVER_CENTER_Y = 480;
const RIVER_AMP = 190;
const RIVER_FREQ = 0.0035;
const RIVER_PHASE = 7.3;
const RIVER_HALF = 0.9;
const RIVER_BANK = 2.1;

function riverCenterAt(seed: number, x: number): number {
  return (
    RIVER_CENTER_Y + (fbm(x * RIVER_FREQ, RIVER_PHASE, seed ^ 0x51ab, 3) - 0.5) * 2 * RIVER_AMP
  );
}

export function tileAt(x: number, y: number, seed: number = MAP_SEED): number {
  const e = fbm(x * ELEV_FREQ, y * ELEV_FREQ, seed, 4);
  let id = T_GRASS;
  if (e < 0.35) id = T_WATER;
  else if (e < 0.385) id = T_SAND;
  else if (e > 0.745) id = T_ROCK;
  else {
    const m = fbm(x * MOIST_FREQ + 37.5, y * MOIST_FREQ + 91.25, seed ^ 0x9e3779b9, 3);
    if (m > 0.585) id = T_TREE;
    else if (m < 0.3) id = T_DIRT;
  }
  if (y < snowBoundaryAt(seed, x)) {
    if (id === T_GRASS || id === T_DIRT) id = T_SNOW;
    else if (id === T_TREE) id = T_SNOW_TREE;
  }
  const d = Math.abs(y - riverCenterAt(seed, x));
  if (d <= RIVER_HALF) id = T_WATER;
  else if (d <= RIVER_BANK && id !== T_WATER) id = T_SAND;
  return id;
}

export function generateMap(
  seed: number = MAP_SEED,
  width = 1024,
  height = 1024,
): TileSource & { tiles: Uint8Array } {
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles[y * width + x] = tileAt(x, y, seed);
  }
  return { ...tilesSource(seed, width, height, tiles), tiles };
}

export function worldTileSource(seed: number = MAP_SEED): TileSource {
  return { seed, tileAt: (x, y) => tileAt(x, y, seed) };
}

export const CHUNK_SIZE = 32;

export type WorldChunk = {
  cx: number;
  cy: number;
  size: number;
  tiles: Uint8Array;
};

export function generateChunk(cx: number, cy: number, seed: number = MAP_SEED): WorldChunk {
  const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      tiles[y * CHUNK_SIZE + x] = tileAt(x0 + x, y0 + y, seed);
    }
  }
  return { cx, cy, size: CHUNK_SIZE, tiles };
}
