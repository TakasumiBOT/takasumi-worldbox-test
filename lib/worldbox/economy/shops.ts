import { ITEMS, itemById, type ItemCategory, type ItemDef } from "./items";

export type ShopGenreId = "tools" | "blocks" | "furniture" | "food" | "farm" | "smith";

export type ShopGenre = {
  id: ShopGenreId;
  name: string;
  categories: readonly ItemCategory[];
};

export const SHOP_GENRES: readonly ShopGenre[] = [
  { id: "tools", name: "ホームセンター", categories: ["tool"] },
  { id: "blocks", name: "建材店", categories: ["block"] },
  { id: "furniture", name: "インテリア店", categories: ["furniture"] },
  { id: "food", name: "コンビニ", categories: ["food", "crop"] },
  { id: "farm", name: "資材店", categories: ["seed", "material"] },
  { id: "smith", name: "製造・R&D拠点", categories: ["crafted", "special"] },
];

const GENRE_BY_ID = new Map<string, ShopGenre>(SHOP_GENRES.map((g) => [g.id, g]));
const GENRE_BY_CATEGORY = new Map<ItemCategory, ShopGenre>(
  SHOP_GENRES.flatMap((g) => g.categories.map((c) => [c, g] as const)),
);

export function genreById(id: unknown): ShopGenre | null {
  return typeof id === "string" ? (GENRE_BY_ID.get(id) ?? null) : null;
}

export function genreForCategory(category: ItemCategory): ShopGenre | null {
  return GENRE_BY_CATEGORY.get(category) ?? null;
}

export function genreOfItem(itemId: unknown): ShopGenreId | null {
  const item = itemById(itemId);
  if (!item) return null;
  return genreForCategory(item.category)?.id ?? null;
}

const SHOP_STOCK_IDS: ReadonlySet<string> = new Set([
  "wooden_axe",
  "wooden_pickaxe",
  "wooden_hoe",
  "stone_axe",
  "stone_pickaxe",
  "stone_hoe",
  "iron_axe",
  "iron_pickaxe",
  "iron_hoe",
  "explorer_compass",
  "dirt_block",
  "sand_block",
  "snow_block",
  "mud_block",
  "grass_block",
  "gravel_block",
  "moss_block",
  "clay_block",
  "packed_snow_block",
  "ice_block",
  "leaves_block",
  "path_block",
  "forest_floor_block",
  "cactus_block",
  "flower_block",
  "oak_log",
  "pine_log",
  "birch_log",
  "sakura_log",
  "dark_log",
  "autumn_log",
  "dead_log",
  "log_block",
  "torch",
  "workbench",
  "furnace",
  "storage_chest",
  "chest_box",
  "bed",
  "onigiri",
  "energy_drink",
  "meal",
  "cake",
  "bento",
  "feast",
  "wood",
  "stone",
  "stick",
  "clay",
  "glass",
  "paper",
  "bamboo",
  "charcoal",
  "sugar",
  "iron_ingot",
  "copper_ingot",
  "salt",
]);

export function isShopExcluded(item: ItemDef): boolean {
  if (item.category === "seed") return false;
  return !SHOP_STOCK_IDS.has(item.id);
}

export function itemsForGenre(genreId: ShopGenreId): ItemDef[] {
  return ITEMS.filter((item) => genreOfItem(item.id) === genreId && !isShopExcluded(item));
}

export function checkBuyGenre(shopGenre: ShopGenreId | null, itemId: unknown): "wrong_shop" | null {
  if (shopGenre === null) return null;
  const itemGenre = genreOfItem(itemId);
  if (itemGenre === null) return null;
  return itemGenre === shopGenre ? null : "wrong_shop";
}

export function checkBuySold(itemId: unknown): "not_sold" | null {
  const item = itemById(itemId);
  if (!item) return null;
  return isShopExcluded(item) ? "not_sold" : null;
}

export function shopDayKeyOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function shopHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailyPriceFor(item: ItemDef, dayKey: string): number {
  const step = (shopHash(`${dayKey}:${item.id}`) % 5) - 2;
  return Math.max(1, Math.round(item.price * (1 + step * 0.05)));
}

export function dailyStockForGenre(genreId: ShopGenreId, dayKey: string): ItemDef[] {
  const all = itemsForGenre(genreId);
  if (all.length <= 8) return all;
  const window = Math.ceil(all.length * 0.75);
  const offset = shopHash(`${dayKey}:stock:${genreId}`) % all.length;
  const out: ItemDef[] = [];
  for (let i = 0; i < window; i++) out.push(all[(offset + i) % all.length]);
  return out;
}

export function checkDailyStock(
  genreId: ShopGenreId | null,
  itemId: unknown,
  dayKey: string,
): "not_sold" | null {
  if (genreId === null) return null;
  if (typeof itemId !== "string") return null;
  return dailyStockForGenre(genreId, dayKey).some((i) => i.id === itemId) ? null : "not_sold";
}
