import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSession,
  getRequestSession,
  isSameOriginRequest,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const existing = getRequestSession(request);
  if (existing && existing.provider !== "google") {
    return NextResponse.json(
      { ok: true, user: { name: existing.username } },
      { headers: NO_STORE },
    );
  }
  const user = {
    id: crypto.randomUUID(),
    username: `ゲスト${String(crypto.randomInt(0, 10000)).padStart(4, "0")}`,
    avatar: null,
    provider: "guest" as const,
  };
  const response = NextResponse.json(
    { ok: true, user: { name: user.username } },
    { headers: NO_STORE },
  );
  response.cookies.set(SESSION_COOKIE, createSession(user), sessionCookieOptions(request));
  return response;
}
