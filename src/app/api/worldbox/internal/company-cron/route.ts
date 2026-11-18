import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { runCompanyCron } from "@/lib/worldbox/social/company-online";
import { markLazyJobRun } from "@/lib/worldbox/core/lazy-jobs";

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
  await markLazyJobRun("company_cron", Date.now());
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
