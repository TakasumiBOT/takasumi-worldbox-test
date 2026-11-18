import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import {
  isChatChannel,
  sanitizeChatText,
  visibleChatMessages,
  CHAT_MIN_INTERVAL_MS,
  type ChatMessage,
} from "@/lib/worldbox/social/chat";
import {
  appendChatMessage,
  enqueueChatOutbox,
  isChatEnabled,
  loadChatMessages,
  loadUnionChatSettings,
} from "@/lib/worldbox/social/chat-online";
import { resolveLinkedChannelId } from "@/lib/worldbox/social/discord-directory";
import { loadDiscordDirectory } from "@/lib/worldbox/social/discord-directory-online";
import { loadMyPresence } from "@/lib/worldbox/player/presence-online";
import { sanitizePresenceSpace } from "@/lib/worldbox/player/presence";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";
import { bumpMetric } from "@/lib/worldbox/core/metrics-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const lastPostAt = new Map<string, number>();

function err(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

async function myPresence(ownerKey: string) {
  return loadMyPresence(ownerKey);
}

export async function GET(request: Request) {
  if (!isChatEnabled()) return err("chat_unavailable", 503);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const url = new URL(request.url);
  const channelRaw = url.searchParams.get("channel");
  if (!isChatChannel(channelRaw)) return err("invalid_channel", 400);
  const channel = channelRaw;
  const space = sanitizePresenceSpace(url.searchParams.get("space"));
  const ownerKey = sessionOwnerKey(session);
  const me = await myPresence(ownerKey);
  const nations = await loadNationsState();
  const guildId = nations.members[ownerKey]?.nationId ?? null;
  const all = await loadChatMessages(channel, space, guildId ?? undefined);
  const viewer = {
    x: me?.x ?? 0,
    y: me?.y ?? 0,
    space: me?.space ?? space,
    guildId,
  };
  const messages = visibleChatMessages(all, viewer, channel, Date.now());
  return NextResponse.json({ messages, guildId }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isChatEnabled()) return err("chat_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid_request", 400);
  }
  const fields = (body ?? {}) as { channel?: unknown; text?: unknown; space?: unknown };
  if (!isChatChannel(fields.channel)) return err("invalid_channel", 400);
  const text = sanitizeChatText(fields.text);
  if (text === null) return err("invalid_text", 400);
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();
  const last = lastPostAt.get(ownerKey) ?? 0;
  if (now - last < CHAT_MIN_INTERVAL_MS) return err("too_fast", 429);
  const me = await myPresence(ownerKey);
  const space = me?.space ?? sanitizePresenceSpace(fields.space);
  const nations = await loadNationsState();
  const membership = nations.members[ownerKey];
  if (fields.channel === "union" && !membership) return err("no_union", 409);
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    channel: fields.channel,
    name: session.username?.trim() || "プレイヤー",
    text,
    at: now,
    x: me?.x ?? 0,
    y: me?.y ?? 0,
    space,
    guildId: fields.channel === "union" ? membership?.nationId : undefined,
  };
  if (!(await appendChatMessage(message))) return err("store_failed", 503);
  lastPostAt.set(ownerKey, now);
  void bumpMetric(
    fields.channel === "proximity"
      ? "chatsNear"
      : fields.channel === "global"
        ? "chatsGlobal"
        : "chatsUnion",
    1,
    now,
  );
  if (fields.channel === "union" && membership) {
    const settings = await loadUnionChatSettings(membership.nationId);
    const directory =
      settings.mode === "global" ? await loadDiscordDirectory(membership.nationId) : null;
    const channelId = resolveLinkedChannelId(settings, directory);
    if (channelId) {
      await enqueueChatOutbox({
        id: message.id,
        guildId: membership.nationId,
        channelId,
        name: message.name,
        text: message.text,
        at: now,
        status: "pending",
      });
    }
  }
  return NextResponse.json({ ok: true, message }, { headers: NO_STORE });
}
