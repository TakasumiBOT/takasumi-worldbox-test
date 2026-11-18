import { T_GRASS, T_ROCK, tilesSource, type TopDownMap } from "./mapgen";
import type { ShopGenreId } from "../economy/shops";

export const SEAT_SPRITES: ReadonlySet<string> = new Set(["bench", "chair", "sofa"]);

export function isSeatSprite(sprite: string): boolean {
  return SEAT_SPRITES.has(sprite);
}

export const LOBBY_W = 126;
export const LOBBY_H = 64;

export const L_VOID = 0;
export const L_WALL = 1;
export const L_MARBLE = 2;
export const L_PLAZA = 3;
export const L_RING = 4;
export const L_CARPET = 5;
export const L_WOOD = 6;
export const L_SAND = 7;
export const L_DARK = 8;
export const L_CHECK = 9;

export const LOBBY_FLOOR_SPRITE: Record<number, string | null> = {
  [L_WALL]: "wall_stone",
  [L_MARBLE]: "floor_marble",
  [L_PLAZA]: "floor_marble",
  [L_RING]: "carpet_red",
  [L_CARPET]: "carpet_plain",
  [L_WOOD]: "floor_wood",
  [L_SAND]: null,
  [L_DARK]: "floor_marble_dark",
  [L_CHECK]: "floor_check",
};

export const LOBBY_FLOOR_FALLBACK: Record<number, string> = {
  [L_WALL]: "#5c6076",
  [L_MARBLE]: "#e4e2de",
  [L_PLAZA]: "#eceae6",
  [L_RING]: "#922a34",
  [L_CARPET]: "#922a34",
  [L_WOOD]: "#ac7c4e",
  [L_SAND]: "#ddd29a",
  [L_DARK]: "#434854",
  [L_CHECK]: "#cfd0d4",
};

export function isSolidLobbyTile(id: number): boolean {
  return id === L_VOID || id === L_WALL;
}

const PLAZA = { cx: 28, cy: 24, r: 11 };
const APSE = { cx: 28, cy: 10, r: 10 };
const SMITH_CIRCLE = { cx: 28, cy: 39, r: 4 };

export const RACETRACK = { cx: 93, cy: 26, rx: 29, ry: 18, innerRx: 24, innerRy: 13 };
export const RACE_CORRIDOR = { x0: 54, y0: 21, x1: 59, y1: 27 };
export const RACECOURSE = { x0: 60, y0: 4, x1: 125, y1: 47 };

function ellipseRatio(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  x: number,
  y: number,
): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy;
}

export function isRaceTrackTile(x: number, y: number): boolean {
  return (
    ellipseRatio(RACETRACK.cx, RACETRACK.cy, RACETRACK.rx, RACETRACK.ry, x, y) <= 1 &&
    ellipseRatio(RACETRACK.cx, RACETRACK.cy, RACETRACK.innerRx, RACETRACK.innerRy, x, y) >= 1
  );
}

export function isRaceInfieldTile(x: number, y: number): boolean {
  return ellipseRatio(RACETRACK.cx, RACETRACK.cy, RACETRACK.innerRx, RACETRACK.innerRy, x, y) < 1;
}

function inCircle(cx: number, cy: number, r: number, x: number, y: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function inRect(x0: number, y0: number, x1: number, y1: number, x: number, y: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function inLobbyShape(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= LOBBY_W || y >= LOBBY_H) return false;
  if (y <= APSE.cy && inCircle(APSE.cx, APSE.cy, APSE.r, x, y)) return true;
  if (inRect(26, 8, 30, 15, x, y)) return true;
  if (inCircle(PLAZA.cx, PLAZA.cy, PLAZA.r, x, y)) return true;
  if (inRect(2, 18, 19, 30, x, y)) return true;
  if (inRect(37, 18, 53, 30, x, y)) return true;
  if (inRect(24, 34, 32, 41, x, y)) return true;
  if (inCircle(SMITH_CIRCLE.cx, SMITH_CIRCLE.cy, SMITH_CIRCLE.r, x, y)) return true;
  if (inRect(RACE_CORRIDOR.x0, RACE_CORRIDOR.y0, RACE_CORRIDOR.x1, RACE_CORRIDOR.y1, x, y))
    return true;
  if (inRect(RACECOURSE.x0, RACECOURSE.y0, RACECOURSE.x1, RACECOURSE.y1, x, y)) return true;
  if (inRect(2, 48, 19, 63, x, y)) return true;
  return false;
}

function dist2(cx: number, cy: number, x: number, y: number): number {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy;
}

function floorAt(x: number, y: number): number {
  let floor = L_MARBLE;
  if (y <= APSE.cy && inCircle(APSE.cx, APSE.cy, APSE.r, x, y)) {
    floor = dist2(APSE.cx, APSE.cy, x, y) <= 49 ? L_SAND : L_MARBLE;
  }
  if (inRect(37, 18, 53, 30, x, y)) floor = L_CARPET;
  if (inRect(2, 18, 19, 30, x, y)) floor = L_WOOD;
  if (
    inRect(24, 34, 32, 41, x, y) ||
    inCircle(SMITH_CIRCLE.cx, SMITH_CIRCLE.cy, SMITH_CIRCLE.r, x, y)
  )
    floor = L_DARK;
  if (inRect(2, 48, 19, 63, x, y)) floor = L_CHECK;
  if (inRect(RACE_CORRIDOR.x0, RACE_CORRIDOR.y0, RACE_CORRIDOR.x1, RACE_CORRIDOR.y1, x, y))
    floor = L_CARPET;
  if (inRect(RACECOURSE.x0, RACECOURSE.y0, RACECOURSE.x1, RACECOURSE.y1, x, y)) {
    floor = L_MARBLE;
    if (isRaceInfieldTile(x, y)) floor = L_PLAZA;
    else if (isRaceTrackTile(x, y)) floor = L_SAND;
  }
  if (inCircle(PLAZA.cx, PLAZA.cy, PLAZA.r, x, y)) {
    floor = dist2(PLAZA.cx, PLAZA.cy, x, y) <= 100 ? L_PLAZA : L_RING;
  }
  return floor;
}

export type LobbyStation =
  | "board"
  | "shop"
  | "bank"
  | "casino"
  | "arena"
  | "smith"
  | "guild"
  | "fountain"
  | "rest"
  | "arcade"
  | "race"
  | "sell"
  | "telescope"
  | "piano"
  | "stock";

export type LobbyObject = {
  sprite: string;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  station?: LobbyStation;
  genre?: ShopGenreId;
  arcade?: string;
};

const objects: LobbyObject[] = [];
const occupied = new Set<string>();

type PutOpts = {
  w?: number;
  h?: number;
  solid?: boolean;
  station?: LobbyStation;
  genre?: ShopGenreId;
};

function put(sprite: string, x: number, y: number, opts: PutOpts = {}): void {
  const w = opts.w ?? 1;
  const h = opts.h ?? 1;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (occupied.has(key)) throw new Error(`lobby object overlap at ${key} (${sprite})`);
      occupied.add(key);
    }
  }
  objects.push({
    sprite,
    x,
    y,
    w,
    h,
    solid: opts.solid ?? true,
    station: opts.station,
    genre: opts.genre,
  });
}
function row(sprite: string, x0: number, x1: number, y: number, opts: PutOpts = {}): void {
  for (let x = x0; x <= x1; x++) put(sprite, x, y, opts);
}
function col(sprite: string, x: number, y0: number, y1: number, opts: PutOpts = {}): void {
  for (let y = y0; y <= y1; y++) put(sprite, x, y, opts);
}

put("fountain", 27, 23, { w: 3, h: 3, station: "fountain" });
put("telescope", 28, 27, { station: "telescope" });
row("bulletin_board", 27, 29, 15, { station: "board" });
row("guild_board", 24, 25, 15, { station: "guild" });
put("warp_pad", 28, 34, { solid: false });
row("bench", 23, 24, 17);
row("bench", 30, 31, 17);
for (const [x, y] of [
  [19, 19],
  [37, 19],
  [19, 29],
  [37, 29],
] as const)
  put("lamp", x, y);
for (const [x, y] of [
  [21, 21],
  [35, 21],
  [21, 27],
  [35, 27],
] as const)
  put("pillar", x, y);
for (const [x, y] of [
  [25, 32],
  [31, 32],
] as const)
  put("planter", x, y);
put("vending", 24, 32);
put("vending", 32, 32);

row("bank_counter", 33, 34, 17, { station: "bank" });
put("vault", 35, 17, { station: "bank" });
put("atm", 35, 18, { station: "bank" });
put("stock_board", 32, 17, { station: "stock" });
put("atm", 32, 18, { station: "stock" });

row("shop_counter", 4, 6, 20, { station: "shop", genre: "tools" });
row("shop_counter", 8, 10, 20, { station: "shop", genre: "blocks" });
row("shop_counter", 12, 14, 20, { station: "shop", genre: "furniture" });
row("shop_counter", 4, 6, 27, { station: "shop", genre: "food" });
row("shop_counter", 12, 14, 27, { station: "shop", genre: "farm" });
row("shop_counter", 15, 16, 27, { station: "sell" });
put("sign_board", 16, 20);
put("planter", 3, 19);
put("planter", 17, 19);
col("item_shelf", 3, 23, 24, { station: "shop", genre: "tools" });
col("display_case", 7, 23, 24, { station: "shop", genre: "blocks" });
col("display_case", 11, 23, 24, { station: "shop", genre: "blocks" });
row("display_case", 8, 10, 27, { station: "shop", genre: "farm" });
put("sign_board", 9, 26);
row("display_case", 8, 10, 29, { station: "shop", genre: "farm" });
put("crate", 16, 23);
put("crate", 16, 24);
put("barrel", 15, 24);
put("barrel", 3, 29);
put("stairs", 17, 29, { solid: false });
put("stairs", 18, 29, { solid: false });

for (const x of [39, 41, 43]) put("slot_machine", x, 19, { station: "casino" });
for (const x of [46, 48, 50]) put("slot7_machine", x, 19, { station: "casino" });
put("roulette_table", 40, 24, { station: "casino" });
put("dice_table", 44, 24, { station: "casino" });
put("blackjack_table", 48, 24, { station: "casino" });
put("chair", 40, 25);
put("chair", 44, 25);
put("chair", 48, 25);
for (const x of [40, 43, 46]) put("double_machine", x, 29, { station: "casino" });
put("slot_machine", 50, 29, { station: "casino" });
put("table_round", 44, 22);
put("sofa", 51, 24);
put("sofa", 51, 25);
put("table_round", 50, 22);
put("piano", 39, 26, { station: "piano" });
put("hedge", 44, 21);
put("hedge", 44, 27);
put("planter", 52, 19);
put("lamp", 38, 19);
put("lamp", 52, 29);
put("tapestry", 52, 22, { solid: false });

row("shop_counter", 72, 77, 25, { station: "race" });
row("bulletin_board", 72, 75, 21, { station: "race" });
put("sign_board", 61, 21, { station: "race" });
col("arena_gate", 65, 23, 28);
row("bench", 84, 102, 5);
put("telescope", 93, 6, { station: "telescope" });
row("bench", 84, 102, 46);
row("fence_wood", 104, 111, 22);
row("fence_wood", 104, 111, 30);
col("fence_wood", 111, 23, 29);
put("planter", 107, 26);
put("hedge", 84, 34);
put("hedge", 102, 34);
put("lamp", 61, 5);
put("lamp", 124, 5);
put("lamp", 61, 46);
put("lamp", 124, 46);
col("bench", 124, 14, 21);
col("bench", 124, 31, 38);
row("bench", 78, 83, 46);
row("bench", 103, 108, 46);
row("bench", 78, 83, 45);
row("bench", 103, 108, 45);
row("hedge", 82, 86, 36);
row("hedge", 100, 104, 36);
put("lamp", 93, 34);
put("planter", 90, 34);
put("planter", 96, 34);
put("planter", 89, 38);
put("planter", 97, 38);
put("sign_board", 114, 39);
row("fence_wood", 116, 119, 39);
row("fence_wood", 122, 124, 39);
col("fence_wood", 115, 40, 45);
row("fence_wood", 116, 124, 45);
col("fence_wood", 124, 40, 44);
put("lamp", 116, 40);
put("crate", 116, 44);
put("barrel", 117, 44);
put("fence_wood", 119, 43);
put("fence_wood", 119, 44);
put("fence_wood", 122, 43);
put("fence_wood", 122, 44);
put("workbench", 123, 40);
put("planter", 123, 44);

for (let y = 0; y <= 9; y++) {
  for (let x = 0; x < LOBBY_W; x++) {
    const d2 = dist2(APSE.cx, APSE.cy, x, y);
    if (d2 >= 36 && d2 <= 52) put("arena_gate", x, y, { station: "arena" });
  }
}
for (const [x, y] of [
  [20, 6],
  [21, 5],
  [35, 6],
  [34, 5],
  [24, 2],
  [32, 2],
] as const) {
  put("bench", x, y, { station: "arena" });
}
put("sign_board", 29, 13, { station: "arena" });

put("furnace", 25, 40, { station: "smith" });
put("furnace", 31, 40, { station: "smith" });
put("anvil", 28, 38, { station: "smith" });
put("workbench", 25, 36, { station: "smith" });
put("workbench", 31, 36, { station: "smith" });
put("fence_wood", 26, 38);
put("fence_wood", 30, 38);
put("crate", 26, 34);
put("barrel", 30, 34);
put("lamp", 28, 41);

for (const y of [51, 57]) {
  for (const [x0, genre] of [
    [3, "tools"],
    [8, "blocks"],
    [13, "furniture"],
  ] as const) {
    row("shop_counter", x0, x0 + 2, y, { station: "shop", genre });
    put("sign_board", x0 + 3, y);
  }
}
row("bookshelf", 3, 5, 54, { station: "rest" });
row("item_shelf", 8, 10, 54, { station: "shop", genre: "blocks" });
row("bookshelf", 13, 15, 54, { station: "rest" });
put("sofa", 3, 60, { station: "rest" });
put("chair", 4, 60, { station: "rest" });
put("table_round", 4, 61, { station: "rest" });
put("planter", 18, 49);
put("lamp", 3, 49);
put("stairs", 17, 50, { solid: false });
put("stairs", 18, 50, { solid: false });
put("stairs", 17, 62, { solid: false });
put("stairs", 18, 62, { solid: false });

export const LOBBY_OBJECTS: readonly LobbyObject[] = objects;

export const LOBBY_NPCS: readonly { x: number; y: number }[] = [
  { x: 5, y: 19 },
  { x: 9, y: 19 },
  { x: 13, y: 19 }, // 北カウンターの店員レーン
  { x: 5, y: 28 },
  { x: 13, y: 28 },
  { x: 15, y: 28 }, // 南カウンターの店員レーン（15 は買取カウンター）
  { x: 74, y: 24 }, // 競馬場の馬券カウンターの係員レーン
];

export const LOBBY_ENTRY = { x: 28.5, y: 32.5 };
export const LOBBY_WARP_PAD = { x: 28, y: 34 };
export const LOBBY_STAIRS_UP: readonly { x: number; y: number }[] = [
  { x: 17, y: 29 },
  { x: 18, y: 29 },
];
export const LOBBY_STAIRS_DOWN: readonly { x: number; y: number }[] = [
  { x: 17, y: 62 },
  { x: 18, y: 62 },
];
export const LOBBY_UP_LANDING = { x: 17.5, y: 60.5 };
export const LOBBY_DOWN_LANDING = { x: 17.5, y: 27.5 };
export const LOBBY_STAIRS_2F: readonly { x: number; y: number }[] = [
  { x: 17, y: 50 },
  { x: 18, y: 50 },
];
export const LOBBY_2F_LANDING = { x: 17.5, y: 51.5 };

export type LobbyData = {
  width: number;
  height: number;
  tiles: Uint8Array;
  objects: readonly LobbyObject[];
  npcs: readonly { x: number; y: number }[];
  blocked: ReadonlySet<string>;
  moveMap: TopDownMap;
};

export function lobbyTileAt(tiles: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= LOBBY_W || y >= LOBBY_H) return L_VOID;
  return tiles[y * LOBBY_W + x];
}

let cached: LobbyData | null = null;

export function buildLobby(): LobbyData {
  if (cached) return cached;
  const tiles = new Uint8Array(LOBBY_W * LOBBY_H);
  for (let y = 0; y < LOBBY_H; y++) {
    for (let x = 0; x < LOBBY_W; x++) {
      if (!inLobbyShape(x, y)) continue;
      const boundary =
        !inLobbyShape(x - 1, y) ||
        !inLobbyShape(x + 1, y) ||
        !inLobbyShape(x, y - 1) ||
        !inLobbyShape(x, y + 1);
      tiles[y * LOBBY_W + x] = boundary ? L_WALL : floorAt(x, y);
    }
  }
  const blocked = new Set<string>();
  for (const o of LOBBY_OBJECTS) {
    if (!o.solid) continue;
    if (isSeatSprite(o.sprite)) continue;
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) blocked.add(`${o.x + dx},${o.y + dy}`);
    }
  }
  const moveTiles = new Uint8Array(LOBBY_W * LOBBY_H);
  for (let i = 0; i < tiles.length; i++) {
    moveTiles[i] = isSolidLobbyTile(tiles[i]) ? T_ROCK : T_GRASS;
  }
  cached = {
    width: LOBBY_W,
    height: LOBBY_H,
    tiles,
    objects: LOBBY_OBJECTS,
    npcs: LOBBY_NPCS,
    blocked,
    moveMap: tilesSource(0, LOBBY_W, LOBBY_H, moveTiles),
  };
  return cached;
}

function stationMatchTier(o: LobbyObject, tx: number, ty: number): 0 | 1 | 2 {
  const inX = tx >= o.x && tx < o.x + o.w;
  const inY = ty >= o.y && ty < o.y + o.h;
  if (inX && (ty === o.y - 1 || ty === o.y + o.h)) return 1;
  if (inY && (tx === o.x - 1 || tx === o.x + o.w)) return 1;
  if (tx >= o.x - 1 && tx <= o.x + o.w && ty >= o.y - 1 && ty <= o.y + o.h) return 2;
  return 0;
}

export function stationNear(
  objectsList: readonly LobbyObject[],
  tx: number,
  ty: number,
): LobbyStation | null {
  let diagonal: LobbyStation | null = null;
  for (const o of objectsList) {
    if (!o.station) continue;
    const tier = stationMatchTier(o, tx, ty);
    if (tier === 1) return o.station;
    if (tier === 2 && diagonal === null) diagonal = o.station;
  }
  return diagonal;
}

export function stationArcadeNear(
  objectsList: readonly LobbyObject[],
  tx: number,
  ty: number,
): string | null {
  let diagonal: string | null = null;
  for (const o of objectsList) {
    if (o.station !== "arcade" || !o.arcade) continue;
    const tier = stationMatchTier(o, tx, ty);
    if (tier === 1) return o.arcade;
    if (tier === 2 && diagonal === null) diagonal = o.arcade;
  }
  return diagonal;
}

export function stationGenreNear(
  objectsList: readonly LobbyObject[],
  tx: number,
  ty: number,
): ShopGenreId | null {
  for (const o of objectsList) {
    if (o.station !== "shop" || !o.genre) continue;
    if (tx >= o.x - 1 && tx <= o.x + o.w && ty >= o.y - 1 && ty <= o.y + o.h) return o.genre;
  }
  return null;
}
