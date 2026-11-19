import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { countItem, addItem } from "@/lib/worldbox/player/profile";

function sanitizeText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLen);
}
import { loadProfile, storeProfile } from "@/lib/worldbox/player/profile-online";
import { awardMmoCoins, getMmoBalance, spendMmoCoins } from "@/lib/worldbox/economy/mmo-wallet";
import {
  canSwitchCareer,
  careerById,
  CAREERS,
  CERT_BY_ID,
  CERTIFICATIONS,
  computeShiftPayout,
  generateJobTask,
  jstDayKey,
  UNEMPLOYMENT_BASE_PAYOUT,
  UNEMPLOYMENT_COOLDOWN_MS,
  UNEMPLOYMENT_MAX_BALANCE,
  xpForNextLevel,
  type CareerId,
  type CertificationId,
} from "@/lib/worldbox/social/jobs";
import { isJobsEnabled, loadJobProfile, storeJobProfile } from "@/lib/worldbox/social/jobs-online";
import { isActivelyJailed } from "@/lib/worldbox/social/prison";
import { loadPrisonRecord, storePrisonRecord } from "@/lib/worldbox/social/prison-online";
import { incrementQuestProgress, pushMmoNews } from "@/lib/worldbox/social/mmo-events-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isJobsEnabled()) return err("jobs_unavailable", 503);
  const ownerKey = sessionOwnerKey(session);
  const now = Date.now();

  const [jobProfile, profile, balance, prison] = await Promise.all([
    loadJobProfile(ownerKey),
    loadProfile(ownerKey),
    getMmoBalance(session, ownerKey),
    loadPrisonRecord(ownerKey, session.username || "市民"),
  ]);

  const activeCareer = careerById(jobProfile.currentCareer) ?? CAREERS[0];
  const cooldownLeftMs = Math.max(0, jobProfile.lastShiftAt + activeCareer.cooldownMs - now);

  return NextResponse.json(
    {
      jobProfile,
      careers: CAREERS,
      certifications: CERTIFICATIONS,
      balance,
      hunger: profile.hunger,
      hasUnemploymentCard: countItem(profile, "unemployment_card") > 0,
      cooldownLeftMs,
      jailed: isActivelyJailed(prison, now),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isJobsEnabled()) return err("jobs_unavailable", 503);
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
    let jobProfile = await loadJobProfile(ownerKey);
    let profile = await loadProfile(ownerKey);
    const prison = await loadPrisonRecord(ownerKey, session.username || "市民");

    if (fields.action === "switch_career") {
      const target = fields.careerId as CareerId;
      const check = canSwitchCareer(jobProfile, target);
      if (!check.ok) return err(check.error, 409);
      jobProfile = { ...jobProfile, currentCareer: target, activeTask: null };
      await storeJobProfile(ownerKey, jobProfile);
      return NextResponse.json({ ok: true, jobProfile }, { headers: NO_STORE });
    }

    if (fields.action === "buy_certification") {
      const certId = typeof fields.certId === "string" ? fields.certId : "";
      const cert = CERT_BY_ID.get(certId);
      if (!cert) return err("unknown_certification", 400);
      if (jobProfile.certifications.includes(cert.id as CertificationId)) {
        return err("already_owned", 409);
      }
      if (jobProfile.level < cert.minLevel) return err("level_too_low", 409);
      const paid = await spendMmoCoins(session, ownerKey, cert.cost, "shop_buy");
      if (!paid.ok) return err(paid.error, 409);

      jobProfile = {
        ...jobProfile,
        certifications: [...jobProfile.certifications, cert.id],
        creditScore: Math.min(900, jobProfile.creditScore + 25),
      };
      await storeJobProfile(ownerKey, jobProfile);
      return NextResponse.json(
        { ok: true, jobProfile, balance: paid.balance },
        { headers: NO_STORE },
      );
    }

    if (isActivelyJailed(prison, now)) {
      return err("in_prison", 409);
    }

    if (fields.action === "start_task") {
      const task = generateJobTask(jobProfile.currentCareer, now);
      jobProfile = { ...jobProfile, activeTask: task };
      await storeJobProfile(ownerKey, jobProfile);
      return NextResponse.json({ ok: true, task, jobProfile }, { headers: NO_STORE });
    }

    if (fields.action === "submit_shift") {
      const career = careerById(jobProfile.currentCareer) ?? CAREERS[0];
      if (now < jobProfile.lastShiftAt + career.cooldownMs) {
        return NextResponse.json(
          {
            error: "cooldown",
            retryAfterMs: jobProfile.lastShiftAt + career.cooldownMs - now,
          },
          { status: 409, headers: NO_STORE },
        );
      }
      if (profile.hunger < career.hungerCost) {
        return err("too_tired", 409);
      }

      let taskCorrect: boolean | null = null;
      if (
        typeof fields.choiceIndex === "number" &&
        jobProfile.activeTask &&
        jobProfile.activeTask.careerId === career.id &&
        jobProfile.activeTask.expiresAt >= now
      ) {
        taskCorrect = Math.floor(fields.choiceIndex) === jobProfile.activeTask.correctIndex;
      }

      const payout = computeShiftPayout(jobProfile, career, taskCorrect);
      const paid = await awardMmoCoins(session, ownerKey, payout.net, "job_salary");
      if (!paid.ok) return err(paid.error, 503);

      // Update hunger & possible item drops
      const dropLog: string[] = [];
      profile = { ...profile, hunger: Math.max(0, profile.hunger - career.hungerCost) };
      if (career.dropItems) {
        for (const drop of career.dropItems) {
          const boost =
            career.id === "engineer" && jobProfile.certifications.includes("master_engineer")
              ? 1.5
              : 1;
          if (Math.random() < drop.chance * boost) {
            profile = addItem(profile, drop.itemId, 1);
            dropLog.push(drop.itemId);
          }
        }
      }
      await storeProfile(ownerKey, profile);

      // Risky underground broker career chance of police heat
      let wantedNotice = false;
      if (career.isRisky && Math.random() < 0.25) {
        const nextWanted = Math.min(5, prison.wantedLevel + 1);
        await storePrisonRecord({
          ...prison,
          wantedLevel: nextWanted,
          bounty: Math.min(500_000, prison.bounty + 550),
          lastCrimeAt: now,
        });
        wantedNotice = true;
      }

      const earnedXp = taskCorrect === true ? 32 : taskCorrect === false ? 14 : 22;
      let nextXp = jobProfile.xp + earnedXp;
      let nextLevel = jobProfile.level;
      let leveledUp = false;
      while (nextXp >= xpForNextLevel(nextLevel) && nextLevel < 50) {
        nextXp -= xpForNextLevel(nextLevel);
        nextLevel += 1;
        leveledUp = true;
      }
      const today = jstDayKey(now);
      const nextStreak =
        jobProfile.lastWorkDay === today
          ? Math.max(1, jobProfile.streakDays)
          : jobProfile.streakDays + 1;

      jobProfile = {
        ...jobProfile,
        xp: nextXp,
        level: nextLevel,
        shiftsCompleted: jobProfile.shiftsCompleted + 1,
        totalEarned: jobProfile.totalEarned + payout.net,
        totalTaxPaid: jobProfile.totalTaxPaid + payout.tax,
        creditScore: Math.min(
          900,
          Math.max(300, jobProfile.creditScore + (taskCorrect === false ? -2 : 4)),
        ),
        lastShiftAt: now,
        streakDays: nextStreak,
        lastWorkDay: today,
        activeTask: null,
      };
      await storeJobProfile(ownerKey, jobProfile);
      void incrementQuestProgress(ownerKey, "work_shift", 1, now);
      if (leveledUp) {
        void pushMmoNews(
          "job",
          `${session.username || "市民"} が ${career.name} Lv.${nextLevel} に昇格しました！`,
          now,
        );
      }

      return NextResponse.json(
        {
          ok: true,
          jobProfile,
          profile,
          balance: paid.balance,
          payout,
          taskCorrect,
          leveledUp,
          drops: dropLog,
          wantedNotice,
        },
        { headers: NO_STORE },
      );
    }

    if (fields.action === "claim_unemployment") {
      if (now < jobProfile.lastInsuranceAt + UNEMPLOYMENT_COOLDOWN_MS) {
        return err("cooldown", 409);
      }
      const bal = (await getMmoBalance(session, ownerKey)) ?? 0;
      const hasCard = countItem(profile, "unemployment_card") > 0;
      if (!hasCard && bal > UNEMPLOYMENT_MAX_BALANCE) {
        return err("not_eligible", 409);
      }
      const benefit = hasCard
        ? Math.round(UNEMPLOYMENT_BASE_PAYOUT * 1.5)
        : UNEMPLOYMENT_BASE_PAYOUT;
      const paid = await awardMmoCoins(session, ownerKey, benefit, "unemployment_benefit");
      if (!paid.ok) return err(paid.error, 503);
      jobProfile = { ...jobProfile, lastInsuranceAt: now };
      await storeJobProfile(ownerKey, jobProfile);
      return NextResponse.json(
        { ok: true, amount: benefit, balance: paid.balance, jobProfile },
        { headers: NO_STORE },
      );
    }

    if (fields.action === "publish_news") {
      if (jobProfile.currentCareer !== "journalist") return err("not_journalist", 403);
      const headline = sanitizeText(fields.headline, 80);
      if (!headline) return err("invalid_text", 400);
      await pushMmoNews("job", `【号外・${session.username || "記者"}】${headline}`, now);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    return err("invalid_action", 400);
  });
}
