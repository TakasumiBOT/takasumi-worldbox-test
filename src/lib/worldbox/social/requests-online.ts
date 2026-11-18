import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import {
  emptyRequestsState,
  parseRequestsState,
  serializeRequestsState,
  type RequestsState,
} from "./requests";

export const WORLDBOX_REQUESTS_NAMESPACE = "worldbox_requests";
const REQUESTS_KEY = "requests";

export function isRequestsEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadRequestsState(): Promise<RequestsState> {
  if (!isBotApiConfigured()) return emptyRequestsState();
  try {
    const raw = await kvGet(WORLDBOX_REQUESTS_NAMESPACE, REQUESTS_KEY);
    return parseRequestsState(raw);
  } catch {
    return emptyRequestsState();
  }
}

export async function storeRequestsState(state: RequestsState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_REQUESTS_NAMESPACE, REQUESTS_KEY, serializeRequestsState(state));
    return true;
  } catch {
    return false;
  }
}
