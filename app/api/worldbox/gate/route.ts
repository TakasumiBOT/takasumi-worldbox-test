import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";

export const runtime = "nodejs";

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
