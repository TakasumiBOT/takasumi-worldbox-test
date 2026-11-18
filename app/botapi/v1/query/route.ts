import { processBotApiRequest, serializeBotApiJson } from "@/lib/botapi-server";
import { getSqlExecutor } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let executor;
  try {
    executor = getSqlExecutor();
  } catch {
    return new Response(
      serializeBotApiJson({
        detail: { code: "API_NOT_READY", message: "Database API is not ready" },
      }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }
  const { status, body } = await processBotApiRequest(
    "query",
    await request.text(),
    request.headers.get("authorization"),
    executor,
  );
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
