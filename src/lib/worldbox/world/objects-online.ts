import { isBotApiConfigured, kvGet, kvList, kvSet } from "../../bot-api";
import { parseObjectStates } from "./objects";

export const WORLDBOX_OBJECTS_NAMESPACE = "worldbox_objects";

export function isObjectsEnabled(): boolean {
  return isBotApiConfigured();
}

const STATES_CACHE_TTL_MS = 3_000;
let statesCache: { at: number; map: Record<string, number> } | null = null;
let statesEpoch = 0;

export async function loadObjectStates(): Promise<Record<string, number>> {
  if (!isBotApiConfigured()) return {};
  if (statesCache && Date.now() - statesCache.at < STATES_CACHE_TTL_MS) {
    return statesCache.map;
  }
  const epochBefore = statesEpoch;
  let scanned: Record<string, number> = {};
  try {
    scanned = parseObjectStates(await kvList(WORLDBOX_OBJECTS_NAMESPACE));
  } catch {
    return statesCache?.map ?? {};
  }
  if (statesEpoch !== epochBefore) {
    if (!statesCache) return scanned;
    const merged = { ...scanned, ...statesCache.map };
    statesCache = { at: Date.now(), map: merged };
    return merged;
  }
  statesCache = { at: Date.now(), map: scanned };
  return scanned;
}

export async function loadHarvestedAt(x: number, y: number): Promise<number | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_OBJECTS_NAMESPACE, `${x},${y}`);
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function storeHarvestedAt(x: number, y: number, at: number): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_OBJECTS_NAMESPACE, `${x},${y}`, String(at));
    statesEpoch += 1;
    if (statesCache) statesCache.map[`${x},${y}`] = at;
    return true;
  } catch {
    return false;
  }
}
