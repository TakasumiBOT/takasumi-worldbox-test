import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/auth";
import { kvList } from "@/lib/bot-api";
import {
  dayKeyOf,
  funnelRates,
  parseUserFirstSteps,
  retentionRate,
} from "@/lib/worldbox/core/metrics";
import {
  WORLDBOX_METRICS_USERS_NAMESPACE,
  loadDayMetrics,
  loadEconDay,
} from "@/lib/worldbox/core/metrics-online";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";
import { worldboxAdminIds } from "@/lib/worldbox/core/ops-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const DAYS = 14;

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (session.provider !== "discord" || !worldboxAdminIds().has(session.id)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const now = Date.now();
  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) dates.push(dayKeyOf(now - i * 86_400_000));

  const [nations, usersRaw, ...rest] = await Promise.all([
    loadNationsState(),
    kvList(WORLDBOX_METRICS_USERS_NAMESPACE).catch(() => new Map<string, unknown>()),
    ...dates.map(async (date) => ({
      date,
      day: await loadDayMetrics(date),
      econ: await loadEconDay(date),
    })),
  ]);
  const memberKeys = new Set(Object.keys(nations.members ?? {}));

  const days = rest.map(({ date, day, econ }) => {
    const unionDau = day.dau.filter((k) => memberKeys.has(k)).length;
    return {
      date,
      dau: day.dau.length,
      peak: day.peak,
      blocksPlaced: day.blocksPlaced,
      harvests: day.harvests,
      chats: { near: day.chatsNear, global: day.chatsGlobal, union: day.chatsUnion },
      guildShopVolume: day.guildShopVolume,
      unionCoverage: day.dau.length > 0 ? unionDau / day.dau.length : 0,
      econ,
    };
  });

  const users = [...usersRaw.values()]
    .map((v) => parseUserFirstSteps(v))
    .filter((u): u is NonNullable<typeof u> => u !== null);
  const funnel = funnelRates(users);

  const weekAgo = rest[DAYS - 8]?.day;
  const today = rest[DAYS - 1]?.day;
  const retention7d = weekAgo && today ? retentionRate(weekAgo, today) : null;

  return NextResponse.json({ days, funnel, retention7d }, { headers: NO_STORE });
}
