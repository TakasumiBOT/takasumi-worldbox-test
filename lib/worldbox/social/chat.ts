export type ChatChannel = "proximity" | "global" | "union";

export const CHAT_TEXT_MAX = 120;
export const CHAT_NAME_MAX = 24;
export const CHAT_PROXIMITY_RANGE = 12;
export const CHAT_PROXIMITY_TTL_MS = 60_000;
export const CHAT_GLOBAL_TTL_MS = 300_000;
export const CHAT_UNION_TTL_MS = 24 * 60 * 60_000;
export const CHAT_MAX_MESSAGES = 50;
export const CHAT_MIN_INTERVAL_MS = 1_500;

export type ChatMessage = {
  id: string;
  channel: ChatChannel;
  name: string;
  text: string;
  at: number;
  x: number;
  y: number;
  space: string;
  guildId?: string;
  source?: "discord";
};

export type UnionChatMode = "global" | "channel" | "none";

export type UnionChatSettings = {
  mode: UnionChatMode;
  channelId: string | null;
  updatedAt: number;
};

const CHANNEL_ID_RE = /^\d{17,20}$/;

export function parseUnionChatSettings(raw: unknown): UnionChatSettings {
  const fallback: UnionChatSettings = { mode: "none", channelId: null, updatedAt: 0 };
  if (!raw || typeof raw !== "object") return fallback;
  const v = raw as Record<string, unknown>;
  const updatedAt =
    typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0;
  if (v.mode === "global" || v.mode === "none") {
    return { mode: v.mode, channelId: null, updatedAt };
  }
  if (v.mode === "channel") {
    return typeof v.channelId === "string" && CHANNEL_ID_RE.test(v.channelId)
      ? { mode: "channel", channelId: v.channelId, updatedAt }
      : fallback;
  }
  if (typeof v.chatChannelId === "string" && CHANNEL_ID_RE.test(v.chatChannelId)) {
    return { mode: "channel", channelId: v.chatChannelId, updatedAt };
  }
  return fallback;
}

export function isChatChannel(raw: unknown): raw is ChatChannel {
  return raw === "proximity" || raw === "global" || raw === "union";
}

export function sanitizeChatText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (text.length === 0 || text.length > CHAT_TEXT_MAX) return null;
  return text;
}

export function sanitizeChatName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, CHAT_NAME_MAX);
}

export function parseChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!isChatChannel(v.channel)) return null;
  const text = sanitizeChatText(v.text);
  if (text === null) return null;
  if (typeof v.id !== "string" || v.id.length === 0 || v.id.length > 64) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at <= 0) return null;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    id: v.id,
    channel: v.channel,
    name: sanitizeChatName(v.name),
    text,
    at: v.at,
    x: num(v.x),
    y: num(v.y),
    space: typeof v.space === "string" ? v.space.slice(0, 64) : "world",
    guildId: typeof v.guildId === "string" ? v.guildId.slice(0, 32) : undefined,
    source: v.source === "discord" ? "discord" : undefined,
  };
}

export function chatTtlMs(channel: ChatChannel): number {
  return channel === "proximity"
    ? CHAT_PROXIMITY_TTL_MS
    : channel === "global"
      ? CHAT_GLOBAL_TTL_MS
      : CHAT_UNION_TTL_MS;
}

export function pruneChatMessages(
  messages: readonly ChatMessage[],
  channel: ChatChannel,
  now: number,
): ChatMessage[] {
  const ttl = chatTtlMs(channel);
  return messages
    .filter((m) => m.channel === channel && now - m.at <= ttl)
    .sort((a, b) => b.at - a.at)
    .slice(0, CHAT_MAX_MESSAGES);
}

export function visibleChatMessages(
  messages: readonly ChatMessage[],
  viewer: { x: number; y: number; space: string; guildId?: string | null },
  channel: ChatChannel,
  now: number,
): ChatMessage[] {
  const pruned = pruneChatMessages(messages, channel, now);
  if (channel === "proximity") {
    return pruned.filter(
      (m) =>
        m.space === viewer.space &&
        Math.hypot(m.x - viewer.x, m.y - viewer.y) <= CHAT_PROXIMITY_RANGE,
    );
  }
  if (channel === "global") {
    return pruned.filter((m) => m.space === viewer.space);
  }
  return pruned.filter((m) => !!viewer.guildId && m.guildId === viewer.guildId);
}
