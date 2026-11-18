import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  canonicalAuthorizeRedirect,
  discordClientId,
  discordRedirectUri,
  isDiscordConfigured,
  publicOrigin,
  resolveOAuthNext,
  stateCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";

export function GET(request: Request) {
  const clientId = discordClientId();
  const redirectUri = discordRedirectUri();
  if (!clientId || !redirectUri || !isDiscordConfigured()) {
    return NextResponse.redirect(
      new URL("/login?error=discord_not_configured", publicOrigin(request)),
    );
  }

  const canonical = canonicalAuthorizeRedirect(request, "/api/auth/discord/authorize", redirectUri);
  if (canonical) return NextResponse.redirect(canonical);

  const next = resolveOAuthNext(new URL(request.url).searchParams.get("next"));

  const state = crypto.randomBytes(24).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_STATE_COOKIE, state, stateCookieOptions(request));
  response.cookies.set(OAUTH_NEXT_COOKIE, next, stateCookieOptions(request));
  return response;
}
