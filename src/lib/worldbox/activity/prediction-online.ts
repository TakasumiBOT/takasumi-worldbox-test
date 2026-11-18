import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import {
  emptyPredictionState,
  parsePredictionState,
  type PredictionMarketState,
} from "./prediction";

export const WORLDBOX_PREDICTION_NAMESPACE = "worldbox_prediction";
const PREDICTION_KEY = "prediction_v1";

export function isPredictionEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadPredictionState(): Promise<PredictionMarketState> {
  if (!isBotApiConfigured()) return emptyPredictionState();
  try {
    const raw = await kvGet(WORLDBOX_PREDICTION_NAMESPACE, PREDICTION_KEY);
    return parsePredictionState(raw);
  } catch {
    return emptyPredictionState();
  }
}

export async function storePredictionState(state: PredictionMarketState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_PREDICTION_NAMESPACE, PREDICTION_KEY, state);
    return true;
  } catch {
    return false;
  }
}
