import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { parseBoardPosts, type BoardPost } from "./board";

export const WORLDBOX_BOARD_NAMESPACE = "worldbox_board";
const BOARD_KEY = "messages";

export function isBoardEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadBoardPosts(): Promise<BoardPost[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const raw = await kvGet(WORLDBOX_BOARD_NAMESPACE, BOARD_KEY);
    return parseBoardPosts(raw);
  } catch {
    return [];
  }
}

export async function storeBoardPosts(posts: readonly BoardPost[]): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_BOARD_NAMESPACE, BOARD_KEY, JSON.stringify(posts));
    return true;
  } catch {
    return false;
  }
}
