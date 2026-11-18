import crypto from "node:crypto";
import { sessionAvatarUrl, sessionOwnerKey, sessionSecret, type SessionInfo } from "../../auth";
import { PRESENCE_NAME_MAX, presenceIdFor } from "../player/presence";

export const REALTIME_TOKEN_TTL_MS = 10 * 60 * 1000;

function realtimeSecret(): string {
  return sessionSecret();
}

export function issueRealtimeToken(session: SessionInfo, now: number): string | null {
  const secret = realtimeSecret();
  if (!secret) return null;
  const avatarUrl = sessionAvatarUrl(session);
  const payload = {
    pid: presenceIdFor(sessionOwnerKey(session)),
    name: (session.username ?? "").slice(0, PRESENCE_NAME_MAX),
    ok: sessionOwnerKey(session),
    ...(avatarUrl ? { av: avatarUrl } : {}),
    exp: now + REALTIME_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const head = `v1.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(head).digest("base64url");
  return `${head}.${sig}`;
}
