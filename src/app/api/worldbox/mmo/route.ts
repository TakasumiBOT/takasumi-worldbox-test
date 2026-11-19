import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { itemById } from "@/lib/worldbox/economy/items";
import { awardMmoCoins, getMmoBalance } from "@/lib/worldbox/economy/mmo-wallet";
import { addItem } from "@/lib/worldbox/player/profile";
import { loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { DAILY_MISSION_POOL } from "@/lib/worldbox/social/mmo-events";
import {
  loadMmoNewsFeed,
  loadPlayerQuests,
  pushMmoNews,
  storePlayerQuests,
} from "@/lib/worldbox/social/mmo-events-online";
import { loadJobProfile } from "@/lib/worldbox/social/jobs-online";
import { isActivelyJailed } from "@/lib/worldbox/social/prison";
import { loadPrisonRecord } from "@/lib/worldbox/social/prison-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();

  const [news, quests, prison, jobProfile, balance] = await Promise.all([
    loadMmoNewsFeed(),
    loadPlayerQuests(ownerKey, now),
    loadPrisonRecord(ownerKey, session.username || "市民"),
    loadJobProfile(ownerKey),
    getMmoBalance(session, ownerKey),
  ]);

  const missions = DAILY_MISSION_POOL.map((m) => ({
    ...m,
    progress: quests.progress[m.id] ?? 0,
    claimed: quests.claimed[m.id] === true,
    rewardItemDef: m.rewardItem ? itemById(m.rewardItem.id) : null,
  }));

  const fallbackNews =
    news.length > 0
      ? news
      : [
          {
            id: "welcome",
            at: now,
            kind: "economy" as const,
            text: "タカスミメトロ経済圏へようこそ！仕事・機械制作・スマート自販機・治安警察が稼働中です。",
          },
        ];

  return NextResponse.json(
    {
      news: fallbackNews,
      missions,
      balance,
      prison: {
        jailed: isActivelyJailed(prison, now),
        wantedLevel: prison.wantedLevel,
        bounty: prison.bounty,
        releaseAt: prison.releaseAt,
        remainingMs: isActivelyJailed(prison, now) ? Math.max(0, prison.releaseAt - now) : 0,
        cellId: prison.cellId,
        inmateNumber: prison.inmateNumber,
      },
      career: {
        currentCareer: jobProfile.currentCareer,
        level: jobProfile.level,
        creditScore: jobProfile.creditScore,
      },
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("invalid_request", 400);
  }
  const fields = (body ?? {}) as Record<string, unknown>;
  const ownerKey = sessionOwnerKey(session);

  return withUserLock(ownerKey, async () => {
    const now = Date.now();
    if (fields.action === "claim_quest") {
      const mission = DAILY_MISSION_POOL.find((m) => m.id === fields.missionId);
      if (!mission) return err("unknown_mission", 400);
      const quests = await loadPlayerQuests(ownerKey, now);
      if (quests.claimed[mission.id]) return err("already_claimed", 409);
      if ((quests.progress[mission.id] ?? 0) < mission.target) {
        return err("not_completed", 409);
      }

      const paid = await awardMmoCoins(session, ownerKey, mission.rewardCoins, "quest_reward");
      if (!paid.ok) return err(paid.error, 503);

      let profile = await loadProfile(ownerKey);
      if (mission.rewardItem) {
        profile = addItem(profile, mission.rewardItem.id, mission.rewardItem.count);
        await storeProfile(ownerKey, profile);
      }
      quests.claimed[mission.id] = true;
      await storePlayerQuests(ownerKey, quests);
      void pushMmoNews(
        "economy",
        `${session.username || "市民"} がデイリー任務「${mission.title}」を達成！`,
        now,
      );
      return NextResponse.json({ ok: true, balance: paid.balance, profile }, { headers: NO_STORE });
    }
    return err("invalid_action", 400);
  });
}
