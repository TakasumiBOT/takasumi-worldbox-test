import { NextResponse } from "next/server";
import { exchangeDiscordActivityCode } from "@/lib/activity-auth";
import {
  SESSION_COOKIE,
  createSession,
  discordClientId,
  discordClientSecret,
  sessionCookieOptions,
} from "@/lib/auth";
import { createWebSession } from "@/lib/dashboard";
import { buildDiscordIdentity } from "@/lib/discord-activity";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export async function POST(request: Request) {
  const clientId = discordClientId();
  const clientSecret = discordClientSecret();
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "activity_not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const { code, codeVerifier } = body as Record<string, unknown>;
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    code.length > 4096 ||
    typeof codeVerifier !== "string" ||
    !PKCE_VERIFIER.test(codeVerifier)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }

  try {
    const { accessToken, user } = await exchangeDiscordActivityCode({
      clientId,
      clientSecret,
      code,
      codeVerifier,
    });
    const identity = buildDiscordIdentity(user);
    if (!identity) {
      return NextResponse.json(
        { error: "authorization_failed" },
        { status: 401, headers: NO_STORE },
      );
    }
    const sessionUser = {
      id: user.id,
      username: user.global_name || user.username || "Discord",
      avatar: typeof user.avatar === "string" && user.avatar ? user.avatar : null,
      provider: "discord" as const,
    };
    const sid = await createWebSession(sessionUser, accessToken);
    const response = NextResponse.json({ accessToken, user: identity }, { headers: NO_STORE });
    response.cookies.set(
      SESSION_COOKIE,
      createSession(sessionUser, sid ?? undefined),
      sessionCookieOptions(request),
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "authorization_unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
