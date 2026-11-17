import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { sweepEconomyOps } from "@/lib/worldbox/economy-bridge-online";

// 経済オプのスイープ用内部ルート（旧 Python ワーカーの代替）。
// Vercel Cron が毎分 GET する（vercel.json の crons 参照）。Vercel は
// CRON_SECRET 環境変数が設定されているとき Authorization: Bearer <CRON_SECRET>
// を自動で付ける。CRON_SECRET 未設定なら fail closed（401）で何もしない。
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
  const result = await sweepEconomyOps();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
