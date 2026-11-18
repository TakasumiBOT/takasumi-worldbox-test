import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { userAvatarUrl } from "@/lib/dashboard-core";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ user: null }, { headers: NO_STORE });
  }
  const avatar = session.avatar ?? null;
  const avatarUrl =
    avatar && avatar.startsWith("http")
      ? avatar
      : session.provider === "google" || session.provider === "guest"
        ? null
        : userAvatarUrl(session.id, avatar);
  return NextResponse.json({ user: { name: session.username, avatarUrl } }, { headers: NO_STORE });
}
