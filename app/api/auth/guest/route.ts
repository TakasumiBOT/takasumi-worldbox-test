import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, getRequestSession, publicOrigin, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

// ゲスト入場（Discord ログインなし）。POST でゲストセッションを張る。
// Discord OAuth が一切未設定の環境でも成立することが前提なので、
// isDiscordConfigured 等の判定は一切しない（セッション署名もゲスト用に
// フォールバックが効く: lib/auth.ts）。
// 冪等性: 既にゲストセッションがある場合はそれをそのまま返す（連打で
// 身元が増えない）。Discord セッションがある場合も上書きしない（本人の
// ログインをゲストに格下げしない）。Google セッションは WORLD BOX の
// ゲートを通れないため、ゲストへの切り替えを許可する。
// ゲストはコイン経済の対象外（経済ブリッジ側で guest_not_allowed に
// 終端させる。users テーブルには決して載らない）。

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
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
