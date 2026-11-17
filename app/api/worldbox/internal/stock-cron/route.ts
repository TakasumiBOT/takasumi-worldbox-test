import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runStockDividendCron } from "@/lib/worldbox/economy/stock-online";
import { markLazyJobRun } from "@/lib/worldbox/core/lazy-jobs";

// 株式の配当（日次）の内部ルート。Vercel Cron が毎日 0:00 JST
// （= 15:00 UTC）に GET する（vercel.json の crons 参照）。
// 冪等化はアカウントごとの処理済み日付キー（JST）が担保するため、
// 予定外の時刻に呼ばれても同じ日付の二重払いは起きない。
// CRON_SECRET 未設定なら fail closed（401）で何もしない
// （company-cron / economy-sweep と同じ規則）。主経路は遅延実行
// （lazy-jobs）で、ここが処理したときは遅延実行側の
// タイムスタンプも進める。
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
  const result = await runStockDividendCron(Date.now());
  await markLazyJobRun("stock_dividend", Date.now());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
