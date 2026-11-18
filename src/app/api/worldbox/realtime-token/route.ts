import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest } from "@/lib/auth";
import { issueRealtimeToken } from "@/lib/worldbox/core/realtime-token";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const token = issueRealtimeToken(session, Date.now());
  if (!token) {
    return NextResponse.json({ error: "realtime_unavailable" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ token }, { headers: NO_STORE });
}
