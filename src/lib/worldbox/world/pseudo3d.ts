import type { VehicleItemId } from "../player/vehicles";
import type { BuildingFacing, SettlementBuildingKind } from "./settlements";

export interface VehicleSpriteMeta {
  dirSheetSrc: string;
  sliceAtlasSrc: string;
  sirenAltSliceAtlasSrc?: string;
  cellSize: number;
  dirs: number;
  dirRows: number;
  sliceW: number;
  sliceH: number;
  sliceCount: number;
  atlasCols: number;
  atlasRows: number;
  drawScaleTiles: number;
  avatarOffsetTiles: number;
}

export const VEHICLE_SPRITE_META: Readonly<Record<VehicleItemId, VehicleSpriteMeta>> = {
  electric_scooter: {
    dirSheetSrc: "/img/worldbox/vehicles/electric_scooter_16dir.webp",
    sliceAtlasSrc: "/img/worldbox/vehicles/electric_scooter_slices.webp",
    cellSize: 64,
    dirs: 16,
    dirRows: 1,
    sliceW: 72,
    sliceH: 72,
    sliceCount: 42,
    atlasCols: 7,
    atlasRows: 6,
    drawScaleTiles: 1.35,
    avatarOffsetTiles: -0.22,
  },
  delivery_moped: {
    dirSheetSrc: "/img/worldbox/vehicles/delivery_moped_16dir.webp",
    sliceAtlasSrc: "/img/worldbox/vehicles/delivery_moped_slices.webp",
    cellSize: 64,
    dirs: 16,
    dirRows: 1,
    sliceW: 72,
    sliceH: 72,
    sliceCount: 42,
    atlasCols: 7,
    atlasRows: 6,
    drawScaleTiles: 1.45,
    avatarOffsetTiles: -0.26,
  },
  cargo_truck: {
    dirSheetSrc: "/img/worldbox/vehicles/cargo_truck_16dir.webp",
    sliceAtlasSrc: "/img/worldbox/vehicles/cargo_truck_slices.webp",
    cellSize: 64,
    dirs: 16,
    dirRows: 1,
    sliceW: 72,
    sliceH: 72,
    sliceCount: 42,
    atlasCols: 7,
    atlasRows: 6,
    drawScaleTiles: 1.68,
    avatarOffsetTiles: -0.38,
  },
  police_cruiser: {
    dirSheetSrc: "/img/worldbox/vehicles/police_cruiser_16dir.webp",
    sliceAtlasSrc: "/img/worldbox/vehicles/police_cruiser_slices.webp",
    sirenAltSliceAtlasSrc: "/img/worldbox/vehicles/police_cruiser_siren2_slices.webp",
    cellSize: 64,
    dirs: 16,
    dirRows: 2,
    sliceW: 72,
    sliceH: 72,
    sliceCount: 42,
    atlasCols: 7,
    atlasRows: 6,
    drawScaleTiles: 1.62,
    avatarOffsetTiles: -0.34,
  },
};

export const HORSE_COAT_SLUGS: Readonly<Record<string, string>> = {
  鹿毛: "bay",
  栗毛: "chestnut",
  黒鹿毛: "dark_bay",
  芦毛: "grey",
  青鹿毛: "brown",
  青毛: "black",
  栃栗毛: "liver_chestnut",
  白毛: "white",
};

export const HORSE_SPRITE_META = {
  cellSize: 56,
  dirs: 16,
  frames: 4,
  drawScaleTiles: 1.18,
} as const;

export function horseSpriteSrcForCoat(coat: string): string {
  const slug = HORSE_COAT_SLUGS[coat] ?? "bay";
  return `/img/worldbox/racing/horse_${slug}_16dir.webp`;
}

export const BUILDING_SPRITE_METRICS = {
  pixelsPerTile: 28,
  sideMarginPx: 4,
  topOverhangPx: 56,
  bottomMarginPx: 4,
} as const;

export const BUILDING_KINDS: readonly SettlementBuildingKind[] = [
  "city_hall",
  "vehicle_dealer",
  "convenience",
  "cafe",
  "bank_kiosk",
  "smith_workshop",
  "house",
  "cottage",
];

export const BUILDING_FACINGS: readonly BuildingFacing[] = ["s", "n", "e", "w"];

export function buildingSpriteKey(kind: SettlementBuildingKind, facing: BuildingFacing): string {
  return `${kind}_${facing}`;
}

export function buildingSpriteSrc(kind: SettlementBuildingKind, facing: BuildingFacing): string {
  return `/img/worldbox/buildings/${kind}_${facing}.webp`;
}

export function computeBuildingDrawRect(
  bx: number,
  by: number,
  bw: number,
  bh: number,
  tilePx: number,
  imgW: number,
  imgH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = tilePx / BUILDING_SPRITE_METRICS.pixelsPerTile;
  const w = imgW * scale;
  const h = imgH * scale;
  const x = bx - BUILDING_SPRITE_METRICS.sideMarginPx * scale;
  const y = by + bh + BUILDING_SPRITE_METRICS.bottomMarginPx * scale - h;
  return { x, y, w, h };
}

export const SURFACE_OBJECT_COLS: Readonly<Record<string, number>> = {
  berry_bush: 0,
  herb_patch: 1,
  mushroom_patch: 2,
  flower_meadow: 3,
  beehive: 4,
  bird_nest: 5,
  copper_vein: 6,
  coal_vein: 7,
  rare_vein: 8,
  crystal_cluster: 9,
  mithril_vein: 10,
  sulfur_vent: 11,
  ruins_chest: 12,
  cave_chest: 13,
  dungeon_chest: 14,
  hot_spring: 15,
  ancient_pillar: 16,
  fallen_log: 17,
  driftwood: 18,
  gold_door: 19,
};

export const WORLD_PROP_COLS: Readonly<Record<string, number>> = {
  lamp_day: 0,
  lamp_night: 1,
  cave_entrance: 2,
  dungeon_entrance: 3,
  ruins_entrance: 4,
  abandoned_camp: 5,
  ancient_shrine: 6,
  watchtower_ruins: 7,
  sunken_ruins: 8,
};

export const SURFACE_OBJECT_ATLAS_SRC = "/img/worldbox/objects/surface_objects.webp";
export const WORLD_PROP_ATLAS_SRC = "/img/worldbox/objects/world_props.webp";

/** Convert screen/map velocity or direction vector `(dx, dy)` to [0..360) degrees (0=East, 90=South). */
export function vectorHeadingDeg(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Snap an arbitrary heading in degrees [0..360) to the nearest 16-direction sprite index (0..15). */
export function directionIndex16(headingDeg: number): number {
  const norm = ((headingDeg % 360) + 360) % 360;
  return Math.round(norm / 22.5) % 16;
}
