import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { activeEvents, eventDaysLeft, EVENT_DUNGEON_ENTRANCE } from "@/lib/worldbox/core/events";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const now = Date.now();
  return NextResponse.json(
    {
      events: activeEvents(now).map((def) => ({
        id: def.id,
        name: def.name,
        kind: def.kind,
        daysLeft: eventDaysLeft(def, now),
      })),
      dungeonEntrance: EVENT_DUNGEON_ENTRANCE,
    },
    { headers: NO_STORE },
  );
}
