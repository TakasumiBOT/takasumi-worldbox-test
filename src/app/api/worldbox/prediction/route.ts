import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import {
  claimUserPredictionPayouts,
  ensureRound,
  planPredictionBet,
  PREDICTION_BET_MAX,
  PREDICTION_BET_MIN,
  PREDICTION_FEE_RATE,
  settlePredictionRound,
  type PredictionMarketState,
} from "@/lib/worldbox/activity/prediction";
import { creditHousePoolYield } from "@/lib/worldbox/activity/house-pool-online";
import {
  isPredictionEnabled,
  loadPredictionState,
  storePredictionState,
} from "@/lib/worldbox/activity/prediction-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { loadCommoditiesMarket } from "@/lib/worldbox/economy/commodities-online";
import { isEconomyEnabled, readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import { dynamicNpcPrice } from "@/lib/worldbox/economy/exchange";
import { loadExchangeState } from "@/lib/worldbox/economy/exchange-online";
import { FX_CURRENCIES, fxCurrencyById, fxQuote } from "@/lib/worldbox/economy/fx";
import { loadFxState } from "@/lib/worldbox/economy/fx-online";
import { chargeUserChunked, payoutUserChunked } from "@/lib/worldbox/economy/settlement";
import { stockById } from "@/lib/worldbox/economy/stock";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const FEATURED_STOCK_IDS = ["TAKASUMI", "DEEDLE", "KIKURIN", "JTTI"] as const;

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function syncPredictionMarketLocked(now: number): Promise<{
  state: PredictionMarketState;
  livePrices: Record<string, number>;
}> {
  const [rawState, fx, commodities, nations, exchange] = await Promise.all([
    loadPredictionState(),
    loadFxState(),
    loadCommoditiesMarket(),
    loadNationsState(),
    loadExchangeState(),
  ]);
  const nationCount = Object.keys(nations.nations).length;
  let state = rawState;
  let changed = false;
  let totalHouseYield = 0;

  // 決済時刻を過ぎた未決済ラウンドを自動確定
  for (const round of Object.values(state.rounds)) {
    if (round.settled || now < round.settlesAt) continue;
    let finalPrice = round.strikePrice;
    if (round.kind === "fx") {
      const def = fxCurrencyById(round.symbol);
      if (def) {
        finalPrice = fxQuote(def, fx, commodities, nationCount, round.settlesAt).mid;
      }
    } else {
      const stockDef = stockById(round.symbol);
      if (stockDef) {
        finalPrice = dynamicNpcPrice(exchange, round.symbol, commodities, round.settlesAt);
      }
    }
    const settled = settlePredictionRound(state, round.id, finalPrice, now);
    if (settled.settled) {
      state = settled.state;
      totalHouseYield += settled.houseFeeYield;
      changed = true;
    }
  }

  const livePrices: Record<string, number> = {};

  // 4通貨の現在時間ラウンドを保証
  for (const def of FX_CURRENCIES) {
    const mid = fxQuote(def, fx, commodities, nationCount, now).mid;
    livePrices[`fx:${def.id}`] = mid;
    const ensured = ensureRound(
      state,
      {
        kind: "fx",
        symbol: def.id,
        label: `${def.name} (${def.id}/WBC)`,
        strikePrice: mid,
      },
      now,
    );
    if (ensured.state !== state) {
      state = ensured.state;
      changed = true;
    }
  }

  // 主要4銘柄の現在時間ラウンドを保証
  for (const stockId of FEATURED_STOCK_IDS) {
    const def = stockById(stockId);
    if (!def) continue;
    const price = dynamicNpcPrice(exchange, stockId, commodities, now);
    livePrices[`stock:${stockId}`] = price;
    const ensured = ensureRound(
      state,
      {
        kind: "stock",
        symbol: stockId,
        label: `${def.name} (${stockId})`,
        strikePrice: price,
      },
      now,
    );
    if (ensured.state !== state) {
      state = ensured.state;
      changed = true;
    }
  }

  if (changed) {
    await storePredictionState(state);
  }
  if (totalHouseYield > 0) {
    await creditHousePoolYield(totalHouseYield);
  }

  return { state, livePrices };
}

function formatResponseRounds(
  state: PredictionMarketState,
  livePrices: Record<string, number>,
  now: number,
) {
  return Object.values(state.rounds)
    .sort((a, b) => b.opensAt - a.opensAt || a.id.localeCompare(b.id))
    .map((r) => ({
      ...r,
      currentPrice: livePrices[`${r.kind}:${r.symbol}`] ?? r.finalPrice ?? r.strikePrice,
      bettingOpen: !r.settled && now < r.closesAt,
      totalPool: r.upPool + r.downPool,
    }));
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isPredictionEnabled() || !isEconomyEnabled()) return err("prediction_unavailable", 503);

  const now = Date.now();
  const isGuest = session.provider === "guest";
  const ownerKey = sessionOwnerKey(session);

  return withUserLock("prediction:global", async () => {
    const synced = await syncPredictionMarketLocked(now);
    let state = synced.state;
    let claimedNow = 0;

    if (!isGuest) {
      const claim = claimUserPredictionPayouts(state, ownerKey);
      if (claim.totalPayout > 0 || claim.betIds.length > 0) {
        if (claim.totalPayout > 0) {
          const paid = await payoutUserChunked(
            ownerKey,
            session.id,
            claim.totalPayout,
            "prediction_payout",
          );
          if (paid.state === "done" || paid.state === "pending") {
            state = claim.state;
            claimedNow = claim.totalPayout;
            await storePredictionState(state);
          }
        } else {
          state = claim.state;
          await storePredictionState(state);
        }
      }
    }

    const balance = isGuest ? null : await readUserBalance(session.id);
    const myBets = isGuest ? [] : state.bets.filter((b) => b.ownerKey === ownerKey).slice(0, 30);

    return NextResponse.json(
      {
        guest: isGuest,
        serverNow: now,
        limits: {
          minBet: PREDICTION_BET_MIN,
          maxBet: PREDICTION_BET_MAX,
          feeRate: PREDICTION_FEE_RATE,
        },
        rounds: formatResponseRounds(state, synced.livePrices, now),
        myBets,
        claimedNow,
        balance,
      },
      { headers: NO_STORE },
    );
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (session.provider === "guest") return err("guest_not_allowed", 403);
  if (!isPredictionEnabled() || !isEconomyEnabled()) return err("prediction_unavailable", 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }

  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;
  const action = body.action;

  return withUserLock("prediction:global", async () => {
    const now = Date.now();
    const synced = await syncPredictionMarketLocked(now);
    let state = synced.state;

    if (action === "bet") {
      const plan = planPredictionBet(state, {
        ownerKey,
        discordId,
        roundId: body.roundId,
        side: body.side,
        amount: body.amount,
        now,
      });
      if (!plan.ok) return err(plan.error, 400);

      const charged = await chargeUserChunked(
        ownerKey,
        discordId,
        plan.bet.amount,
        "prediction_bet",
        {
          refundReason: "prediction_refund",
        },
      );
      if (charged.state === "insufficient_funds") return err("not_enough_coins", 409);
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") return err("economy_failed", 409);

      if (!(await storePredictionState(plan.state))) {
        await payoutUserChunked(ownerKey, discordId, plan.bet.amount, "prediction_refund");
        return err("store_failed", 503);
      }

      return NextResponse.json(
        {
          ok: true,
          bet: plan.bet,
          rounds: formatResponseRounds(plan.state, synced.livePrices, now),
          myBets: plan.state.bets.filter((b) => b.ownerKey === ownerKey).slice(0, 30),
          balance: await readUserBalance(discordId),
        },
        { headers: NO_STORE },
      );
    }

    if (action === "claim") {
      const claim = claimUserPredictionPayouts(state, ownerKey);
      let paidOut = 0;
      if (claim.totalPayout > 0) {
        const paid = await payoutUserChunked(
          ownerKey,
          discordId,
          claim.totalPayout,
          "prediction_payout",
        );
        if (paid.state !== "done" && paid.state !== "pending") return err("economy_failed", 409);
        state = claim.state;
        paidOut = claim.totalPayout;
        await storePredictionState(state);
      }
      return NextResponse.json(
        {
          ok: true,
          claimed: paidOut,
          myBets: state.bets.filter((b) => b.ownerKey === ownerKey).slice(0, 30),
          balance: await readUserBalance(discordId),
        },
        { headers: NO_STORE },
      );
    }

    return err("invalid_action", 400);
  });
}
