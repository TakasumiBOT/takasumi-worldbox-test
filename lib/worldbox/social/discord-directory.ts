import type { UnionChatSettings } from "./chat";

export type DiscordDirectoryChannel = { id: string; name: string };

export type DiscordDirectory = {
  channels: DiscordDirectoryChannel[];
  globalChatChannelId: string | null;
  updatedAt: number;
};

const CHANNEL_ID_RE = /^\d{17,20}$/;
export const DIRECTORY_MAX_CHANNELS = 100;

export function parseDiscordDirectory(raw: unknown): DiscordDirectory | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.channels)) return null;
  const channels: DiscordDirectoryChannel[] = [];
  const seen = new Set<string>();
  for (const c of v.channels) {
    if (!c || typeof c !== "object") continue;
    const ch = c as Record<string, unknown>;
    if (typeof ch.id !== "string" || !CHANNEL_ID_RE.test(ch.id) || seen.has(ch.id)) continue;
    seen.add(ch.id);
    channels.push({
      id: ch.id,
      name: typeof ch.name === "string" && ch.name ? ch.name.slice(0, 100) : ch.id,
    });
    if (channels.length >= DIRECTORY_MAX_CHANNELS) break;
  }
  return {
    channels,
    globalChatChannelId:
      typeof v.globalChatChannelId === "string" && CHANNEL_ID_RE.test(v.globalChatChannelId)
        ? v.globalChatChannelId
        : null,
    updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
  };
}

export function resolveLinkedChannelId(
  settings: UnionChatSettings,
  directory: DiscordDirectory | null,
): string | null {
  if (settings.mode === "channel") return settings.channelId;
  if (settings.mode === "global") return directory?.globalChatChannelId ?? null;
  return null;
}
