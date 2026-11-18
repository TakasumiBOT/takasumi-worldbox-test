import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import {
  HOUSE_POOL_EXIT_FEE_RATE,
  HOUSE_POOL_MAX_DEPOSIT,
  HOUSE_POOL_MIN_DEPOSIT,
  housePoolActorValue,
  housePoolNavPerShare,
  planHousePoolDeposit,
  planHousePoolWithdraw,
} from "@/lib/worldbox/activity/house-pool";
import {
  isHousePoolEnabled,
  loadHousePoolState,
  storeHousePoolState,
} from "@/lib/worldbox/activity/house-pool-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { isEconomyEnabled, readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import { chargeUserChunked, payoutUserChunked } from "@/lib/worldbox/economy/settlement";
import { applyLedger, isCompanyOwner } from "@/lib/worldbox/social/company";
import {
  appendCompanyHistory,
  loadCompany,
  loadCompanyOf,
  storeCompany,
} from "@/lib/worldbox/social/company-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isHousePoolEnabled() || !isEconomyEnabled()) return err("house_pool_unavailable", 503);

  const now = Date.now();
  const isGuest = session.provider === "guest";
  const ownerKey = sessionOwnerKey(session);
  const pool = await loadHousePoolState();
  const navPerShare = Number(housePoolNavPerShare(pool).toFixed(4));

  if (isGuest) {
    return NextResponse.json(
      {
        guest: true,
        serverNow: now,
        pool: {
          poolWbc: pool.poolWbc,
          playerDepositWbc: pool.playerDepositWbc,
          totalShares: pool.totalShares,
          navPerShare,
          cumulativeYield: pool.cumulativeYield,
          cumulativeLoss: pool.cumulativeLoss,
        },
        limits: {
          minDeposit: HOUSE_POOL_MIN_DEPOSIT,
          maxDeposit: HOUSE_POOL_MAX_DEPOSIT,
          exitFeeRate: HOUSE_POOL_EXIT_FEE_RATE,
        },
        myShares: 0,
        myValue: 0,
        company: null,
        balance: null,
      },
      { headers: NO_STORE },
    );
  }

  const [myCompany, balance] = await Promise.all([
    loadCompanyOf(ownerKey),
    readUserBalance(session.id),
  ]);
  const companyActorKey = myCompany ? `company:${myCompany.id}` : null;
  const companyShares = companyActorKey ? (pool.sharesByActor[companyActorKey] ?? 0) : 0;

  return NextResponse.json(
    {
      guest: false,
      serverNow: now,
      pool: {
        poolWbc: pool.poolWbc,
        playerDepositWbc: pool.playerDepositWbc,
        totalShares: pool.totalShares,
        navPerShare,
        cumulativeYield: pool.cumulativeYield,
        cumulativeLoss: pool.cumulativeLoss,
      },
      limits: {
        minDeposit: HOUSE_POOL_MIN_DEPOSIT,
        maxDeposit: HOUSE_POOL_MAX_DEPOSIT,
        exitFeeRate: HOUSE_POOL_EXIT_FEE_RATE,
      },
      myShares: pool.sharesByActor[ownerKey] ?? 0,
      myValue: housePoolActorValue(pool, ownerKey),
      company: myCompany
        ? {
            id: myCompany.id,
            name: myCompany.name,
            assets: myCompany.assets,
            isOwner: isCompanyOwner(myCompany, ownerKey),
            shares: companyShares,
            value: companyActorKey ? housePoolActorValue(pool, companyActorKey) : 0,
          }
        : null,
      balance,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (session.provider === "guest") return err("guest_not_allowed", 403);
  if (!isHousePoolEnabled() || !isEconomyEnabled()) return err("house_pool_unavailable", 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }

  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;
  const action = body.action;
  const asCompany = body.asCompany === true;

  const myCompanyInitial = asCompany ? await loadCompanyOf(ownerKey) : null;
  if (asCompany && !myCompanyInitial) return err("not_in_company", 409);
  if (asCompany && myCompanyInitial && !isCompanyOwner(myCompanyInitial, ownerKey)) {
    return err("not_owner", 403);
  }

  const runWithLocks = <T>(fn: () => Promise<T>) =>
    withUserLock("house_pool:global", () =>
      myCompanyInitial ? withUserLock(`company:${myCompanyInitial.id}`, fn) : fn(),
    );

  return runWithLocks(async () => {
    const now = Date.now();
    const pool = await loadHousePoolState();
    const actorKey = myCompanyInitial ? `company:${myCompanyInitial.id}` : ownerKey;

    if (action === "deposit") {
      const plan = planHousePoolDeposit(pool, actorKey, body.amount);
      if (!plan.ok) return err(plan.error, 400);

      if (myCompanyInitial) {
        const company = (await loadCompany(myCompanyInitial.id)) ?? myCompanyInitial;
        if (company.assets < plan.amount) return err("not_enough_assets", 409);
        const step = applyLedger(company, -plan.amount, "胴元LPプール出資", discordId, now);
        if (!(await storeCompany(step.company))) return err("store_failed", 503);
        if (!(await storeHousePoolState(plan.state))) {
          await storeCompany(company);
          return err("store_failed", 503);
        }
        await appendCompanyHistory(company.id, [step.entry]);
        return NextResponse.json(
          {
            ok: true,
            asCompany: true,
            amount: plan.amount,
            sharesMinted: plan.sharesMinted,
            navPerShare: Number(housePoolNavPerShare(plan.state).toFixed(4)),
            companyShares: plan.state.sharesByActor[actorKey] ?? 0,
            companyValue: housePoolActorValue(plan.state, actorKey),
            companyAssets: step.company.assets,
          },
          { headers: NO_STORE },
        );
      }

      const charged = await chargeUserChunked(
        ownerKey,
        discordId,
        plan.amount,
        "house_pool_deposit",
        {
          refundReason: "house_pool_withdraw",
        },
      );
      if (charged.state === "insufficient_funds") return err("not_enough_coins", 409);
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") return err("economy_failed", 409);

      if (!(await storeHousePoolState(plan.state))) {
        await payoutUserChunked(ownerKey, discordId, plan.amount, "house_pool_withdraw");
        return err("store_failed", 503);
      }

      return NextResponse.json(
        {
          ok: true,
          asCompany: false,
          amount: plan.amount,
          sharesMinted: plan.sharesMinted,
          navPerShare: Number(housePoolNavPerShare(plan.state).toFixed(4)),
          myShares: plan.state.sharesByActor[ownerKey] ?? 0,
          myValue: housePoolActorValue(plan.state, ownerKey),
          balance: await readUserBalance(discordId),
        },
        { headers: NO_STORE },
      );
    }

    if (action === "withdraw") {
      const plan = planHousePoolWithdraw(pool, actorKey, body.shares);
      if (!plan.ok) return err(plan.error, 409);

      if (myCompanyInitial) {
        const company = (await loadCompany(myCompanyInitial.id)) ?? myCompanyInitial;
        const step = applyLedger(
          company,
          plan.net,
          `胴元LPプール引出（${plan.sharesBurned}株・手数料${plan.fee}円）`,
          discordId,
          now,
        );
        if (!(await storeHousePoolState(plan.state))) return err("store_failed", 503);
        if (!(await storeCompany(step.company))) {
          await storeHousePoolState(pool);
          return err("store_failed", 503);
        }
        await appendCompanyHistory(company.id, [step.entry]);
        return NextResponse.json(
          {
            ok: true,
            asCompany: true,
            sharesBurned: plan.sharesBurned,
            gross: plan.gross,
            fee: plan.fee,
            net: plan.net,
            navPerShare: Number(housePoolNavPerShare(plan.state).toFixed(4)),
            companyShares: plan.state.sharesByActor[actorKey] ?? 0,
            companyValue: housePoolActorValue(plan.state, actorKey),
            companyAssets: step.company.assets,
          },
          { headers: NO_STORE },
        );
      }

      if (!(await storeHousePoolState(plan.state))) return err("store_failed", 503);
      const paid = await payoutUserChunked(ownerKey, discordId, plan.net, "house_pool_withdraw");
      if (paid.state !== "done" && paid.state !== "pending") {
        await storeHousePoolState(pool);
        return err("economy_failed", 409);
      }

      return NextResponse.json(
        {
          ok: true,
          asCompany: false,
          sharesBurned: plan.sharesBurned,
          gross: plan.gross,
          fee: plan.fee,
          net: plan.net,
          navPerShare: Number(housePoolNavPerShare(plan.state).toFixed(4)),
          myShares: plan.state.sharesByActor[ownerKey] ?? 0,
          myValue: housePoolActorValue(plan.state, ownerKey),
          balance: await readUserBalance(discordId),
        },
        { headers: NO_STORE },
      );
    }

    return err("invalid_action", 400);
  });
}
