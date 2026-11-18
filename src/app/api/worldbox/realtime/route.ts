import { connection } from "next/server";
import { upgradeWebSocket } from "@vercel/functions";
import { getHub } from "@/realtime/hub.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  await connection();
  const hub = getHub();
  const auth = hub.verifyAuth(new URL(request.url).searchParams);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }
  return upgradeWebSocket(
    (ws) => {
      hub.handleConnection(ws as Parameters<typeof hub.handleConnection>[0], auth);
    },
    { maxPayload: 4096 },
  );
}
