import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import {
  parseChatMessage,
  parseUnionChatSettings,
  pruneChatMessages,
  type ChatChannel,
  type ChatMessage,
  type UnionChatSettings,
} from "./chat";
import { withUserLock } from "../core/user-lock";

export const WORLDBOX_CHAT_NAMESPACE = "worldbox_chat";
export const WORLDBOX_UNION_BOARD_NAMESPACE = "worldbox_union_board";
export const WORLDBOX_UNION_SETTINGS_NAMESPACE = "worldbox_union_settings";
export const WORLDBOX_CHAT_OUTBOX_NAMESPACE = "worldbox_chat_outbox";

export function isChatEnabled(): boolean {
  return isBotApiConfigured();
}

function listKey(channel: ChatChannel, space: string, guildId?: string): string {
  if (channel === "union") return `union:${guildId ?? ""}`;
  return `${channel}:${space}`;
}

function namespaceFor(channel: ChatChannel): string {
  return channel === "union" ? WORLDBOX_UNION_BOARD_NAMESPACE : WORLDBOX_CHAT_NAMESPACE;
}

async function loadList(channel: ChatChannel, key: string): Promise<ChatMessage[]> {
  try {
    const raw = await kvGet(namespaceFor(channel), key);
    if (raw === null) return [];
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => parseChatMessage(m)).filter((m): m is ChatMessage => m !== null);
  } catch {
    return [];
  }
}

async function storeList(
  channel: ChatChannel,
  key: string,
  messages: ChatMessage[],
): Promise<boolean> {
  try {
    await kvSet(namespaceFor(channel), key, JSON.stringify(messages));
    return true;
  } catch {
    return false;
  }
}

export async function loadChatMessages(
  channel: ChatChannel,
  space: string,
  guildId?: string,
): Promise<ChatMessage[]> {
  const key = listKey(channel, space, guildId);
  const all = await loadList(channel, key);
  return pruneChatMessages(all, channel, Date.now());
}

export async function appendChatMessage(message: ChatMessage): Promise<boolean> {
  const key = listKey(message.channel, message.space, message.guildId);
  return withUserLock(`chat-list:${namespaceFor(message.channel)}:${key}`, async () => {
    const all = await loadList(message.channel, key);
    const next = pruneChatMessages([...all, message], message.channel, message.at);
    return storeList(message.channel, key, next);
  });
}

export type { UnionChatSettings } from "./chat";

export async function loadUnionChatSettings(guildId: string): Promise<UnionChatSettings> {
  try {
    const raw = await kvGet(WORLDBOX_UNION_SETTINGS_NAMESPACE, guildId);
    if (raw === null) return { mode: "none", channelId: null, updatedAt: 0 };
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parseUnionChatSettings(parsed);
  } catch {
    return { mode: "none", channelId: null, updatedAt: 0 };
  }
}

export async function storeUnionChatSettings(
  guildId: string,
  settings: Pick<UnionChatSettings, "mode" | "channelId">,
): Promise<boolean> {
  try {
    const full: UnionChatSettings = { ...settings, updatedAt: Date.now() };
    await kvSet(WORLDBOX_UNION_SETTINGS_NAMESPACE, guildId, JSON.stringify(full));
    return true;
  } catch {
    return false;
  }
}

export type ChatOutboxEntry = {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  text: string;
  at: number;
  status: "pending" | "sent";
};

export async function enqueueChatOutbox(entry: ChatOutboxEntry): Promise<boolean> {
  try {
    await kvSet(WORLDBOX_CHAT_OUTBOX_NAMESPACE, entry.id, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}
