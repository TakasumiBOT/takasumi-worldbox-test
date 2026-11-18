import { ITEMS, itemById, type ItemCategory } from "./items";

export const MARKET_FEE_RATE = 0.03;
export const MARKET_ORDER_LIMIT_PER_ACTOR = 25;
export const MARKET_ORDER_PRICE_MIN = 1;
export const MARKET_ORDER_PRICE_MAX = 1_000_000;
export const MARKET_ORDER_QTY_MIN = 1;
export const MARKET_ORDER_QTY_MAX = 999;
export const MARKET_HISTORY_LIMIT = 48;
export const MARKET_RECENT_TRADES_LIMIT = 60;

export type MarketSide = "buy" | "sell";
export type MarketActorType = "player" | "company";

export interface MarketOrder {
  id: string;
  side: MarketSide;
  actorType: MarketActorType;
  actorKey: string;
  discordId: string;
  companyId?: string;
  itemId: string;
  price: number;
  qty: number;
  filled: number;
  escrowedCoins: number;
  createdAt: number;
}

export interface MarketTrade {
  id: string;
  itemId: string;
  price: number;
  qty: number;
  total: number;
  fee: number;
  buyerKey: string;
  sellerKey: string;
  at: number;
}

export interface ItemMarketStats {
  itemId: string;
  lastPrice: number;
  volumeTotal: number;
  turnoverTotal: number;
  highPrice: number;
  lowPrice: number;
  history: number[];
  updatedAt: number;
}

export interface ActorPendingClaim {
  coins: number;
  items: Record<string, number>;
}

export interface CommoditiesMarketState {
  orders: MarketOrder[];
  trades: MarketTrade[];
  stats: Record<string, ItemMarketStats>;
  claims: Record<string, ActorPendingClaim>;
  feeTreasury: number;
  seq: number;
}

export function emptyCommoditiesMarket(): CommoditiesMarketState {
  return {
    orders: [],
    trades: [],
    stats: {},
    claims: {},
    feeTreasury: 0,
    seq: 0,
  };
}

export function orderRemaining(order: MarketOrder): number {
  return Math.max(0, order.qty - order.filled);
}

export function marketFeeFor(gross: number): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.floor(gross * MARKET_FEE_RATE);
}

function addClaimCoins(
  claims: Record<string, ActorPendingClaim>,
  actorKey: string,
  amount: number,
): void {
  if (amount <= 0) return;
  const cur = claims[actorKey] ?? { coins: 0, items: {} };
  claims[actorKey] = { ...cur, coins: cur.coins + amount };
}

function addClaimItem(
  claims: Record<string, ActorPendingClaim>,
  actorKey: string,
  itemId: string,
  qty: number,
): void {
  if (qty <= 0) return;
  const cur = claims[actorKey] ?? { coins: 0, items: {} };
  claims[actorKey] = {
    ...cur,
    items: { ...cur.items, [itemId]: (cur.items[itemId] ?? 0) + qty },
  };
}

function cloneClaims(claims: Record<string, ActorPendingClaim>): Record<string, ActorPendingClaim> {
  const out: Record<string, ActorPendingClaim> = {};
  for (const [k, v] of Object.entries(claims)) {
    out[k] = { coins: v.coins, items: { ...v.items } };
  }
  return out;
}

function recordStatsFill(
  statsMap: Record<string, ItemMarketStats>,
  itemId: string,
  price: number,
  qty: number,
  now: number,
): void {
  const item = itemById(itemId);
  const existing = statsMap[itemId];
  const basePrice = item?.price ?? price;
  if (!existing) {
    statsMap[itemId] = {
      itemId,
      lastPrice: price,
      volumeTotal: qty,
      turnoverTotal: price * qty,
      highPrice: Math.max(basePrice, price),
      lowPrice: Math.min(basePrice, price),
      history: [basePrice, price],
      updatedAt: now,
    };
    return;
  }
  const history = [...existing.history, price].slice(-MARKET_HISTORY_LIMIT);
  statsMap[itemId] = {
    ...existing,
    lastPrice: price,
    volumeTotal: existing.volumeTotal + qty,
    turnoverTotal: existing.turnoverTotal + price * qty,
    highPrice: Math.max(existing.highPrice, price),
    lowPrice: Math.min(existing.lowPrice, price),
    history,
    updatedAt: now,
  };
}

export interface PlaceMarketOrderInput {
  side: MarketSide;
  actorType: MarketActorType;
  actorKey: string;
  discordId: string;
  companyId?: string;
  itemId: unknown;
  price: unknown;
  qty: unknown;
  now: number;
}

export type PlaceOrderError = "unknown_item" | "invalid_price" | "invalid_qty" | "order_limit";

export interface PlaceOrderResult {
  state: CommoditiesMarketState;
  order: MarketOrder | null;
  trades: MarketTrade[];
  immediateItemsReceived: number;
  immediateCoinsReceived: number;
  refundCoins: number;
}

export function validateMarketPrice(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= MARKET_ORDER_PRICE_MIN && raw <= MARKET_ORDER_PRICE_MAX ? raw : null;
}

export function validateMarketQty(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= MARKET_ORDER_QTY_MIN && raw <= MARKET_ORDER_QTY_MAX ? raw : null;
}

/**
 * 価格優先・時間優先（Price-Time Priority）の板マッチングを実行する純粋関数。
 * 当事者（caller）が即時約定したアイテム／コインは戻り値で返し、
 * 相手方（resting counterparty）が受け取るべきコイン／アイテムは state.claims に安全に積む。
 */
export function placeMarketOrder(
  state: CommoditiesMarketState,
  input: PlaceMarketOrderInput,
): { ok: true; result: PlaceOrderResult } | { ok: false; error: PlaceOrderError } {
  const item = itemById(input.itemId);
  if (!item) return { ok: false, error: "unknown_item" };
  const price = validateMarketPrice(input.price);
  if (price === null) return { ok: false, error: "invalid_price" };
  const qty = validateMarketQty(input.qty);
  if (qty === null) return { ok: false, error: "invalid_qty" };

  const activeByActor = state.orders.filter(
    (o) => o.actorKey === input.actorKey && orderRemaining(o) > 0,
  ).length;
  if (activeByActor >= MARKET_ORDER_LIMIT_PER_ACTOR) {
    return { ok: false, error: "order_limit" };
  }

  let seq = state.seq + 1;
  const orderId = `MO${input.now.toString(36)}-${seq}`;
  let remaining = qty;
  let immediateItemsReceived = 0;
  let immediateCoinsReceived = 0;
  let refundCoins = 0;
  let feeTreasury = state.feeTreasury;

  const claims = cloneClaims(state.claims);
  const stats = { ...state.stats };
  const executedTrades: MarketTrade[] = [];

  const oppositeSide: MarketSide = input.side === "buy" ? "sell" : "buy";
  const candidates = state.orders
    .filter((o) => {
      if (o.itemId !== item.id || o.side !== oppositeSide || orderRemaining(o) <= 0) return false;
      if (o.actorKey === input.actorKey) return false; // ウォッシュトレード（自己売買）防止
      return input.side === "buy" ? o.price <= price : o.price >= price;
    })
    .sort((a, b) => {
      if (input.side === "buy") {
        return a.price - b.price || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
      }
      return b.price - a.price || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
    });

  const updatedOrders = new Map<string, MarketOrder>();
  for (const counter of candidates) {
    if (remaining <= 0) break;
    const avail = orderRemaining(counter);
    const fillQty = Math.min(remaining, avail);
    const fillPrice = counter.price;
    const gross = fillPrice * fillQty;
    const fee = marketFeeFor(gross);
    const sellerProceeds = Math.max(0, gross - fee);
    feeTreasury += fee;

    seq += 1;
    const trade: MarketTrade = {
      id: `MT${input.now.toString(36)}-${seq}`,
      itemId: item.id,
      price: fillPrice,
      qty: fillQty,
      total: gross,
      fee,
      buyerKey: input.side === "buy" ? input.actorKey : counter.actorKey,
      sellerKey: input.side === "sell" ? input.actorKey : counter.actorKey,
      at: input.now,
    };
    executedTrades.push(trade);
    recordStatsFill(stats, item.id, fillPrice, fillQty, input.now);

    if (input.side === "buy") {
      immediateItemsReceived += fillQty;
      if (price > fillPrice) {
        refundCoins += (price - fillPrice) * fillQty;
      }
      addClaimCoins(claims, counter.actorKey, sellerProceeds);
      updatedOrders.set(counter.id, {
        ...counter,
        filled: counter.filled + fillQty,
      });
    } else {
      immediateCoinsReceived += sellerProceeds;
      addClaimItem(claims, counter.actorKey, item.id, fillQty);
      updatedOrders.set(counter.id, {
        ...counter,
        filled: counter.filled + fillQty,
        escrowedCoins: Math.max(0, counter.escrowedCoins - gross),
      });
    }

    remaining -= fillQty;
  }

  const nextOrders: MarketOrder[] = [];
  for (const existing of state.orders) {
    const next = updatedOrders.get(existing.id) ?? existing;
    if (orderRemaining(next) > 0) nextOrders.push(next);
  }

  let restingOrder: MarketOrder | null = null;
  if (remaining > 0) {
    restingOrder = {
      id: orderId,
      side: input.side,
      actorType: input.actorType,
      actorKey: input.actorKey,
      discordId: input.discordId,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      itemId: item.id,
      price,
      qty,
      filled: qty - remaining,
      escrowedCoins: input.side === "buy" ? price * remaining : 0,
      createdAt: input.now,
    };
    nextOrders.push(restingOrder);
  }

  const trades = [...executedTrades.reverse(), ...state.trades].slice(
    0,
    MARKET_RECENT_TRADES_LIMIT,
  );

  return {
    ok: true,
    result: {
      state: {
        orders: nextOrders,
        trades,
        stats,
        claims,
        feeTreasury,
        seq,
      },
      order: restingOrder,
      trades: executedTrades,
      immediateItemsReceived,
      immediateCoinsReceived,
      refundCoins,
    },
  };
}

export function cancelMarketOrder(
  state: CommoditiesMarketState,
  orderId: unknown,
  actorKey: string,
):
  | {
      ok: true;
      state: CommoditiesMarketState;
      refundCoins: number;
      refundItems: number;
      itemId: string;
    }
  | { ok: false; error: "order_not_found" | "forbidden" } {
  if (typeof orderId !== "string") return { ok: false, error: "order_not_found" };
  const target = state.orders.find((o) => o.id === orderId);
  if (!target) return { ok: false, error: "order_not_found" };
  if (target.actorKey !== actorKey) return { ok: false, error: "forbidden" };

  const remaining = orderRemaining(target);
  const refundCoins =
    target.side === "buy" ? Math.min(target.escrowedCoins, target.price * remaining) : 0;
  const refundItems = target.side === "sell" ? remaining : 0;

  return {
    ok: true,
    state: {
      ...state,
      orders: state.orders.filter((o) => o.id !== orderId),
    },
    refundCoins,
    refundItems,
    itemId: target.itemId,
  };
}

export function takeActorClaims(
  state: CommoditiesMarketState,
  actorKey: string,
): { state: CommoditiesMarketState; claim: ActorPendingClaim } {
  const existing = state.claims[actorKey];
  if (!existing || (existing.coins <= 0 && Object.keys(existing.items).length === 0)) {
    return { state, claim: { coins: 0, items: {} } };
  }
  const nextClaims = cloneClaims(state.claims);
  delete nextClaims[actorKey];
  return {
    state: { ...state, claims: nextClaims },
    claim: { coins: existing.coins, items: { ...existing.items } },
  };
}

export interface BookLevel {
  price: number;
  qty: number;
  orders: number;
}

export function orderBookForItem(
  state: CommoditiesMarketState,
  itemId: string,
  depth = 8,
): { bids: BookLevel[]; asks: BookLevel[]; bestBid: number | null; bestAsk: number | null } {
  const bidMap = new Map<number, { qty: number; orders: number }>();
  const askMap = new Map<number, { qty: number; orders: number }>();
  for (const o of state.orders) {
    if (o.itemId !== itemId) continue;
    const rem = orderRemaining(o);
    if (rem <= 0) continue;
    const target = o.side === "buy" ? bidMap : askMap;
    const cur = target.get(o.price) ?? { qty: 0, orders: 0 };
    cur.qty += rem;
    cur.orders += 1;
    target.set(o.price, cur);
  }
  const bids = [...bidMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, depth)
    .map(([price, info]) => ({ price, qty: info.qty, orders: info.orders }));
  const asks = [...askMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, depth)
    .map(([price, info]) => ({ price, qty: info.qty, orders: info.orders }));
  return {
    bids,
    asks,
    bestBid: bids[0]?.price ?? null,
    bestAsk: asks[0]?.price ?? null,
  };
}

export interface SectorMacroIndex {
  category: string;
  priceRatio: number;
  turnover: number;
  volume: number;
}

/**
 * 株式（柱2）および為替FX（柱3）へ実体経済の景況・インフレ指数を受け渡す集計関数。
 */
export function computeCommodityMacroIndices(state: CommoditiesMarketState): {
  overallPriceRatio: number;
  totalTurnover: number;
  totalVolume: number;
  sectors: Record<ItemCategory, SectorMacroIndex>;
} {
  const groups = new Map<
    ItemCategory,
    { sumRatio: number; count: number; turnover: number; volume: number }
  >();
  for (const item of ITEMS) {
    const stat = state.stats[item.id];
    const ratio = stat && item.price > 0 ? stat.lastPrice / item.price : 1;
    const g = groups.get(item.category) ?? { sumRatio: 0, count: 0, turnover: 0, volume: 0 };
    if (stat) {
      g.sumRatio += ratio;
      g.count += 1;
      g.turnover += stat.turnoverTotal;
      g.volume += stat.volumeTotal;
    }
    groups.set(item.category, g);
  }
  const sectors = {} as Record<ItemCategory, SectorMacroIndex>;
  let allTurnover = 0;
  let allVolume = 0;
  let weightedSum = 0;
  let activeCount = 0;
  for (const cat of [
    "food",
    "material",
    "crafted",
    "special",
    "tool",
    "block",
    "seed",
    "crop",
    "furniture",
  ] as const) {
    const g = groups.get(cat) ?? { sumRatio: 0, count: 0, turnover: 0, volume: 0 };
    const ratio = g.count > 0 ? g.sumRatio / g.count : 1;
    sectors[cat] = {
      category: cat,
      priceRatio: Number(ratio.toFixed(4)),
      turnover: g.turnover,
      volume: g.volume,
    };
    allTurnover += g.turnover;
    allVolume += g.volume;
    if (g.count > 0) {
      weightedSum += g.sumRatio;
      activeCount += g.count;
    }
  }
  return {
    overallPriceRatio: activeCount > 0 ? Number((weightedSum / activeCount).toFixed(4)) : 1,
    totalTurnover: allTurnover,
    totalVolume: allVolume,
    sectors,
  };
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

export function parseCommoditiesMarket(raw: unknown): CommoditiesMarketState {
  const data = asRecord(raw);
  if (!data) return emptyCommoditiesMarket();

  const orders: MarketOrder[] = [];
  if (Array.isArray(data.orders)) {
    for (const entry of data.orders) {
      const o = asRecord(entry);
      if (!o || typeof o.id !== "string" || typeof o.itemId !== "string") continue;
      if (!itemById(o.itemId)) continue;
      if (o.side !== "buy" && o.side !== "sell") continue;
      if (o.actorType !== "player" && o.actorType !== "company") continue;
      if (typeof o.actorKey !== "string" || typeof o.discordId !== "string") continue;
      const price = validateMarketPrice(asInt(o.price));
      const qty = validateMarketQty(asInt(o.qty));
      if (price === null || qty === null) continue;
      const filled = Math.max(0, Math.min(qty, asInt(o.filled)));
      if (filled >= qty) continue;
      orders.push({
        id: o.id,
        side: o.side,
        actorType: o.actorType,
        actorKey: o.actorKey,
        discordId: o.discordId,
        ...(typeof o.companyId === "string" ? { companyId: o.companyId } : {}),
        itemId: o.itemId,
        price,
        qty,
        filled,
        escrowedCoins: Math.max(0, asInt(o.escrowedCoins)),
        createdAt: Math.max(0, asInt(o.createdAt)),
      });
    }
  }

  const trades: MarketTrade[] = [];
  if (Array.isArray(data.trades)) {
    for (const entry of data.trades.slice(0, MARKET_RECENT_TRADES_LIMIT)) {
      const t = asRecord(entry);
      if (!t || typeof t.id !== "string" || typeof t.itemId !== "string") continue;
      trades.push({
        id: t.id,
        itemId: t.itemId,
        price: Math.max(1, asInt(t.price, 1)),
        qty: Math.max(1, asInt(t.qty, 1)),
        total: Math.max(1, asInt(t.total, 1)),
        fee: Math.max(0, asInt(t.fee)),
        buyerKey: typeof t.buyerKey === "string" ? t.buyerKey : "",
        sellerKey: typeof t.sellerKey === "string" ? t.sellerKey : "",
        at: Math.max(0, asInt(t.at)),
      });
    }
  }

  const stats: Record<string, ItemMarketStats> = {};
  const statsRaw = asRecord(data.stats);
  if (statsRaw) {
    for (const [itemId, entry] of Object.entries(statsRaw)) {
      if (!itemById(itemId)) continue;
      const s = asRecord(entry);
      if (!s) continue;
      const history = Array.isArray(s.history)
        ? s.history
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n))
            .slice(-MARKET_HISTORY_LIMIT)
        : [];
      stats[itemId] = {
        itemId,
        lastPrice: Math.max(1, asInt(s.lastPrice, 1)),
        volumeTotal: Math.max(0, asInt(s.volumeTotal)),
        turnoverTotal: Math.max(0, asInt(s.turnoverTotal)),
        highPrice: Math.max(1, asInt(s.highPrice, 1)),
        lowPrice: Math.max(1, asInt(s.lowPrice, 1)),
        history,
        updatedAt: Math.max(0, asInt(s.updatedAt)),
      };
    }
  }

  const claims: Record<string, ActorPendingClaim> = {};
  const claimsRaw = asRecord(data.claims);
  if (claimsRaw) {
    for (const [actorKey, entry] of Object.entries(claimsRaw)) {
      const c = asRecord(entry);
      if (!c) continue;
      const items: Record<string, number> = {};
      const itemsRaw = asRecord(c.items);
      if (itemsRaw) {
        for (const [itemId, q] of Object.entries(itemsRaw)) {
          const n = asInt(q);
          if (n > 0 && itemById(itemId)) items[itemId] = n;
        }
      }
      const coins = Math.max(0, asInt(c.coins));
      if (coins > 0 || Object.keys(items).length > 0) {
        claims[actorKey] = { coins, items };
      }
    }
  }

  return {
    orders,
    trades,
    stats,
    claims,
    feeTreasury: Math.max(0, asInt(data.feeTreasury)),
    seq: Math.max(0, asInt(data.seq)),
  };
}
