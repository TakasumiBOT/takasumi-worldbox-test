import { isBotApiConfigured, kvDelete, kvGet, kvSet } from "../../bot-api";
import { parseStall, serializeStall, type StallState } from "./stalls";
import { tileKey } from "../world/tiles";

export const WORLDBOX_STALLS_NAMESPACE = "worldbox_stalls";

export function isStallsEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadStall(x: number, y: number): Promise<StallState | null> {
  if (!isBotApiConfigured()) return null;
  try {
    return parseStall(await kvGet(WORLDBOX_STALLS_NAMESPACE, tileKey(x, y)));
  } catch {
    return null;
  }
}

export async function storeStall(x: number, y: number, state: StallState | null): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    if (state === null) {
      await kvDelete(WORLDBOX_STALLS_NAMESPACE, tileKey(x, y));
    } else {
      await kvSet(WORLDBOX_STALLS_NAMESPACE, tileKey(x, y), serializeStall(state));
    }
    return true;
  } catch {
    return false;
  }
}
