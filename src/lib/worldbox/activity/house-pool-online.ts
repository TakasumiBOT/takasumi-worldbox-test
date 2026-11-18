import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { withUserLock } from "../core/user-lock";
import {
  applyHousePoolYield,
  emptyHousePoolState,
  parseHousePoolState,
  type HousePoolState,
} from "./house-pool";

export const WORLDBOX_HOUSE_POOL_NAMESPACE = "worldbox_house_pool";
const HOUSE_POOL_KEY = "pool_v1";

export function isHousePoolEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadHousePoolState(): Promise<HousePoolState> {
  if (!isBotApiConfigured()) return emptyHousePoolState();
  try {
    const raw = await kvGet(WORLDBOX_HOUSE_POOL_NAMESPACE, HOUSE_POOL_KEY);
    return parseHousePoolState(raw);
  } catch {
    return emptyHousePoolState();
  }
}

export async function storeHousePoolState(state: HousePoolState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_HOUSE_POOL_NAMESPACE, HOUSE_POOL_KEY, state);
    return true;
  } catch {
    return false;
  }
}

export async function creditHousePoolYield(deltaWbc: number): Promise<void> {
  if (!isBotApiConfigured() || !Number.isInteger(deltaWbc) || deltaWbc === 0) return;
  try {
    await withUserLock("house_pool:global", async () => {
      const state = await loadHousePoolState();
      await storeHousePoolState(applyHousePoolYield(state, deltaWbc));
    });
  } catch {
    /* best effort */
  }
}
