import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runCompanyCron } from "@/lib/worldbox/social/company-online";

// 会社システムの定期処理（給料・法人税・失効掃除）の内部ルート。
// Vercel Cron が毎時 GET する（vercel.json の crons 参照）。時間帯の
// 判定は JST で行い（給料は 8〜20 時台、法人税は 3 時間ごと）、
// 会社ごとの冪等キーで同じ時間帯の二重処理を防ぐ。
// CRON_SECRET 未設定なら fail closed（401）で何もしない
// （economy-sweep と同じ規則）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const presented = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(presented, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runCompanyCron(Date.now());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
