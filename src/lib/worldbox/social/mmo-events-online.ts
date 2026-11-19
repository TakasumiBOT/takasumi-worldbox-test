import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { parseQuestState, type MmoNewsItem, type PlayerQuestState } from "./mmo-events";

export const WORLDBOX_FEED_NAMESPACE = "worldbox_mmo_feed";
export const WORLDBOX_QUESTS_NAMESPACE = "worldbox_quests";

const FEED_KEY = "news_v1";
const MAX_NEWS_ITEMS = 30;

export async function loadMmoNewsFeed(): Promise<MmoNewsItem[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const raw = await kvGet(WORLDBOX_FEED_NAMESPACE, FEED_KEY);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MmoNewsItem =>
        !!x && typeof x === "object" && typeof x.id === "string" && typeof x.text === "string",
    );
  } catch {
    return [];
  }
}

export async function pushMmoNews(
  kind: MmoNewsItem["kind"],
  text: string,
  now = Date.now(),
): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    const cur = await loadMmoNewsFeed();
    const entry: MmoNewsItem = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      at: now,
      kind,
      text: text.slice(0, 140),
    };
    const next = [entry, ...cur].slice(0, MAX_NEWS_ITEMS);
    await kvSet(WORLDBOX_FEED_NAMESPACE, FEED_KEY, JSON.stringify(next));
  } catch {
    /* non-critical news log */
  }
}

export async function loadPlayerQuests(ownerKey: string, now: number): Promise<PlayerQuestState> {
  if (!isBotApiConfigured()) return parseQuestState(null, now);
  try {
    const raw = await kvGet(WORLDBOX_QUESTS_NAMESPACE, `q:${ownerKey}`);
    return parseQuestState(typeof raw === "string" ? JSON.parse(raw) : raw, now);
  } catch {
    return parseQuestState(null, now);
  }
}

export async function storePlayerQuests(ownerKey: string, state: PlayerQuestState): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvSet(WORLDBOX_QUESTS_NAMESPACE, `q:${ownerKey}`, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

export async function incrementQuestProgress(
  ownerKey: string,
  missionId: string,
  amount = 1,
  now = Date.now(),
): Promise<void> {
  const cur = await loadPlayerQuests(ownerKey, now);
  cur.progress[missionId] = (cur.progress[missionId] ?? 0) + amount;
  await storePlayerQuests(ownerKey, cur);
}
