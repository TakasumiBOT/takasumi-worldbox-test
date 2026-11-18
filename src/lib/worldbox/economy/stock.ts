import { createHash } from "node:crypto";

export const STOCK_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
export const STOCK_SERIES_LENGTH = 8_760;
export const STOCK_TICK_MS = 3_600_000;
export const STOCK_PRICE_MIN = 10;
export const STOCK_PRICE_MAX = 999_999;
export const STOCK_COUNT_MAX = 100_000;
export const STOCK_TRADE_TOTAL_MAX = 1_000_000;
export const STOCK_SELL_TAX_RATE = 0.1;
export const STOCK_DIVIDEND_SHARES_CAP = 10_000;
export const STOCK_DIVIDEND_LOG_LIMIT = 30;

export interface StockDef {
  id: string;
  name: string;
  industry: string;
  dividendAmount: number;
  dividendRate: number;
  basePrice: number;
  volatility: number;
  seed: number;
}

export const STOCKS: readonly StockDef[] = [
  {
    id: "TOMOTA",
    name: "トモタ自動車",
    industry: "自動車",
    dividendAmount: 500,
    dividendRate: 0.001,
    basePrice: 2_800,
    volatility: 0.006,
    seed: 11,
  },
  {
    id: "DEEDLE",
    name: "Deedle",
    industry: "IT・検索サービス",
    dividendAmount: 300,
    dividendRate: 0.0012,
    basePrice: 4_200,
    volatility: 0.009,
    seed: 23,
  },
  {
    id: "JTTI",
    name: "JTTI",
    industry: "通信",
    dividendAmount: 1_000,
    dividendRate: 0.0008,
    basePrice: 1_900,
    volatility: 0.005,
    seed: 37,
  },
  {
    id: "RIPPLE",
    name: "Ripple",
    industry: "金融・決済",
    dividendAmount: 2_000,
    dividendRate: 0.0005,
    basePrice: 650,
    volatility: 0.012,
    seed: 41,
  },
  {
    id: "KAKAPO",
    name: "カカポエアライン",
    industry: "航空",
    dividendAmount: 800,
    dividendRate: 0.0009,
    basePrice: 1_250,
    volatility: 0.01,
    seed: 53,
  },
  {
    id: "KENTAI",
    name: "ケンタイチキン",
    industry: "外食",
    dividendAmount: 1_500,
    dividendRate: 0.0006,
    basePrice: 980,
    volatility: 0.007,
    seed: 67,
  },
  {
    id: "NIMURA",
    name: "二村保険",
    industry: "保険",
    dividendAmount: 400,
    dividendRate: 0.0015,
    basePrice: 3_400,
    volatility: 0.005,
    seed: 71,
  },
  {
    id: "NITIMOTO",
    name: "日元テレビ",
    industry: "放送・メディア",
    dividendAmount: 600,
    dividendRate: 0.0007,
    basePrice: 1_600,
    volatility: 0.008,
    seed: 83,
  },
  {
    id: "TENOMU",
    name: "テノム",
    industry: "電機・精密機器",
    dividendAmount: 200,
    dividendRate: 0.002,
    basePrice: 5_600,
    volatility: 0.009,
    seed: 97,
  },
  {
    id: "TAKASUMI",
    name: "鷹住テクノ",
    industry: "総合テクノロジー",
    dividendAmount: 100,
    dividendRate: 0.003,
    basePrice: 8_900,
    volatility: 0.011,
    seed: 103,
  },
];

const STOCK_BY_ID = new Map(STOCKS.map((s) => [s.id, s]));

export function stockById(id: unknown): StockDef | null {
  if (typeof id !== "string") return null;
  return STOCK_BY_ID.get(id) ?? null;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seriesCache = new Map<string, readonly number[]>();

export function stockPriceSeries(def: StockDef): readonly number[] {
  const cached = seriesCache.get(def.id);
  if (cached) return cached;
  const rand = mulberry32(def.seed * 1_000_003 + 17);
  const anchor = Math.log(def.basePrice);
  const reversion = 0.002;
  const out = new Array<number>(STOCK_SERIES_LENGTH);
  let logPrice = anchor;
  for (let i = 0; i < STOCK_SERIES_LENGTH; i++) {
    const shock = (rand() + rand() + rand() - 1.5) * 2 * def.volatility;
    logPrice += -reversion * (logPrice - anchor) + shock;
    const price = Math.round(Math.exp(logPrice));
    out[i] = Math.min(STOCK_PRICE_MAX, Math.max(STOCK_PRICE_MIN, price));
  }
  seriesCache.set(def.id, out);
  return out;
}

export function stockIndexAt(now: number): number {
  if (!Number.isFinite(now) || now <= STOCK_EPOCH_MS) return 0;
  return Math.floor((now - STOCK_EPOCH_MS) / STOCK_TICK_MS);
}

export function stockPositionAt(now: number): number {
  return stockIndexAt(now) % STOCK_SERIES_LENGTH;
}

export function stockPriceAtPosition(def: StockDef, position: number): number {
  const series = stockPriceSeries(def);
  const pos =
    ((Math.trunc(position) % STOCK_SERIES_LENGTH) + STOCK_SERIES_LENGTH) % STOCK_SERIES_LENGTH;
  return series[pos];
}

export function stockPrice(def: StockDef, now: number): number {
  return stockPriceAtPosition(def, stockPositionAt(now));
}

export function stockPrevPrice(def: StockDef, now: number): number {
  return stockPriceAtPosition(def, stockPositionAt(now) - 1);
}

export function stockPriceHistory(def: StockDef, now: number, count: number): number[] {
  const n = Math.max(1, Math.min(500, Math.trunc(count) || 1));
  const pos = stockPositionAt(now);
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(stockPriceAtPosition(def, pos - i));
  return out;
}

export function validateStockCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > STOCK_COUNT_MAX) return null;
  return value;
}

export interface StockBuyPlan {
  price: number;
  count: number;
  total: number;
}

export function planStockBuy(def: StockDef, count: unknown, now: number): StockBuyPlan | null {
  const n = validateStockCount(count);
  if (n === null) return null;
  const price = stockPrice(def, now);
  const total = price * n;
  if (total > STOCK_TRADE_TOTAL_MAX) return null;
  return { price, count: n, total };
}

export interface StockSellPlan {
  price: number;
  count: number;
  gross: number;
  tax: number;
  net: number;
}

export function planStockSell(
  def: StockDef,
  holdings: Readonly<Record<string, number>>,
  count: unknown,
  now: number,
): StockSellPlan | null {
  const n = validateStockCount(count);
  if (n === null) return null;
  const held = holdings[def.id] ?? 0;
  if (n > held) return null;
  const price = stockPrice(def, now);
  const gross = price * n;
  if (gross > STOCK_TRADE_TOTAL_MAX) return null;
  const tax = Math.floor(gross * STOCK_SELL_TAX_RATE);
  return { price, count: n, gross, tax, net: gross - tax };
}

export function stockDividendFor(def: StockDef, shares: number, price: number): number {
  if (!Number.isInteger(shares) || shares < def.dividendAmount) return 0;
  const counted = Math.min(shares, STOCK_DIVIDEND_SHARES_CAP);
  return Math.ceil(counted * price * def.dividendRate);
}

export interface StockDividendPlanEntry {
  stockId: string;
  shares: number;
  price: number;
  amount: number;
}

export function planStockDividends(
  holdings: Readonly<Record<string, number>>,
  now: number,
): { entries: StockDividendPlanEntry[]; total: number } {
  const entries: StockDividendPlanEntry[] = [];
  let total = 0;
  for (const def of STOCKS) {
    const shares = holdings[def.id] ?? 0;
    if (shares <= 0) continue;
    const price = stockPrice(def, now);
    const amount = stockDividendFor(def, shares, price);
    if (amount <= 0) continue;
    entries.push({ stockId: def.id, shares, price, amount });
    total += amount;
  }
  return { entries, total };
}

const JST_OFFSET_MS = 9 * 3_600_000;

export function stockDividendDateKey(now: number): string {
  const jst = new Date(now + JST_OFFSET_MS);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function stockDividendOpId(ownerKey: string, dateKey: string, chunk: number): string {
  const hash = createHash("sha256").update(ownerKey).digest("hex").slice(0, 12);
  const day = dateKey.replaceAll("-", "");
  return chunk > 0 ? `stockdiv-${day}-${hash}-${chunk}` : `stockdiv-${day}-${hash}`;
}

export interface StockDividendEntry {
  date: string;
  stockId: string;
  shares: number;
  price: number;
  amount: number;
}

export interface StockAccount {
  holdings: Record<string, number>;
  lastDividendDate: string | null;
  dividends: StockDividendEntry[];
}

export function emptyStockAccount(): StockAccount {
  return { holdings: {}, lastDividendDate: null, dividends: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseStockAccount(raw: unknown): StockAccount | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const account = emptyStockAccount();
  if (isRecord(value.holdings)) {
    for (const def of STOCKS) {
      const n = value.holdings[def.id];
      if (typeof n === "number" && Number.isInteger(n) && n > 0) {
        account.holdings[def.id] = n;
      }
    }
  }
  if (typeof value.lastDividendDate === "string" && DATE_KEY_RE.test(value.lastDividendDate)) {
    account.lastDividendDate = value.lastDividendDate;
  }
  if (Array.isArray(value.dividends)) {
    for (const entry of value.dividends) {
      if (account.dividends.length >= STOCK_DIVIDEND_LOG_LIMIT) break;
      if (!isRecord(entry)) continue;
      if (typeof entry.date !== "string" || !DATE_KEY_RE.test(entry.date)) continue;
      if (!stockById(entry.stockId)) continue;
      const { shares, price, amount } = entry;
      if (!Number.isInteger(shares) || (shares as number) <= 0) continue;
      if (!Number.isInteger(price) || (price as number) <= 0) continue;
      if (!Number.isInteger(amount) || (amount as number) <= 0) continue;
      account.dividends.push({
        date: entry.date,
        stockId: entry.stockId as string,
        shares: shares as number,
        price: price as number,
        amount: amount as number,
      });
    }
  }
  return account;
}

export function applyStockBuy(account: StockAccount, stockId: string, count: number): StockAccount {
  if (!stockById(stockId) || !Number.isInteger(count) || count <= 0) return account;
  return {
    ...account,
    holdings: { ...account.holdings, [stockId]: (account.holdings[stockId] ?? 0) + count },
  };
}

export function applyStockSell(
  account: StockAccount,
  stockId: string,
  count: number,
): StockAccount {
  if (!stockById(stockId) || !Number.isInteger(count) || count <= 0) return account;
  const held = account.holdings[stockId] ?? 0;
  if (count > held) return account;
  const holdings = { ...account.holdings };
  if (count === held) delete holdings[stockId];
  else holdings[stockId] = held - count;
  return { ...account, holdings };
}

export function stockHoldingsValue(
  holdings: Readonly<Record<string, number>>,
  now: number,
): number {
  let total = 0;
  for (const def of STOCKS) {
    const shares = holdings[def.id] ?? 0;
    if (shares > 0) total += shares * stockPrice(def, now);
  }
  return total;
}
