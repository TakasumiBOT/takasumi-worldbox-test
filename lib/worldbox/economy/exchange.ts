import type { Company } from "../social/company";
import type { CommoditiesMarketState } from "./commodities";
import { computeCommodityMacroIndices } from "./commodities";
import { STOCKS, stockById, stockPrice, stockPriceHistory, stockPrevPrice } from "./stock";

export const IPO_MIN_COMPANY_ASSETS = 500_000;
export const IPO_LISTING_FEE = 25_000;
export const IPO_SHARES_MIN = 1_000;
export const IPO_SHARES_MAX = 100_000;
export const IPO_PUBLIC_PCT_MIN = 10;
export const IPO_PUBLIC_PCT_MAX = 50;
export const IPO_PRICE_MIN = 50;
export const IPO_PRICE_MAX = 50_000;
export const EXCHANGE_SELL_TAX_RATE = 0.05;
export const EXCHANGE_TRADE_FEE_RATE = 0.005;
export const EXCHANGE_HISTORY_LIMIT = 48;

const TICKER_RE = /^[A-Z][A-Z0-9]{2,5}$/;

export interface PlayerStockListing {
  ticker: string;
  companyId: string;
  companyName: string;
  founderKey: string;
  issuedShares: number;
  publicShares: number;
  poolCash: number;
  poolShares: number;
  anchorPrice: number;
  lastPrice: number;
  prevPrice: number;
  totalVolume: number;
  totalTurnover: number;
  totalDividendsPaid: number;
  history: number[];
  listedAt: number;
  updatedAt: number;
}

export interface NpcMarketAdjustment {
  netFlowShares: number;
  skewBps: number; // -3500 .. +5000 (-35% .. +50%)
  totalVolume: number;
  lastUpdatedAt: number;
}

export interface ExchangePortfolio {
  holdings: Record<string, number>; // ticker -> shares
  costBasis: Record<string, number>; // ticker -> total cost WBC
  claimableDividends: number;
}

export interface ExchangeState {
  listings: Record<string, PlayerStockListing>; // keyed by ticker
  npcAdj: Record<string, NpcMarketAdjustment>; // keyed by NPC stockId
  portfolios: Record<string, ExchangePortfolio>; // keyed by ownerKey
  feeTreasury: number;
  seq: number;
}

export function emptyExchangeState(): ExchangeState {
  return {
    listings: {},
    npcAdj: {},
    portfolios: {},
    feeTreasury: 0,
    seq: 0,
  };
}

export function validateTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  if (!TICKER_RE.test(t)) return null;
  if (stockById(t)) return null;
  return t;
}

const NPC_SECTOR_MAP: Record<string, readonly string[]> = {
  TAKASUMI: ["crafted", "special"],
  DEEDLE: ["tool", "crafted"],
  KIKURIN: ["food", "crop"],
  SOUPLE: ["food", "material"],
  JTTI: ["block", "material"],
  HOMURA: ["tool", "block"],
  YODOYAMA: ["crafted", "furniture"],
  TOMOTA: ["material", "tool"],
  RIPPLE: ["material", "special"],
  MINTAKA: ["crop", "food"],
};

export function sectorMacroMultiplier(stockId: string, market: CommoditiesMarketState): number {
  const macro = computeCommodityMacroIndices(market);
  const cats = NPC_SECTOR_MAP[stockId];
  if (!cats || cats.length === 0) return macro.overallPriceRatio;
  let sum = 0;
  for (const c of cats) {
    const idx = macro.sectors[c as keyof typeof macro.sectors];
    sum += idx ? idx.priceRatio : 1;
  }
  const avg = sum / cats.length;
  // 実体市場の価格指数変化をマイルドに株式ファンダメンタルへ反映 (0.75x ~ 1.35x)
  return Math.max(0.75, Math.min(1.35, 1 + (avg - 1) * 0.5));
}

export function dynamicNpcPrice(
  state: ExchangeState,
  stockId: string,
  market: CommoditiesMarketState,
  now: number,
): number {
  const def = stockById(stockId);
  if (!def) return 0;
  const base = stockPrice(def, now);
  const macro = sectorMacroMultiplier(stockId, market);
  const adj = state.npcAdj[stockId];
  const skewFactor = adj ? 1 + Math.max(-0.35, Math.min(0.5, adj.skewBps / 10_000)) : 1;
  return Math.max(10, Math.round(base * macro * skewFactor));
}

export function computeCompanyAnchorPrice(company: Company, issuedShares: number): number {
  const netEarn = Math.max(0, company.financials.totalRevenue - company.financials.totalCost);
  const enterpriseValue = Math.max(company.assets, Math.floor(company.assets + netEarn * 2.5));
  return Math.max(IPO_PRICE_MIN, Math.round(enterpriseValue / Math.max(1, issuedShares)));
}

export function listingCurrentPrice(listing: PlayerStockListing, company?: Company | null): number {
  const poolPrice =
    listing.poolShares > 0 ? listing.poolCash / listing.poolShares : listing.lastPrice;
  const anchor = company
    ? computeCompanyAnchorPrice(company, listing.issuedShares)
    : listing.anchorPrice;
  // AMM需給価格 (75%) + 企業ファンダメンタル評価 (25%) のブレンド
  return Math.max(10, Math.round(poolPrice * 0.75 + anchor * 0.25));
}

export type IpoError =
  | "already_listed"
  | "insufficient_assets"
  | "invalid_ticker"
  | "ticker_taken"
  | "invalid_shares"
  | "invalid_public_pct"
  | "invalid_price";

export function planCompanyIpo(
  state: ExchangeState,
  company: Company,
  input: {
    ticker: unknown;
    issuedShares: unknown;
    publicPct: unknown;
    ipoPrice: unknown;
  },
  now: number,
):
  | {
      ok: true;
      state: ExchangeState;
      listing: PlayerStockListing;
      founderShares: number;
      fee: number;
    }
  | { ok: false; error: IpoError } {
  if (company.ipo) return { ok: false, error: "already_listed" };
  if (company.assets < IPO_MIN_COMPANY_ASSETS) return { ok: false, error: "insufficient_assets" };
  const ticker = validateTicker(input.ticker);
  if (!ticker) return { ok: false, error: "invalid_ticker" };
  if (state.listings[ticker]) return { ok: false, error: "ticker_taken" };
  if (
    typeof input.issuedShares !== "number" ||
    !Number.isInteger(input.issuedShares) ||
    input.issuedShares < IPO_SHARES_MIN ||
    input.issuedShares > IPO_SHARES_MAX
  ) {
    return { ok: false, error: "invalid_shares" };
  }
  if (
    typeof input.publicPct !== "number" ||
    !Number.isInteger(input.publicPct) ||
    input.publicPct < IPO_PUBLIC_PCT_MIN ||
    input.publicPct > IPO_PUBLIC_PCT_MAX
  ) {
    return { ok: false, error: "invalid_public_pct" };
  }
  if (
    typeof input.ipoPrice !== "number" ||
    !Number.isInteger(input.ipoPrice) ||
    input.ipoPrice < IPO_PRICE_MIN ||
    input.ipoPrice > IPO_PRICE_MAX
  ) {
    return { ok: false, error: "invalid_price" };
  }

  const publicShares = Math.max(1, Math.floor((input.issuedShares * input.publicPct) / 100));
  const founderShares = input.issuedShares - publicShares;
  const poolCash = publicShares * input.ipoPrice;

  const listing: PlayerStockListing = {
    ticker,
    companyId: company.id,
    companyName: company.name,
    founderKey: company.ownerKey,
    issuedShares: input.issuedShares,
    publicShares,
    poolCash,
    poolShares: publicShares,
    anchorPrice: input.ipoPrice,
    lastPrice: input.ipoPrice,
    prevPrice: input.ipoPrice,
    totalVolume: 0,
    totalTurnover: 0,
    totalDividendsPaid: 0,
    history: [input.ipoPrice],
    listedAt: now,
    updatedAt: now,
  };

  const portfolios = { ...state.portfolios };
  const fp = portfolios[company.ownerKey] ?? {
    holdings: {},
    costBasis: {},
    claimableDividends: 0,
  };
  portfolios[company.ownerKey] = {
    ...fp,
    holdings: { ...fp.holdings, [ticker]: (fp.holdings[ticker] ?? 0) + founderShares },
    costBasis: { ...fp.costBasis, [ticker]: fp.costBasis[ticker] ?? 0 },
  };

  return {
    ok: true,
    state: {
      ...state,
      listings: { ...state.listings, [ticker]: listing },
      portfolios,
      seq: state.seq + 1,
    },
    listing,
    founderShares,
    fee: IPO_LISTING_FEE,
  };
}

export interface ExchangeTradePlan {
  symbol: string;
  isNpc: boolean;
  shares: number;
  execPrice: number;
  gross: number;
  fee: number;
  tax: number;
  netAmount: number; // buyなら必要総支払額、sellなら税・手数料引後の受取額
  nextState: ExchangeState;
  ipoPoolProceeds?: number; // 会社IPO株の初回買付等の場合、プール維持
}

export function planExchangeBuy(
  state: ExchangeState,
  ownerKey: string,
  symbolRaw: unknown,
  sharesRaw: unknown,
  market: CommoditiesMarketState,
  companiesById: ReadonlyMap<string, Company>,
  now: number,
): { ok: true; plan: ExchangeTradePlan } | { ok: false; error: string } {
  if (typeof symbolRaw !== "string") return { ok: false, error: "invalid_symbol" };
  const symbol = symbolRaw.trim().toUpperCase();
  if (
    typeof sharesRaw !== "number" ||
    !Number.isInteger(sharesRaw) ||
    sharesRaw < 1 ||
    sharesRaw > 10_000
  ) {
    return { ok: false, error: "invalid_shares" };
  }

  const portfolios = { ...state.portfolios };
  const userP = portfolios[ownerKey] ?? { holdings: {}, costBasis: {}, claimableDividends: 0 };

  const npc = stockById(symbol);
  if (npc) {
    const unitPrice = dynamicNpcPrice(state, symbol, market, now);
    const gross = unitPrice * sharesRaw;
    const fee = Math.floor(gross * EXCHANGE_TRADE_FEE_RATE);
    const total = gross + fee;
    const prevAdj = state.npcAdj[symbol] ?? {
      netFlowShares: 0,
      skewBps: 0,
      totalVolume: 0,
      lastUpdatedAt: now,
    };
    const bpsBump = Math.max(1, Math.round((sharesRaw / 50) * 15));
    const nextSkew = Math.max(-3500, Math.min(5000, prevAdj.skewBps + bpsBump));
    const nextNpcAdj = {
      ...state.npcAdj,
      [symbol]: {
        netFlowShares: prevAdj.netFlowShares + sharesRaw,
        skewBps: nextSkew,
        totalVolume: prevAdj.totalVolume + sharesRaw,
        lastUpdatedAt: now,
      },
    };
    portfolios[ownerKey] = {
      ...userP,
      holdings: { ...userP.holdings, [symbol]: (userP.holdings[symbol] ?? 0) + sharesRaw },
      costBasis: { ...userP.costBasis, [symbol]: (userP.costBasis[symbol] ?? 0) + total },
    };
    return {
      ok: true,
      plan: {
        symbol,
        isNpc: true,
        shares: sharesRaw,
        execPrice: unitPrice,
        gross,
        fee,
        tax: 0,
        netAmount: total,
        nextState: {
          ...state,
          npcAdj: nextNpcAdj,
          portfolios,
          feeTreasury: state.feeTreasury + fee,
          seq: state.seq + 1,
        },
      },
    };
  }

  const listing = state.listings[symbol];
  if (!listing) return { ok: false, error: "invalid_symbol" };
  if (sharesRaw >= listing.poolShares) return { ok: false, error: "insufficient_pool_liquidity" };

  // Constant-product AMM: x * y = k
  const k = listing.poolCash * listing.poolShares;
  const nextPoolShares = listing.poolShares - sharesRaw;
  const nextPoolCash = Math.ceil(k / nextPoolShares);
  const gross = Math.max(sharesRaw * 10, nextPoolCash - listing.poolCash);
  const fee = Math.floor(gross * EXCHANGE_TRADE_FEE_RATE);
  const total = gross + fee;
  const execPrice = Math.max(10, Math.round(gross / sharesRaw));

  const comp = companiesById.get(listing.companyId) ?? null;
  const updatedListingBase: PlayerStockListing = {
    ...listing,
    poolCash: nextPoolCash,
    poolShares: nextPoolShares,
    anchorPrice: comp ? computeCompanyAnchorPrice(comp, listing.issuedShares) : listing.anchorPrice,
    prevPrice: listing.lastPrice,
    totalVolume: listing.totalVolume + sharesRaw,
    totalTurnover: listing.totalTurnover + gross,
    updatedAt: now,
  };
  const nextPrice = listingCurrentPrice(updatedListingBase, comp);
  const updatedListing: PlayerStockListing = {
    ...updatedListingBase,
    lastPrice: nextPrice,
    history: [...listing.history, nextPrice].slice(-EXCHANGE_HISTORY_LIMIT),
  };

  portfolios[ownerKey] = {
    ...userP,
    holdings: { ...userP.holdings, [symbol]: (userP.holdings[symbol] ?? 0) + sharesRaw },
    costBasis: { ...userP.costBasis, [symbol]: (userP.costBasis[symbol] ?? 0) + total },
  };

  return {
    ok: true,
    plan: {
      symbol,
      isNpc: false,
      shares: sharesRaw,
      execPrice,
      gross,
      fee,
      tax: 0,
      netAmount: total,
      nextState: {
        ...state,
        listings: { ...state.listings, [symbol]: updatedListing },
        portfolios,
        feeTreasury: state.feeTreasury + fee,
        seq: state.seq + 1,
      },
    },
  };
}

export function planExchangeSell(
  state: ExchangeState,
  ownerKey: string,
  symbolRaw: unknown,
  sharesRaw: unknown,
  market: CommoditiesMarketState,
  companiesById: ReadonlyMap<string, Company>,
  now: number,
): { ok: true; plan: ExchangeTradePlan } | { ok: false; error: string } {
  if (typeof symbolRaw !== "string") return { ok: false, error: "invalid_symbol" };
  const symbol = symbolRaw.trim().toUpperCase();
  if (
    typeof sharesRaw !== "number" ||
    !Number.isInteger(sharesRaw) ||
    sharesRaw < 1 ||
    sharesRaw > 10_000
  ) {
    return { ok: false, error: "invalid_shares" };
  }

  const userP = state.portfolios[ownerKey] ?? {
    holdings: {},
    costBasis: {},
    claimableDividends: 0,
  };
  const held = userP.holdings[symbol] ?? 0;
  if (held < sharesRaw) return { ok: false, error: "not_enough_shares" };

  const portfolios = { ...state.portfolios };
  const nextHoldings = { ...userP.holdings };
  const nextCost = { ...userP.costBasis };
  const prevCost = nextCost[symbol] ?? 0;
  const remaining = held - sharesRaw;
  if (remaining === 0) {
    delete nextHoldings[symbol];
    delete nextCost[symbol];
  } else {
    nextHoldings[symbol] = remaining;
    nextCost[symbol] = Math.floor((prevCost * remaining) / held);
  }
  portfolios[ownerKey] = {
    ...userP,
    holdings: nextHoldings,
    costBasis: nextCost,
  };

  const npc = stockById(symbol);
  if (npc) {
    const unitPrice = dynamicNpcPrice(state, symbol, market, now);
    const gross = unitPrice * sharesRaw;
    const tax = Math.floor(gross * EXCHANGE_SELL_TAX_RATE);
    const fee = Math.floor(gross * EXCHANGE_TRADE_FEE_RATE);
    const net = Math.max(1, gross - tax - fee);
    const prevAdj = state.npcAdj[symbol] ?? {
      netFlowShares: 0,
      skewBps: 0,
      totalVolume: 0,
      lastUpdatedAt: now,
    };
    const bpsDrop = Math.max(1, Math.round((sharesRaw / 50) * 15));
    const nextSkew = Math.max(-3500, Math.min(5000, prevAdj.skewBps - bpsDrop));
    return {
      ok: true,
      plan: {
        symbol,
        isNpc: true,
        shares: sharesRaw,
        execPrice: unitPrice,
        gross,
        fee,
        tax,
        netAmount: net,
        nextState: {
          ...state,
          npcAdj: {
            ...state.npcAdj,
            [symbol]: {
              netFlowShares: prevAdj.netFlowShares - sharesRaw,
              skewBps: nextSkew,
              totalVolume: prevAdj.totalVolume + sharesRaw,
              lastUpdatedAt: now,
            },
          },
          portfolios,
          feeTreasury: state.feeTreasury + fee + tax,
          seq: state.seq + 1,
        },
      },
    };
  }

  const listing = state.listings[symbol];
  if (!listing) return { ok: false, error: "invalid_symbol" };

  const k = listing.poolCash * listing.poolShares;
  const nextPoolShares = listing.poolShares + sharesRaw;
  const nextPoolCash = Math.max(1, Math.floor(k / nextPoolShares));
  const gross = Math.max(1, listing.poolCash - nextPoolCash);
  const tax = Math.floor(gross * EXCHANGE_SELL_TAX_RATE);
  const fee = Math.floor(gross * EXCHANGE_TRADE_FEE_RATE);
  const net = Math.max(1, gross - tax - fee);
  const execPrice = Math.max(1, Math.round(gross / sharesRaw));

  const comp = companiesById.get(listing.companyId) ?? null;
  const updatedListingBase: PlayerStockListing = {
    ...listing,
    poolCash: nextPoolCash,
    poolShares: nextPoolShares,
    anchorPrice: comp ? computeCompanyAnchorPrice(comp, listing.issuedShares) : listing.anchorPrice,
    prevPrice: listing.lastPrice,
    totalVolume: listing.totalVolume + sharesRaw,
    totalTurnover: listing.totalTurnover + gross,
    updatedAt: now,
  };
  const nextPrice = listingCurrentPrice(updatedListingBase, comp);
  const updatedListing: PlayerStockListing = {
    ...updatedListingBase,
    lastPrice: nextPrice,
    history: [...listing.history, nextPrice].slice(-EXCHANGE_HISTORY_LIMIT),
  };

  return {
    ok: true,
    plan: {
      symbol,
      isNpc: false,
      shares: sharesRaw,
      execPrice,
      gross,
      fee,
      tax,
      netAmount: net,
      nextState: {
        ...state,
        listings: { ...state.listings, [symbol]: updatedListing },
        portfolios,
        feeTreasury: state.feeTreasury + fee + tax,
        seq: state.seq + 1,
      },
    },
  };
}

export function planCorporateDividend(
  state: ExchangeState,
  company: Company,
  totalAmountRaw: unknown,
):
  | {
      ok: true;
      state: ExchangeState;
      totalDistributed: number;
      perShare: number;
      recipientCount: number;
    }
  | { ok: false; error: "not_listed" | "invalid_amount" | "insufficient_assets" } {
  if (!company.ipo) return { ok: false, error: "not_listed" };
  const listing = state.listings[company.ipo.ticker];
  if (!listing) return { ok: false, error: "not_listed" };
  if (
    typeof totalAmountRaw !== "number" ||
    !Number.isInteger(totalAmountRaw) ||
    totalAmountRaw < 10_000
  ) {
    return { ok: false, error: "invalid_amount" };
  }
  if (totalAmountRaw > Math.floor(company.assets * 0.5)) {
    return { ok: false, error: "insufficient_assets" };
  }

  let heldTotal = 0;
  for (const p of Object.values(state.portfolios)) {
    heldTotal += p.holdings[listing.ticker] ?? 0;
  }
  if (heldTotal <= 0) return { ok: false, error: "invalid_amount" };

  const perShare = Math.floor(totalAmountRaw / heldTotal);
  if (perShare < 1) return { ok: false, error: "invalid_amount" };

  const portfolios = { ...state.portfolios };
  let totalDistributed = 0;
  let recipientCount = 0;
  for (const [ownerKey, p] of Object.entries(portfolios)) {
    const shares = p.holdings[listing.ticker] ?? 0;
    if (shares <= 0) continue;
    const payout = shares * perShare;
    portfolios[ownerKey] = {
      ...p,
      claimableDividends: p.claimableDividends + payout,
    };
    totalDistributed += payout;
    recipientCount += 1;
  }

  return {
    ok: true,
    state: {
      ...state,
      portfolios,
      listings: {
        ...state.listings,
        [listing.ticker]: {
          ...listing,
          totalDividendsPaid: listing.totalDividendsPaid + totalDistributed,
        },
      },
    },
    totalDistributed,
    perShare,
    recipientCount,
  };
}

export function computePortfolioValue(
  state: ExchangeState,
  ownerKey: string,
  market: CommoditiesMarketState,
  companiesById: ReadonlyMap<string, Company>,
  now: number,
): number {
  const p = state.portfolios[ownerKey];
  if (!p) return 0;
  let total = 0;
  for (const [symbol, shares] of Object.entries(p.holdings)) {
    if (shares <= 0) continue;
    if (stockById(symbol)) {
      total += dynamicNpcPrice(state, symbol, market, now) * shares;
    } else if (state.listings[symbol]) {
      const l = state.listings[symbol];
      total += listingCurrentPrice(l, companiesById.get(l.companyId) ?? null) * shares;
    }
  }
  return total;
}

export function buildExchangeMarketView(
  state: ExchangeState,
  market: CommoditiesMarketState,
  companiesById: ReadonlyMap<string, Company>,
  now: number,
) {
  const npcList = STOCKS.map((def) => {
    const price = dynamicNpcPrice(state, def.id, market, now);
    const prevPrice = stockPrevPrice(def, now);
    const adj = state.npcAdj[def.id];
    const baseHist = stockPriceHistory(def, now, 47);
    return {
      id: def.id,
      name: def.name,
      industry: def.industry,
      kind: "npc" as const,
      price,
      prevPrice,
      change: price - prevPrice,
      dividendAmount: def.dividendAmount,
      dividendRate: def.dividendRate,
      skewBps: adj?.skewBps ?? 0,
      volume: adj?.totalVolume ?? 0,
      history: [...baseHist, price],
    };
  });

  const ipoList = Object.values(state.listings).map((listing) => {
    const comp = companiesById.get(listing.companyId) ?? null;
    const price = listingCurrentPrice(listing, comp);
    const marketCap = price * listing.issuedShares;
    const assets = comp?.assets ?? listing.poolCash;
    const pbr = Number((marketCap / Math.max(1, assets)).toFixed(2));
    return {
      id: listing.ticker,
      name: `${comp?.name ?? listing.companyName}`,
      industry: "上場プレイヤー企業",
      kind: "company" as const,
      companyId: listing.companyId,
      price,
      prevPrice: listing.prevPrice,
      change: price - listing.prevPrice,
      issuedShares: listing.issuedShares,
      poolShares: listing.poolShares,
      marketCap,
      pbr,
      totalDividendsPaid: listing.totalDividendsPaid,
      volume: listing.totalVolume,
      history: listing.history,
    };
  });

  return { npcList, ipoList };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  let raw = v;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function asInt(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

export function parseExchangeState(raw: unknown): ExchangeState {
  const data = asRecord(raw);
  if (!data) return emptyExchangeState();

  const listings: Record<string, PlayerStockListing> = {};
  const listRaw = asRecord(data.listings);
  if (listRaw) {
    for (const [ticker, entry] of Object.entries(listRaw)) {
      const l = asRecord(entry);
      if (!l || typeof l.companyId !== "string" || typeof l.founderKey !== "string") continue;
      if (!TICKER_RE.test(ticker)) continue;
      const history = Array.isArray(l.history)
        ? l.history
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n))
            .slice(-EXCHANGE_HISTORY_LIMIT)
        : [];
      listings[ticker] = {
        ticker,
        companyId: l.companyId,
        companyName: typeof l.companyName === "string" ? l.companyName : ticker,
        founderKey: l.founderKey,
        issuedShares: Math.max(1, asInt(l.issuedShares, 1000)),
        publicShares: Math.max(1, asInt(l.publicShares, 100)),
        poolCash: Math.max(100, asInt(l.poolCash, 10000)),
        poolShares: Math.max(1, asInt(l.poolShares, 100)),
        anchorPrice: Math.max(10, asInt(l.anchorPrice, 100)),
        lastPrice: Math.max(10, asInt(l.lastPrice, 100)),
        prevPrice: Math.max(10, asInt(l.prevPrice, 100)),
        totalVolume: Math.max(0, asInt(l.totalVolume)),
        totalTurnover: Math.max(0, asInt(l.totalTurnover)),
        totalDividendsPaid: Math.max(0, asInt(l.totalDividendsPaid)),
        history,
        listedAt: Math.max(0, asInt(l.listedAt)),
        updatedAt: Math.max(0, asInt(l.updatedAt)),
      };
    }
  }

  const npcAdj: Record<string, NpcMarketAdjustment> = {};
  const adjRaw = asRecord(data.npcAdj);
  if (adjRaw) {
    for (const [id, entry] of Object.entries(adjRaw)) {
      if (!stockById(id)) continue;
      const a = asRecord(entry);
      if (!a) continue;
      npcAdj[id] = {
        netFlowShares: asInt(a.netFlowShares),
        skewBps: Math.max(-3500, Math.min(5000, asInt(a.skewBps))),
        totalVolume: Math.max(0, asInt(a.totalVolume)),
        lastUpdatedAt: Math.max(0, asInt(a.lastUpdatedAt)),
      };
    }
  }

  const portfolios: Record<string, ExchangePortfolio> = {};
  const portRaw = asRecord(data.portfolios);
  if (portRaw) {
    for (const [ownerKey, entry] of Object.entries(portRaw)) {
      const p = asRecord(entry);
      if (!p) continue;
      const holdings: Record<string, number> = {};
      const hRaw = asRecord(p.holdings);
      if (hRaw) {
        for (const [sym, q] of Object.entries(hRaw)) {
          const n = asInt(q);
          if (n > 0) holdings[sym] = n;
        }
      }
      const costBasis: Record<string, number> = {};
      const cRaw = asRecord(p.costBasis);
      if (cRaw) {
        for (const [sym, q] of Object.entries(cRaw)) {
          const n = asInt(q);
          if (n >= 0) costBasis[sym] = n;
        }
      }
      portfolios[ownerKey] = {
        holdings,
        costBasis,
        claimableDividends: Math.max(0, asInt(p.claimableDividends)),
      };
    }
  }

  return {
    listings,
    npcAdj,
    portfolios,
    feeTreasury: Math.max(0, asInt(data.feeTreasury)),
    seq: Math.max(0, asInt(data.seq)),
  };
}
