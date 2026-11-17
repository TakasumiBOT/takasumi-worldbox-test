import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";

export const runtime = "nodejs";

// AGO WORLD BOX の入場ゲート。
// GET: { allowed } — Discord セッションかゲストセッションのときだけ true。
// Google ログインのセッションでは入場できない（Discord ログインか
// ゲスト入場が必要）。ゲストはコイン経済の対象外だが、ワールドへの
// 入場・プレゼンス・セーブは通常どおり使える。
// Bot API には依存しない（セッションだけで判定できる）。

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const session = getRequestSession(request);
  const allowed =
    session !== null &&
    (session.provider === "discord" || session.provider === "guest") &&
    typeof session.id === "string" &&
    session.id.length > 0;
  return NextResponse.json({ allowed }, { headers: NO_STORE });
}
