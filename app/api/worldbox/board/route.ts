import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { appendBoardPost, sanitizeBoardText } from "@/lib/worldbox/social/board";
import {
  isBoardEnabled,
  loadBoardPosts,
  storeBoardPosts,
} from "@/lib/worldbox/social/board-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const BOARD_MIN_INTERVAL_MS = 1_500;
const lastPostAt = new Map<string, number>();

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

export async function GET(request: Request) {
  if (!isBoardEnabled()) {
    return NextResponse.json({ error: "board_unavailable" }, { status: 503, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  const posts = await loadBoardPosts();
  return NextResponse.json({ posts, loggedIn: session !== null }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!isBoardEnabled()) {
    return NextResponse.json({ error: "board_unavailable" }, { status: 503, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const text = sanitizeBoardText((body as { text?: unknown } | null)?.text);
  if (text === null) {
    return NextResponse.json({ error: "invalid_text" }, { status: 400, headers: NO_STORE });
  }
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();
  if (now - (lastPostAt.get(ownerKey) ?? 0) < BOARD_MIN_INTERVAL_MS) {
    return NextResponse.json({ error: "too_fast" }, { status: 429, headers: NO_STORE });
  }
  if ((await loadMyLobbyStation(ownerKey)) !== "board") {
    return NextResponse.json({ error: "not_at_board" }, { status: 409, headers: NO_STORE });
  }
  const name = session.username?.trim() || "プレイヤー";
  const posts = appendBoardPost(await loadBoardPosts(), { name, text, at: now });
  const stored = await storeBoardPosts(posts);
  if (!stored) {
    return NextResponse.json({ error: "board_failed" }, { status: 500, headers: NO_STORE });
  }
  lastPostAt.set(ownerKey, now);
  return NextResponse.json({ ok: true, posts }, { headers: NO_STORE });
}
