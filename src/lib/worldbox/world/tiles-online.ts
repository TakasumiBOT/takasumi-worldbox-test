import { isBotApiConfigured, kvDelete, kvGet, kvList, kvSet } from "../../bot-api";
import {
  parseTileOverride,
  parseTileOverrides,
  tileKey,
  type TileOverride,
  type TileOverridesMap,
} from "./tiles";

export const WORLDBOX_TILES_NAMESPACE = "worldbox_tiles";

export function isTilesEnabled(): boolean {
  return isBotApiConfigured();
}

async function scanTileOverrides(): Promise<TileOverridesMap> {
  try {
    return parseTileOverrides(await kvList(WORLDBOX_TILES_NAMESPACE));
  } catch {
    return {};
  }
}

const OVERRIDES_CACHE_TTL_MS = 3_000;
let overridesCache: { at: number; map: TileOverridesMap } | null = null;
let overridesEpoch = 0;

export async function loadTileOverrides(): Promise<TileOverridesMap> {
  if (!isBotApiConfigured()) return {};
  if (overridesCache && Date.now() - overridesCache.at < OVERRIDES_CACHE_TTL_MS) {
    return overridesCache.map;
  }
  const epochBefore = overridesEpoch;
  const map = await scanTileOverrides();
  if (overridesEpoch !== epochBefore) {
    if (!overridesCache) return map;
    const merged = { ...map, ...overridesCache.map };
    overridesCache = { at: Date.now(), map: merged };
    return merged;
  }
  overridesCache = { at: Date.now(), map };
  return map;
}

export async function loadTileOverride(x: number, y: number): Promise<TileOverride | null> {
  if (!isBotApiConfigured()) return null;
  try {
    return parseTileOverride(await kvGet(WORLDBOX_TILES_NAMESPACE, tileKey(x, y)));
  } catch {
    return null;
  }
}

export async function storeTileOverride(
  x: number,
  y: number,
  override: TileOverride | null,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    if (override === null) await kvDelete(WORLDBOX_TILES_NAMESPACE, tileKey(x, y));
    else await kvSet(WORLDBOX_TILES_NAMESPACE, tileKey(x, y), JSON.stringify(override));
    overridesEpoch += 1;
    if (overridesCache) {
      const key = tileKey(x, y);
      if (override === null) delete overridesCache.map[key];
      else overridesCache.map[key] = override;
    }
    return true;
  } catch {
    return false;
  }
}
