import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { loadCommoditiesMarket } from "@/lib/worldbox/economy/commodities-online";
import { isEconomyEnabled, readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import {
  closeFxMarginPosition,
  evaluateMarginPosition,
  FX_CURRENCIES,
  FX_UNIT_SCALE,
  fxCurrencyById,
  fxQuote,
  fxSpotPortfolioValue,
  fxSpotSwapBuy,
  fxSpotSwapSell,
  openFxMarginPosition,
} from "@/lib/worldbox/economy/fx";
import { isFxEnabled, loadFxState, storeFxState } from "@/lib/worldbox/economy/fx-online";
import { chargeUserChunked, payoutUserChunked } from "@/lib/worldbox/economy/settlement";
import { loadNationsState } from "@/lib/worldbox/social/nations-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isFxEnabled() || !isEconomyEnabled()) return err("fx_unavailable", 503);

  const now = Date.now();
  const ownerKey = sessionOwnerKey(session);
  const isGuest = session.provider === "guest";

  const [fx, commodities, nations] = await Promise.all([
    loadFxState(),
    loadCommoditiesMarket(),
    loadNationsState(),
  ]);
  const nationCount = Object.keys(nations.nations).length;

  const pairs = FX_CURRENCIES.map((def) => {
    const q = fxQuote(def, fx, commodities, nationCount, now);
    const flow = fx.flows[def.id];
    return {
      id: def.id,
      name: def.name,
      desc: def.desc,
      apr: def.apr,
      mid: q.mid,
      bid: q.bid,
      ask: q.ask,
      volumeWbc: flow?.volumeWbc ?? 0,
      skewBps: flow?.skewBps ?? 0,
      history: flow?.history ?? [q.mid],
    };
  });

  const positionsView = fx.positions
    .map((p) => {
      const def = fxCurrencyById(p.currency);
      if (!def) return null;
      const q = fxQuote(def, fx, commodities, nationCount, now);
      const closeRate = p.side === "long" ? q.bid : q.ask;
      const ev = evaluateMarginPosition(p, closeRate, def, now);
      return {
        id: p.id,
        mine: p.ownerKey === ownerKey,
        currency: p.currency,
        side: p.side,
        leverage: p.leverage,
        marginWbc: p.marginWbc,
        notionalWbc: p.notionalWbc,
        entryRate: p.entryRate,
        currentRate: closeRate,
        unrealizedPnl: ev.unrealizedPnl,
        swapAccrued: ev.totalSwap,
        equity: ev.equity,
        marginRatio: Number(ev.marginRatio.toFixed(3)),
        liquidatable: ev.liquidatable,
        openedAt: p.openedAt,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (isGuest) {
    return NextResponse.json(
      {
        guest: true,
        serverNow: now,
        pairs,
        wallet: {},
        walletValueWbc: 0,
        positions: [],
        liquidatablePositions: [],
        balance: null,
      },
      { headers: NO_STORE },
    );
  }

  const balance = await readUserBalance(session.id);
  return NextResponse.json(
    {
      guest: false,
      serverNow: now,
      unitScale: FX_UNIT_SCALE,
      pairs,
      wallet: fx.accounts[ownerKey]?.balances ?? {},
      walletValueWbc: fxSpotPortfolioValue(fx, ownerKey, commodities, nationCount, now),
      positions: positionsView.filter((p) => p.mine),
      liquidatablePositions: positionsView.filter((p) => !p.mine && p.liquidatable),
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
  if (!isFxEnabled() || !isEconomyEnabled()) return err("fx_unavailable", 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }

  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;
  const action = body.action;

  return withUserLock("fx:global", async () => {
    const now = Date.now();
    const [fx, commodities, nations] = await Promise.all([
      loadFxState(),
      loadCommoditiesMarket(),
      loadNationsState(),
    ]);
    const nationCount = Object.keys(nations.nations).length;

    if (action === "swap_buy") {
      const plan = fxSpotSwapBuy(
        fx,
        ownerKey,
        body.currency,
        body.wbcAmount,
        commodities,
        nationCount,
        now,
      );
      if (!plan.ok) return err(plan.error, 400);
      const charged = await chargeUserChunked(ownerKey, discordId, plan.wbcSpent, "fx_swap_buy", {
        refundReason: "fx_exchange",
      });
      if (charged.state === "insufficient_funds") return err("not_enough_coins", 409);
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") return err("economy_failed", 409);

      if (!(await storeFxState(plan.state))) {
        await payoutUserChunked(ownerKey, discordId, plan.wbcSpent, "fx_exchange");
        return err("store_failed", 503);
      }
      const balance = await readUserBalance(discordId);
      return NextResponse.json(
        {
          ok: true,
          currency: plan.currency,
          wbcSpent: plan.wbcSpent,
          centiReceived: plan.centiReceived,
          askRate: plan.askRate,
          balance,
          wallet: plan.state.accounts[ownerKey]?.balances ?? {},
        },
        { headers: NO_STORE },
      );
    }

    if (action === "swap_sell") {
      const plan = fxSpotSwapSell(
        fx,
        ownerKey,
        body.currency,
        body.centiUnits,
        commodities,
        nationCount,
        now,
      );
      if (!plan.ok) return err(plan.error, 400);
      if (!(await storeFxState(plan.state))) return err("store_failed", 503);
      const paid = await payoutUserChunked(ownerKey, discordId, plan.wbcReceived, "fx_exchange");
      if (paid.state !== "done" && paid.state !== "pending") {
        await storeFxState(fx);
        return err("economy_failed", 409);
      }
      const balance = await readUserBalance(discordId);
      return NextResponse.json(
        {
          ok: true,
          currency: plan.currency,
          centiSold: plan.centiSold,
          wbcReceived: plan.wbcReceived,
          bidRate: plan.bidRate,
          balance,
          wallet: plan.state.accounts[ownerKey]?.balances ?? {},
        },
        { headers: NO_STORE },
      );
    }

    if (action === "open_margin") {
      const plan = openFxMarginPosition(
        fx,
        {
          ownerKey,
          discordId,
          currency: body.currency,
          side: body.side,
          leverage: body.leverage,
          marginWbc: body.marginWbc,
          now,
        },
        commodities,
        nationCount,
      );
      if (!plan.ok) return err(plan.error, 400);

      const charged = await chargeUserChunked(
        ownerKey,
        discordId,
        plan.position.marginWbc,
        "fx_margin_open",
        { refundReason: "fx_margin_close" },
      );
      if (charged.state === "insufficient_funds") return err("not_enough_coins", 409);
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") return err("economy_failed", 409);

      if (!(await storeFxState(plan.state))) {
        await payoutUserChunked(ownerKey, discordId, plan.position.marginWbc, "fx_margin_close");
        return err("store_failed", 503);
      }
      const balance = await readUserBalance(discordId);
      return NextResponse.json(
        { ok: true, position: plan.position, balance },
        { headers: NO_STORE },
      );
    }

    if (action === "close_margin") {
      const plan = closeFxMarginPosition(
        fx,
        body.positionId,
        ownerKey,
        commodities,
        nationCount,
        now,
        true,
      );
      if (!plan.ok) return err(plan.error, 400);

      if (!(await storeFxState(plan.state))) return err("store_failed", 503);
      if (plan.payout > 0 && plan.position.discordId) {
        await payoutUserChunked(
          plan.position.ownerKey,
          plan.position.discordId,
          plan.payout,
          "fx_margin_close",
        );
      }
      if (plan.liquidatorReward > 0) {
        await payoutUserChunked(ownerKey, discordId, plan.liquidatorReward, "fx_margin_close");
      }
      const balance = await readUserBalance(discordId);
      return NextResponse.json(
        {
          ok: true,
          payout: plan.payout,
          liquidatorReward: plan.liquidatorReward,
          pnl: plan.pnl,
          liquidated: plan.liquidated,
          balance,
        },
        { headers: NO_STORE },
      );
    }

    return err("invalid_action", 400);
  });
}
