import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { emptyFxState, parseFxState, type FxMarketState } from "./fx";

export const WORLDBOX_FX_NAMESPACE = "worldbox_fx";
const FX_STATE_KEY = "fx_v1";

export function isFxEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadFxState(): Promise<FxMarketState> {
  if (!isBotApiConfigured()) return emptyFxState();
  try {
    const raw = await kvGet(WORLDBOX_FX_NAMESPACE, FX_STATE_KEY);
    return parseFxState(raw);
  } catch {
    return emptyFxState();
  }
}

export async function storeFxState(state: FxMarketState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_FX_NAMESPACE, FX_STATE_KEY, state);
    return true;
  } catch {
    return false;
  }
}
