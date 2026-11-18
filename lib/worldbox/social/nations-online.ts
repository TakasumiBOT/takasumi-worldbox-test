import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import {
  NATIONS_STATE_VERSION,
  emptyNationsState,
  parseNationsState,
  type NationsState,
} from "./nations";

export const WORLDBOX_NATIONS_NAMESPACE = "worldbox_nations";
const NATIONS_KEY = "nations";
const MEMBERS_KEY = "members";

export function isNationsEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadNationsState(): Promise<NationsState> {
  if (!isBotApiConfigured()) return emptyNationsState();
  try {
    const [nations, members] = await Promise.all([
      kvGet(WORLDBOX_NATIONS_NAMESPACE, NATIONS_KEY),
      kvGet(WORLDBOX_NATIONS_NAMESPACE, MEMBERS_KEY),
    ]);
    return parseNationsState(nations, members);
  } catch {
    return emptyNationsState();
  }
}

export async function storeNationsState(state: NationsState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(
      WORLDBOX_NATIONS_NAMESPACE,
      NATIONS_KEY,
      JSON.stringify({ v: NATIONS_STATE_VERSION, nations: state.nations }),
    );
    await kvSet(WORLDBOX_NATIONS_NAMESPACE, MEMBERS_KEY, JSON.stringify(state.members));
    return true;
  } catch {
    return false;
  }
}
