import {
  ITEMS,
  cropById,
  cropBySeedId,
  itemById,
  type ItemDef,
  type ToolKind,
} from "../economy/items";
import {
  T_DIRT,
  T_GRASS,
  T_ROCK,
  T_SAND,
  T_SNOW,
  T_SNOW_TREE,
  T_TREE,
  T_WATER,
  WORLD_COORD_LIMIT,
  mapTileAt,
  tileIvsAt,
  type TileIvs,
  type TopDownMap,
} from "./mapgen";
import {
  addItem,
  bestToolItem,
  countItem,
  removeItem,
  wearTool,
  type PlayerProfile,
} from "../player/profile";
import { presenceIdFor } from "../player/presence";
import { seasonGrowthMult } from "./seasons";

export const TREE_REGROW_MS = 6 * 3600 * 1000;
export const ROCK_REGROW_MS = 3 * 3600 * 1000;
export const CHOP_WOOD_COUNT = 2;
export const CHOP_WOOD_BAREHAND = 1;
export const MINE_STONE_COUNT = 2;
export const TERRAIN_ROCK_HP = 60;
export const TERRAIN_TREE_HP = 30;

export function fertilityGrowthFactor(fertility: number): number {
  const f = Math.max(0, Math.min(100, fertility));
  return 1 - (f - 50) / 200;
}

export function fertilityBonusYield(fertility: number): number {
  if (fertility >= 85) return 2;
  if (fertility >= 65) return 1;
  return 0;
}

export function purityBonusStone(purity: number): number {
  return purity >= 70 ? 1 : 0;
}

export function purityBonusCoal(purity: number): number {
  return purity >= 85 ? 1 : 0;
}

export function terrainMaxHp(tile: number): number {
  if (tile === T_ROCK) return TERRAIN_ROCK_HP;
  if (tile === T_TREE || tile === T_SNOW_TREE) return TERRAIN_TREE_HP;
  return 0;
}

export type CropState = {
  cropId: string;
  plantedAt: number;
  readyAt: number;
};

export type PlacedBlock = {
  itemId: string;
  ownerId: string;
  hp?: number;
};

export function placedBlockSolid(itemId: string): boolean {
  if (isFloorItem(itemId)) return false;
  if (isFenceItem(itemId)) return true;
  const def = itemById(itemId);
  return def !== null && def.facility !== true;
}

export type StationKind = "craft" | "smelt" | "cook" | "weave" | "enhance";

export const PLACED_STATION_KINDS: Readonly<Record<string, readonly StationKind[]>> = {
  workbench: ["craft"],
  smithing_table: ["craft", "enhance"],
  anvil: ["enhance"],
  furnace: ["smelt"],
  campfire: ["cook"],
  cooking_pot: ["cook"],
  loom: ["weave"],
};

export function placedStationKinds(itemId: unknown): readonly StationKind[] {
  if (typeof itemId !== "string") return [];
  return PLACED_STATION_KINDS[itemId] ?? [];
}

export const FLOOR_ITEM_IDS: ReadonlySet<string> = new Set([
  "path_block",
  "ice_block",
  "honey_block",
  "slime_block",
  "bridge_block",
]);

export function isFloorItem(itemId: string): boolean {
  return FLOOR_ITEM_IDS.has(itemId);
}

export function floorSpeedMultiplier(itemId: string | null): number {
  if (itemId === "path_block") return 1.3;
  if (itemId === "honey_block") return 0.5;
  return 1;
}

export const FENCE_ITEM_IDS: ReadonlySet<string> = new Set([
  "fence_wood",
  "stone_fence",
  "iron_fence",
]);

export function isFenceItem(itemId: string): boolean {
  return FENCE_ITEM_IDS.has(itemId);
}

export const GATE_ITEM_IDS: ReadonlySet<string> = new Set(["wooden_gate"]);

export function isGateItem(itemId: string): boolean {
  return GATE_ITEM_IDS.has(itemId);
}

export type TileOverride = {
  tile?: number;
  farmland?: boolean;
  crop?: CropState | null;
  stump?: boolean;
  block?: PlacedBlock;
  hp?: number;
  deco?: string;
  gateOpen?: boolean;
  signText?: string;
  display?: string;
  ownerId: string;
  until?: number;
};

export type TileOverridesMap = Record<string, TileOverride>;

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseTileKey(key: string): { x: number; y: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (Math.abs(x) > WORLD_COORD_LIMIT || Math.abs(y) > WORLD_COORD_LIMIT) return null;
  return { x, y };
}

export function isOverrideActive(ov: TileOverride | undefined | null, now: number): boolean {
  if (!ov) return false;
  return ov.until === undefined || ov.until > now;
}

export function effectiveTile(
  map: TopDownMap,
  overrides: TileOverridesMap,
  x: number,
  y: number,
  now: number,
): number {
  const ov = overrides[tileKey(x, y)];
  if (isOverrideActive(ov, now) && ov && ov.tile !== undefined) return ov.tile;
  return mapTileAt(map, x, y);
}

export function cropStage(crop: CropState, now: number): 0 | 1 | 2 {
  if (now >= crop.readyAt) return 2;
  const span = Math.max(1, crop.readyAt - crop.plantedAt);
  return (now - crop.plantedAt) / span < 0.5 ? 0 : 1;
}

export type TileView = {
  x: number;
  y: number;
  tile: number;
  farmland: boolean;
  stump: boolean;
  crop: { cropId: string; stage: 0 | 1 | 2; ready: boolean } | null;
  block: {
    itemId: string;
    mine: boolean;
    hpFrac: number;
    gateOpen?: boolean;
    signText?: string;
    display?: string;
  } | null;
  hpFrac: number;
  ivs: TileIvs;
  mine: boolean;
};

export function terrainHpFraction(ov: TileOverride | null | undefined, tile: number): number {
  const max = terrainMaxHp(tile);
  if (max <= 0) return 1;
  const hp = ov?.hp === undefined ? max : ov.hp;
  return Math.max(0, Math.min(1, hp / max));
}

export function tileView(
  map: TopDownMap,
  overrides: TileOverridesMap,
  x: number,
  y: number,
  now: number,
  selfKey: string | null,
): TileView {
  const ov = overrides[tileKey(x, y)];
  const active = isOverrideActive(ov, now) ? ov : null;
  const crop = active?.crop ?? null;
  const selfId = selfKey !== null ? presenceIdFor(selfKey) : null;
  const effTile = effectiveTile(map, overrides, x, y, now);
  return {
    x,
    y,
    tile: effTile,
    hpFrac: terrainHpFraction(active, effTile),
    ivs: tileIvsAt(x, y),
    farmland: active?.farmland === true,
    stump: active?.stump === true,
    crop: crop
      ? { cropId: crop.cropId, stage: cropStage(crop, now), ready: now >= crop.readyAt }
      : null,
    block: active?.block
      ? {
          itemId: active.block.itemId,
          mine: selfId !== null && active.block.ownerId === selfId,
          hpFrac: blockHpFraction(active.block),
          ...(active.gateOpen !== undefined ? { gateOpen: active.gateOpen } : {}),
          ...(active.signText ? { signText: active.signText } : {}),
          ...(active.display ? { display: active.display } : {}),
        }
      : null,
    mine: selfId !== null && active !== null && active.ownerId === selfId,
  };
}

export function hasTool(profile: PlayerProfile, kind: ToolKind): boolean {
  return ITEMS.some((i) => i.tool === kind && countItem(profile, i.id) > 0);
}

export type TileActionKind =
  | "chop"
  | "mine"
  | "till"
  | "plant"
  | "harvest"
  | "place_block"
  | "mine_block"
  | "plant_flower"
  | "remove_flower"
  | "toggle_gate"
  | "set_sign"
  | "set_display"
  | "clear_display"
  | "draw_water";

export type TileActionResult =
  | {
      ok: true;
      override: TileOverride | null;
      profile: PlayerProfile;
      view: TileView;
      gained: Record<string, number>;
      broke?: string | null;
    }
  | { ok: false; error: string };

function checkedTile(xRaw: unknown, yRaw: unknown): { x: number; y: number } | null {
  if (typeof xRaw !== "number" || typeof yRaw !== "number") return null;
  if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return null;
  const x = Math.floor(xRaw);
  const y = Math.floor(yRaw);
  if (Math.abs(x) > WORLD_COORD_LIMIT || Math.abs(y) > WORLD_COORD_LIMIT) return null;
  return { x, y };
}

function viewAfter(
  map: TopDownMap,
  overrides: TileOverridesMap,
  key: string,
  next: TileOverride | null,
  x: number,
  y: number,
  now: number,
  selfKey: string,
): TileView {
  const merged = { ...overrides };
  if (next) merged[key] = next;
  else delete merged[key];
  return tileView(map, merged, x, y, now, selfKey);
}

export function applyTileAction(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  action: unknown,
  xRaw: unknown,
  yRaw: unknown,
  seedIdRaw: unknown,
  now: number,
): TileActionResult {
  if (
    action !== "chop" &&
    action !== "mine" &&
    action !== "till" &&
    action !== "plant" &&
    action !== "harvest"
  ) {
    return { ok: false, error: "invalid_action" };
  }
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const overrides: TileOverridesMap = current ? { [key]: current } : {};
  const active = isOverrideActive(current, now) ? current : null;
  const base = mapTileAt(map, x, y);
  const eff = active?.tile !== undefined ? active.tile : base;
  const selfId = presenceIdFor(ownerKey);
  const done = (
    override: TileOverride | null,
    nextProfile: PlayerProfile,
    gained: Record<string, number>,
    broke: string | null = null,
  ): TileActionResult => ({
    ok: true,
    override,
    profile: nextProfile,
    view: viewAfter(map, overrides, key, override, x, y, now, ownerKey),
    gained,
    broke,
  });

  switch (action) {
    case "chop": {
      if (eff !== T_TREE && eff !== T_SNOW_TREE) return { ok: false, error: "tile_blocked" };
      const axe = bestToolItem(profile, "axe");
      const dmg =
        BLOCK_MINE_DAMAGE[
          Math.max(0, Math.min(BLOCK_MINE_DAMAGE.length - 1, bestToolTier(profile, "axe")))
        ];
      const worn = axe ? wearTool(profile, "axe") : { profile, brokeItemId: null };
      const hpNow = Math.min(active?.hp ?? TERRAIN_TREE_HP, TERRAIN_TREE_HP);
      if (hpNow - dmg > 0) {
        const next: TileOverride = {
          ...(active ?? { ownerId: selfId }),
          hp: hpNow - dmg,
          ownerId: selfId,
        };
        return done(next, worn.profile, {}, worn.brokeItemId);
      }
      const count = axe ? CHOP_WOOD_COUNT : CHOP_WOOD_BAREHAND;
      const next: TileOverride = {
        tile: eff === T_SNOW_TREE ? T_SNOW : T_GRASS,
        stump: true,
        ownerId: selfId,
        until: now + TREE_REGROW_MS,
      };
      return done(next, addItem(worn.profile, "wood", count), { wood: count }, worn.brokeItemId);
    }
    case "mine": {
      if (eff !== T_ROCK) return { ok: false, error: "tile_blocked" };
      if (!hasTool(profile, "pickaxe")) return { ok: false, error: "tool_required" };
      const dmg =
        BLOCK_MINE_DAMAGE[
          Math.max(0, Math.min(BLOCK_MINE_DAMAGE.length - 1, bestToolTier(profile, "pickaxe")))
        ];
      const worn = wearTool(profile, "pickaxe");
      const hpNow = Math.min(active?.hp ?? TERRAIN_ROCK_HP, TERRAIN_ROCK_HP);
      if (hpNow - dmg > 0) {
        const next: TileOverride = {
          ...(active ?? { ownerId: selfId }),
          hp: hpNow - dmg,
          ownerId: selfId,
        };
        return done(next, worn.profile, {}, worn.brokeItemId);
      }
      const next: TileOverride = { tile: T_DIRT, ownerId: selfId, until: now + ROCK_REGROW_MS };
      const ivs = tileIvsAt(x, y);
      const stoneCount = MINE_STONE_COUNT + purityBonusStone(ivs.purity);
      const coalCount = purityBonusCoal(ivs.purity);
      let nextProfile = addItem(worn.profile, "stone", stoneCount);
      const gained: Record<string, number> = { stone: stoneCount };
      if (coalCount > 0) {
        nextProfile = addItem(nextProfile, "coal", coalCount);
        gained.coal = coalCount;
      }
      return done(next, nextProfile, gained, worn.brokeItemId);
    }
    case "till": {
      if (eff !== T_GRASS && eff !== T_DIRT) return { ok: false, error: "tile_blocked" };
      if (active?.farmland) return { ok: false, error: "tile_blocked" };
      if (active?.crop) return { ok: false, error: "tile_blocked" };
      if (active?.block) return { ok: false, error: "tile_blocked" };
      if (!hasTool(profile, "hoe")) return { ok: false, error: "tool_required" };
      const worn = wearTool(profile, "hoe");
      const next: TileOverride = {
        ...(active?.tile !== undefined ? { tile: active.tile } : {}),
        farmland: true,
        crop: null,
        ownerId: selfId,
      };
      return done(next, worn.profile, {}, worn.brokeItemId);
    }
    case "plant": {
      if (!active?.farmland || active.crop) return { ok: false, error: "tile_blocked" };
      const cropDef = cropBySeedId(seedIdRaw);
      if (!cropDef) return { ok: false, error: "unknown_seed" };
      const removed = removeItem(profile, cropDef.seedId, 1);
      if (!removed) return { ok: false, error: "not_enough_items" };
      const next: TileOverride = {
        ...active,
        farmland: true,
        crop: {
          cropId: cropDef.id,
          plantedAt: now,
          readyAt:
            now +
            Math.round(
              cropDef.growthMinutes *
                60_000 *
                seasonGrowthMult(cropDef.season, now) *
                fertilityGrowthFactor(tileIvsAt(x, y).fertility),
            ),
        },
        ownerId: selfId,
      };
      return done(next, removed, {});
    }
    case "harvest": {
      const crop = active?.crop ?? null;
      if (!crop) return { ok: false, error: "no_crop" };
      if (active && active.ownerId !== selfId) return { ok: false, error: "not_owner" };
      if (now < crop.readyAt) return { ok: false, error: "not_ready" };
      const cropDef = cropById(crop.cropId);
      if (!cropDef) return { ok: false, error: "no_crop" };
      const next: TileOverride = { ...active, farmland: true, crop: null, ownerId: selfId };
      const total = cropDef.produceCount + fertilityBonusYield(tileIvsAt(x, y).fertility);
      return done(next, addItem(profile, cropDef.produceId, total), { [cropDef.produceId]: total });
    }
  }
}

const PLACEABLE_TERRAIN: ReadonlySet<number> = new Set([T_GRASS, T_DIRT, T_SAND, T_SNOW]);
export const HARD_BLOCK_DURABILITY = 50;

export function blockMineTool(def: ItemDef): ToolKind | null {
  if ((def.durability ?? 0) < HARD_BLOCK_DURABILITY) return null;
  return def.mineTool ?? "pickaxe";
}

export const DEFAULT_BLOCK_HP = 10;
export const BLOCK_MINE_DAMAGE: readonly number[] = [6, 10, 16, 25, 40];

export function blockMaxHp(def: ItemDef): number {
  return def.durability ?? DEFAULT_BLOCK_HP;
}

export function blockHpFraction(block: PlacedBlock): number {
  const def = itemById(block.itemId);
  if (!def) return 1;
  const max = blockMaxHp(def);
  if (max <= 0) return 1;
  const hp = block.hp === undefined ? max : block.hp;
  return Math.max(0, Math.min(1, hp / max));
}

export function bestToolTier(profile: PlayerProfile, kind: ToolKind): number {
  const best = bestToolItem(profile, kind);
  if (!best) return 0;
  return (best.tier ?? 0) + (profile.enhance?.[best.id] ?? 0);
}

export function blockMineDamage(profile: PlayerProfile, def: ItemDef): number {
  const tool = blockMineTool(def);
  const tier = tool
    ? bestToolTier(profile, tool)
    : Math.max(bestToolTier(profile, "axe"), bestToolTier(profile, "pickaxe"));
  const idx = Math.max(0, Math.min(BLOCK_MINE_DAMAGE.length - 1, tier));
  return BLOCK_MINE_DAMAGE[idx];
}

export type PlaceBlockContext = {
  onCapital: boolean;
};

export function applyPlaceBlock(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  itemIdRaw: unknown,
  now: number,
  ctx: PlaceBlockContext,
): TileActionResult {
  const held = itemById(itemIdRaw);
  const def = held?.placesBlock ? itemById(held.placesBlock) : held;
  if (!held || !def || (def.category !== "block" && def.facility !== true)) {
    return { ok: false, error: "unknown_block" };
  }
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  if (ctx.onCapital) return { ok: false, error: "on_capital" };
  const active = isOverrideActive(current, now) ? current : null;
  if (active?.block) return { ok: false, error: "tile_blocked" };
  if (active?.crop) return { ok: false, error: "tile_blocked" };
  if (active?.farmland) return { ok: false, error: "tile_blocked" };
  if (active?.stump) return { ok: false, error: "tile_blocked" };
  const eff = active?.tile !== undefined ? active.tile : mapTileAt(map, x, y);
  const placeable = PLACEABLE_TERRAIN.has(eff) || (def.id === "bridge_block" && eff === T_WATER);
  if (!placeable) return { ok: false, error: "tile_blocked" };
  const removed = removeItem(profile, held.id, 1);
  if (!removed) return { ok: false, error: "not_enough_items" };
  const selfId = presenceIdFor(ownerKey);
  const next: TileOverride = {
    ...(active ?? { ownerId: selfId }),
    block: { itemId: def.id, ownerId: selfId, hp: blockMaxHp(def) },
    ownerId: selfId,
  };
  const overrides: TileOverridesMap = current ? { [key]: current } : {};
  return {
    ok: true,
    override: next,
    profile: removed,
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: {},
  };
}

export type MineBlockContext = {
  containerBreakAllowed?: boolean;
};

export function applyMineBlock(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  now: number,
  ctx: MineBlockContext = {},
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  const block = active?.block;
  if (!active || !block) return { ok: false, error: "no_block" };
  const selfId = presenceIdFor(ownerKey);
  if (block.ownerId !== selfId && !ctx.containerBreakAllowed)
    return { ok: false, error: "not_owner" };
  const def = itemById(block.itemId);
  if (!def) return { ok: false, error: "no_block" };
  const tool = blockMineTool(def);
  if (tool && !hasTool(profile, tool)) return { ok: false, error: "tool_required" };
  const wearKind: ToolKind | null =
    tool ??
    (bestToolItem(profile, "axe") || bestToolItem(profile, "pickaxe")
      ? bestToolTier(profile, "axe") >= bestToolTier(profile, "pickaxe")
        ? "axe"
        : "pickaxe"
      : null);
  const worn = wearKind ? wearTool(profile, wearKind) : { profile, brokeItemId: null };
  const maxHp = blockMaxHp(def);
  const hpNow = Math.min(block.hp ?? maxHp, maxHp);
  const hpNext = hpNow - blockMineDamage(profile, def);
  if (hpNext > 0) {
    const next: TileOverride = { ...active, block: { ...block, hp: hpNext }, ownerId: selfId };
    const overrides: TileOverridesMap = { [key]: active };
    return {
      ok: true,
      override: next,
      profile: worn.profile,
      view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
      gained: {},
      broke: worn.brokeItemId,
    };
  }
  const rest: TileOverride = { ...active, ownerId: selfId };
  delete rest.block;
  delete rest.deco;
  delete rest.signText;
  delete rest.display;
  const empty =
    rest.tile === undefined &&
    rest.farmland !== true &&
    rest.crop === undefined &&
    rest.stump !== true &&
    rest.until === undefined;
  const next = empty ? null : rest;
  const overrides: TileOverridesMap = { [key]: active };
  return {
    ok: true,
    override: next,
    profile: addItem(worn.profile, def.id, 1),
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: { [def.id]: 1 },
    broke: worn.brokeItemId,
  };
}

export const FLOWER_POT_ITEM_IDS: readonly string[] = ["planter", "flower_pot"];

export function isFlowerPotItem(itemId: unknown): boolean {
  return typeof itemId === "string" && FLOWER_POT_ITEM_IDS.includes(itemId);
}

export const SEAT_ITEM_IDS: readonly string[] = ["bench", "chair", "sofa"];

export function isSeatItem(itemId: unknown): boolean {
  return typeof itemId === "string" && SEAT_ITEM_IDS.includes(itemId);
}

export const SIGN_ITEM_IDS: readonly string[] = ["sign_board"];

export function isSignItem(itemId: unknown): boolean {
  return typeof itemId === "string" && SIGN_ITEM_IDS.includes(itemId);
}

export const SIGN_TEXT_MAX = 40;

export function sanitizeSignText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, SIGN_TEXT_MAX);
}

export const SHELF_ITEM_IDS: readonly string[] = ["item_shelf"];

export function isShelfItem(itemId: unknown): boolean {
  return typeof itemId === "string" && SHELF_ITEM_IDS.includes(itemId);
}

export const WELL_ITEM_IDS: readonly string[] = ["well"];

export function isWellItem(itemId: unknown): boolean {
  return typeof itemId === "string" && WELL_ITEM_IDS.includes(itemId);
}

export function applyDrawWater(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  now: number,
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  if (!active?.block || !isWellItem(active.block.itemId)) return { ok: false, error: "no_block" };
  const removed = removeItem(profile, "bucket", 1);
  if (!removed) return { ok: false, error: "not_enough_items" };
  const overrides: TileOverridesMap = { [key]: active };
  return {
    ok: true,
    override: active,
    profile: addItem(removed, "water_bucket", 1),
    view: viewAfter(map, overrides, key, active, x, y, now, ownerKey),
    gained: { water_bucket: 1 },
  };
}

export function applySetSign(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  textRaw: unknown,
  now: number,
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  if (!active?.block || !isSignItem(active.block.itemId)) return { ok: false, error: "no_block" };
  const selfId = presenceIdFor(ownerKey);
  if (active.block.ownerId !== selfId) return { ok: false, error: "not_owner" };
  const text = sanitizeSignText(textRaw);
  const next: TileOverride = { ...active };
  if (text) next.signText = text;
  else delete next.signText;
  const overrides: TileOverridesMap = { [key]: active };
  return {
    ok: true,
    override: next,
    profile,
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: {},
  };
}

export function applyDisplayAction(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  action: "set_display" | "clear_display",
  itemIdRaw: unknown,
  now: number,
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  if (!active?.block || !isShelfItem(active.block.itemId)) return { ok: false, error: "no_block" };
  const selfId = presenceIdFor(ownerKey);
  if (active.block.ownerId !== selfId) return { ok: false, error: "not_owner" };
  const overrides: TileOverridesMap = { [key]: active };
  if (action === "set_display") {
    if (active.display) return { ok: false, error: "tile_blocked" };
    const def = itemById(itemIdRaw);
    if (!def) return { ok: false, error: "unknown_block" };
    const removed = removeItem(profile, def.id, 1);
    if (!removed) return { ok: false, error: "not_enough_items" };
    const next: TileOverride = { ...active, display: def.id };
    return {
      ok: true,
      override: next,
      profile: removed,
      view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
      gained: {},
    };
  }
  if (!active.display) return { ok: false, error: "tile_blocked" };
  const shown = active.display;
  const next: TileOverride = { ...active };
  delete next.display;
  return {
    ok: true,
    override: next,
    profile: addItem(profile, shown, 1),
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: { [shown]: 1 },
  };
}

export const PLANTABLE_DECO_ID = "flower";

export function applyFlowerAction(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  action: "plant_flower" | "remove_flower",
  now: number,
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  const block = active?.block;
  if (!active || !block || !isFlowerPotItem(block.itemId)) return { ok: false, error: "no_block" };
  const selfId = presenceIdFor(ownerKey);
  if (block.ownerId !== selfId) return { ok: false, error: "not_owner" };
  const overrides: TileOverridesMap = { [key]: active };
  if (action === "plant_flower") {
    if (active.deco) return { ok: false, error: "tile_blocked" };
    const removed = removeItem(profile, PLANTABLE_DECO_ID, 1);
    if (!removed) return { ok: false, error: "not_enough_items" };
    const next: TileOverride = { ...active, deco: PLANTABLE_DECO_ID };
    return {
      ok: true,
      override: next,
      profile: removed,
      view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
      gained: {},
    };
  }
  if (!active.deco) return { ok: false, error: "tile_blocked" };
  const next: TileOverride = { ...active };
  delete next.deco;
  return {
    ok: true,
    override: next,
    profile: addItem(profile, PLANTABLE_DECO_ID, 1),
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: { [PLANTABLE_DECO_ID]: 1 },
  };
}

export function applyToggleGate(
  current: TileOverride | null,
  profile: PlayerProfile,
  map: TopDownMap,
  ownerKey: string,
  xRaw: unknown,
  yRaw: unknown,
  now: number,
): TileActionResult {
  const tile = checkedTile(xRaw, yRaw);
  if (!tile) return { ok: false, error: "invalid_tile" };
  const { x, y } = tile;
  const key = tileKey(x, y);
  const active = isOverrideActive(current, now) ? current : null;
  if (!active?.block || !isGateItem(active.block.itemId)) return { ok: false, error: "no_block" };
  const next: TileOverride = { ...active, gateOpen: active.gateOpen !== true };
  const overrides: TileOverridesMap = { [key]: active };
  return {
    ok: true,
    override: next,
    profile,
    view: viewAfter(map, overrides, key, next, x, y, now, ownerKey),
    gained: {},
  };
}

function parseCropState(raw: unknown): CropState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const def = cropById(v.cropId);
  if (!def) return null;
  if (typeof v.plantedAt !== "number" || !Number.isFinite(v.plantedAt)) return null;
  if (typeof v.readyAt !== "number" || !Number.isFinite(v.readyAt)) return null;
  return { cropId: def.id, plantedAt: v.plantedAt, readyAt: v.readyAt };
}

function parsePlacedBlock(raw: unknown): PlacedBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const def = itemById(v.itemId);
  if (!def || (def.category !== "block" && def.facility !== true)) return null;
  if (typeof v.ownerId !== "string" || v.ownerId.length === 0) return null;
  const out: PlacedBlock = { itemId: def.id, ownerId: v.ownerId };
  if (typeof v.hp === "number" && Number.isFinite(v.hp) && v.hp > 0) {
    out.hp = Math.floor(v.hp);
  }
  return out;
}

export function parseTileOverride(raw: unknown): TileOverride | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data as Record<string, unknown>;
  if (typeof v.ownerId !== "string" || v.ownerId.length === 0) return null;
  const out: TileOverride = { ownerId: v.ownerId };
  if (
    typeof v.tile === "number" &&
    Number.isFinite(v.tile) &&
    v.tile >= 0 &&
    v.tile <= T_SNOW_TREE
  ) {
    out.tile = Math.floor(v.tile);
  }
  if (v.farmland === true) out.farmland = true;
  if (v.stump === true) out.stump = true;
  if (v.block !== undefined) {
    const block = parsePlacedBlock(v.block);
    if (block) out.block = block;
  }
  if (v.crop === null) out.crop = null;
  else if (v.crop !== undefined) {
    const crop = parseCropState(v.crop);
    if (crop) out.crop = crop;
  }
  if (v.deco === "flower") out.deco = "flower";
  if (v.gateOpen === true) out.gateOpen = true;
  if (typeof v.signText === "string") {
    const text = sanitizeSignText(v.signText);
    if (text) out.signText = text;
  }
  if (typeof v.display === "string" && itemById(v.display)) out.display = v.display;
  if (typeof v.hp === "number" && Number.isFinite(v.hp) && v.hp > 0) out.hp = Math.floor(v.hp);
  if (typeof v.until === "number" && Number.isFinite(v.until)) out.until = v.until;
  return out;
}

export function parseTileOverrides(rows: ReadonlyMap<string, unknown>): TileOverridesMap {
  const out: TileOverridesMap = {};
  for (const [key, raw] of rows) {
    if (!parseTileKey(key)) continue;
    const ov = parseTileOverride(raw);
    if (ov) out[key] = ov;
  }
  return out;
}

export type TileContextAction =
  | { action: TileActionKind; seedId?: string; itemId?: string }
  | { action: "plant-picker" }
  | null;

export function actionForTile(
  view: TileView,
  selected: { tool?: ToolKind; seedId?: string; blockId?: string } | null,
): TileContextAction {
  if (view.crop?.ready) return { action: "harvest" };
  if (view.block) {
    const miningTool = selected?.tool === "axe" || selected?.tool === "pickaxe";
    if (isGateItem(view.block.itemId) && !(view.block.mine && miningTool))
      return { action: "toggle_gate" };
    if (view.block.mine && miningTool) return { action: "mine_block" };
    return null;
  }
  if (view.farmland && !view.crop) {
    if (selected?.seedId) return { action: "plant", seedId: selected.seedId };
    return { action: "plant-picker" };
  }
  if (view.crop) return null;
  if (selected?.blockId && !view.farmland && !view.stump) {
    if (
      PLACEABLE_TERRAIN.has(view.tile) ||
      (selected.blockId === "bridge_block" && view.tile === T_WATER)
    ) {
      return { action: "place_block", itemId: selected.blockId };
    }
  }
  if (view.tile === T_TREE || view.tile === T_SNOW_TREE) return { action: "chop" };
  const tool = selected?.tool;
  if (!tool) return null;
  if (view.tile === T_ROCK && tool === "pickaxe") return { action: "mine" };
  if ((view.tile === T_GRASS || view.tile === T_DIRT) && !view.farmland && tool === "hoe") {
    return { action: "till" };
  }
  return null;
}
