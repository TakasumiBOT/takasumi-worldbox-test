import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { parsePorter, type UnionPorter } from "./warp";

export const WORLDBOX_WARP_NAMESPACE = "worldbox_warp";

export function isWarpEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadPorter(guildId: string): Promise<UnionPorter | null> {
  if (!isBotApiConfigured()) return null;
  try {
    return parsePorter(await kvGet(WORLDBOX_WARP_NAMESPACE, guildId));
  } catch {
    return null;
  }
}

export async function storePorter(guildId: string, porter: UnionPorter): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_WARP_NAMESPACE, guildId, JSON.stringify(porter));
    return true;
  } catch {
    return false;
  }
}
