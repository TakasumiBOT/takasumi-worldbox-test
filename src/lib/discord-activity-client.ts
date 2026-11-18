import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { buildDiscordIdentity, type DiscordIdentity } from "./discord-activity";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function attemptDiscordAuth(
  sdk: DiscordSDK,
  clientId: string,
  promptNone: boolean,
): Promise<DiscordIdentity> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = encodeBase64Url(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = encodeBase64Url(new Uint8Array(digest));
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    scope: ["identify"],
    ...(promptNone ? { prompt: "none" as const } : {}),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const response = await fetch("/api/activity/games-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: verifier }),
  });
  if (!response.ok) throw new Error("games-auth failed");
  const data = (await response.json()) as { accessToken?: unknown; user?: DiscordIdentity };
  if (typeof data.accessToken !== "string" || !data.accessToken)
    throw new Error("games-auth failed");
  const auth = await sdk.commands.authenticate(
    Object.fromEntries([["access_token", data.accessToken]]) as { access_token: string },
  );
  const identity = buildDiscordIdentity(auth.user) ?? data.user ?? null;
  if (!identity) throw new Error("identity unavailable");
  return identity;
}

export async function authenticateDiscordIdentity(
  sdk: DiscordSDK,
  clientId: string,
): Promise<DiscordIdentity | null> {
  try {
    return await attemptDiscordAuth(sdk, clientId, true);
  } catch {
    // 無言認証の失敗 → 承認画面ありで再試行。それも失敗したら null。
  }
  try {
    return await attemptDiscordAuth(sdk, clientId, false);
  } catch {
    return null;
  }
}
