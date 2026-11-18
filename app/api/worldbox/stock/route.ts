import { NextResponse } from "next/server";
import { getRequestSession, isSameOriginRequest, sessionOwnerKey } from "@/lib/auth";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { loadCommoditiesMarket } from "@/lib/worldbox/economy/commodities-online";
import { readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import {
  buildExchangeMarketView,
  computePortfolioValue,
  dynamicNpcPrice,
  listingCurrentPrice,
  planExchangeBuy,
  planExchangeSell,
  type ExchangeState,
} from "@/lib/worldbox/economy/exchange";
import {
  flushExchangeDividends,
  isExchangeEnabled,
  loadExchangeState,
  storeExchangeState,
  syncNpcHoldingsForDividendCron,
} from "@/lib/worldbox/economy/exchange-online";
import { chargeUserChunked, payoutUserChunked } from "@/lib/worldbox/economy/settlement";
import { stockById } from "@/lib/worldbox/economy/stock";
import { isStockEnabled, loadStockAccount } from "@/lib/worldbox/economy/stock-online";
import type { Company } from "@/lib/worldbox/social/company";
import { loadAllCompanies } from "@/lib/worldbox/social/company-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  return isSameOriginRequest(request);
}

function mergeLegacyPortfolio(
  state: ExchangeState,
  ownerKey: string,
  legacyHoldings: Record<string, number>,
): ExchangeState {
  const existing = state.portfolios[ownerKey];
  if (existing && Object.keys(existing.holdings).length > 0) return state;
  const nonZero = Object.entries(legacyHoldings).filter(([, s]) => s > 0);
  if (nonZero.length === 0) return state;
  const holdings: Record<string, number> = { ...(existing?.holdings ?? {}) };
  for (const [sym, shares] of nonZero) {
    if ((holdings[sym] ?? 0) === 0) holdings[sym] = shares;
  }
  return {
    ...state,
    portfolios: {
      ...state.portfolios,
      [ownerKey]: {
        holdings,
        costBasis: existing?.costBasis ?? {},
        claimableDividends: existing?.claimableDividends ?? 0,
      },
    },
  };
}

function buildHoldingsView(
  state: ExchangeState,
  ownerKey: string,
  marketState: Awaited<ReturnType<typeof loadCommoditiesMarket>>,
  companiesById: ReadonlyMap<string, Company>,
  now: number,
) {
  const p = state.portfolios[ownerKey];
  if (!p) return [];
  const out: {
    stockId: string;
    name: string;
    kind: "npc" | "company";
    shares: number;
    price: number;
    value: number;
    costBasis: number;
  }[] = [];

  for (const [symbol, shares] of Object.entries(p.holdings)) {
    if (shares <= 0) continue;
    const npc = stockById(symbol);
    if (npc) {
      const price = dynamicNpcPrice(state, symbol, marketState, now);
      out.push({
        stockId: symbol,
        name: npc.name,
        kind: "npc",
        shares,
        price,
        value: shares * price,
        costBasis: p.costBasis[symbol] ?? 0,
      });
      continue;
    }
    const listing = state.listings[symbol];
    if (listing) {
      const comp = companiesById.get(listing.companyId) ?? null;
      const price = listingCurrentPrice(listing, comp);
      out.push({
        stockId: symbol,
        name: comp?.name ?? listing.companyName,
        kind: "company",
        shares,
        price,
        value: shares * price,
        costBasis: p.costBasis[symbol] ?? 0,
      });
    }
  }
  return out;
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const now = Date.now();
  const [exchangeRaw, commodities, companies] = await Promise.all([
    loadExchangeState(),
    loadCommoditiesMarket(),
    loadAllCompanies(),
  ]);
  const companiesById = new Map(companies.map((c) => [c.id, c]));
  const { npcList, ipoList } = buildExchangeMarketView(
    exchangeRaw,
    commodities,
    companiesById,
    now,
  );
  const market = [...npcList, ...ipoList];

  if (session.provider === "guest") {
    return NextResponse.json(
      {
        guest: true,
        serverNow: now,
        market,
        holdings: [],
        holdingsValue: 0,
        dividends: [],
        balance: null,
      },
      { headers: NO_STORE },
    );
  }
  if (!isStockEnabled() || !isExchangeEnabled()) return err("economy_unavailable", 503);
  const ownerKey = sessionOwnerKey(session);

  return withUserLock("exchange:global", async () => {
    let exchange = await loadExchangeState();
    const legacyAccount = await loadStockAccount(ownerKey);
    exchange = mergeLegacyPortfolio(exchange, ownerKey, legacyAccount.holdings);
    const flushed = await flushExchangeDividends(exchange, ownerKey, session.id);
    exchange = flushed.state;
    const balance = await readUserBalance(session.id);

    const viewMarket = buildExchangeMarketView(exchange, commodities, companiesById, now);
    const combinedMarket = [...viewMarket.npcList, ...viewMarket.ipoList];
    const holdings = buildHoldingsView(exchange, ownerKey, commodities, companiesById, now);
    const holdingsValue = computePortfolioValue(
      exchange,
      ownerKey,
      commodities,
      companiesById,
      now,
    );

    return NextResponse.json(
      {
        guest: false,
        serverNow: now,
        market: combinedMarket,
        holdings,
        holdingsValue,
        dividends: legacyAccount.dividends,
        dividendClaimedNow: flushed.paid,
        balance,
      },
      { headers: NO_STORE },
    );
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (session.provider === "guest") return err("guest_not_allowed", 403);
  if (!isStockEnabled() || !isExchangeEnabled()) return err("economy_unavailable", 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }
  const action = body.action;
  if (action !== "buy" && action !== "sell") return err("invalid_action", 400);
  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;

  return withUserLock("exchange:global", async () => {
    const station = await loadMyLobbyStation(ownerKey);
    if (station !== "stock") return err("not_at_exchange", 409);
    const now = Date.now();

    const [exchangeInit, commodities, companies, legacyAccount] = await Promise.all([
      loadExchangeState(),
      loadCommoditiesMarket(),
      loadAllCompanies(),
      loadStockAccount(ownerKey),
    ]);
    let exchange = mergeLegacyPortfolio(exchangeInit, ownerKey, legacyAccount.holdings);
    const companiesById = new Map(companies.map((c) => [c.id, c]));

    const symbol = typeof body.stockId === "string" ? body.stockId.trim().toUpperCase() : "";
    const count = body.count;

    if (action === "buy") {
      const planned = planExchangeBuy(
        exchange,
        ownerKey,
        symbol,
        count,
        commodities,
        companiesById,
        now,
      );
      if (!planned.ok)
        return err(
          planned.error === "invalid_symbol" || planned.error === "invalid_shares"
            ? "invalid_trade"
            : planned.error,
          400,
        );

      const charged = await chargeUserChunked(
        ownerKey,
        discordId,
        planned.plan.netAmount,
        "stock_buy",
        {
          refundReason: "market_refund",
        },
      );
      if (charged.state === "insufficient_funds") return err("not_enough_coins");
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") return err("economy_failed");

      if (!(await storeExchangeState(planned.plan.nextState))) {
        await payoutUserChunked(ownerKey, discordId, planned.plan.netAmount, "market_refund");
        return err("economy_unavailable", 503);
      }
      await syncNpcHoldingsForDividendCron(
        ownerKey,
        planned.plan.nextState.portfolios[ownerKey]?.holdings ?? {},
      );
      const after = await readUserBalance(discordId);
      const viewMarket = buildExchangeMarketView(
        planned.plan.nextState,
        commodities,
        companiesById,
        now,
      );
      return NextResponse.json(
        {
          ok: true,
          kind: "buy",
          stockId: planned.plan.symbol,
          count: planned.plan.shares,
          price: planned.plan.execPrice,
          fee: planned.plan.fee,
          total: planned.plan.netAmount,
          balance: after,
          market: [...viewMarket.npcList, ...viewMarket.ipoList],
          holdings: buildHoldingsView(
            planned.plan.nextState,
            ownerKey,
            commodities,
            companiesById,
            now,
          ),
          holdingsValue: computePortfolioValue(
            planned.plan.nextState,
            ownerKey,
            commodities,
            companiesById,
            now,
          ),
        },
        { headers: NO_STORE },
      );
    }

    const planned = planExchangeSell(
      exchange,
      ownerKey,
      symbol,
      count,
      commodities,
      companiesById,
      now,
    );
    if (!planned.ok) {
      return err(
        planned.error === "invalid_symbol" ||
          planned.error === "invalid_shares" ||
          planned.error === "not_enough_shares"
          ? "invalid_trade"
          : planned.error,
        400,
      );
    }
    const paid = await payoutUserChunked(ownerKey, discordId, planned.plan.netAmount, "stock_sell");
    if (paid.state === "unavailable") return err("economy_unavailable", 503);
    if (paid.state !== "done" && paid.state !== "pending") return err("economy_failed");

    if (!(await storeExchangeState(planned.plan.nextState))) return err("economy_unavailable", 503);
    await syncNpcHoldingsForDividendCron(
      ownerKey,
      planned.plan.nextState.portfolios[ownerKey]?.holdings ?? {},
    );
    const after = await readUserBalance(discordId);
    const viewMarket = buildExchangeMarketView(
      planned.plan.nextState,
      commodities,
      companiesById,
      now,
    );
    return NextResponse.json(
      {
        ok: true,
        kind: "sell",
        stockId: planned.plan.symbol,
        price: planned.plan.execPrice,
        gross: planned.plan.gross,
        tax: planned.plan.tax,
        fee: planned.plan.fee,
        net: planned.plan.netAmount,
        balance: after,
        market: [...viewMarket.npcList, ...viewMarket.ipoList],
        holdings: buildHoldingsView(
          planned.plan.nextState,
          ownerKey,
          commodities,
          companiesById,
          now,
        ),
        holdingsValue: computePortfolioValue(
          planned.plan.nextState,
          ownerKey,
          commodities,
          companiesById,
          now,
        ),
      },
      { headers: NO_STORE },
    );
  });
}
