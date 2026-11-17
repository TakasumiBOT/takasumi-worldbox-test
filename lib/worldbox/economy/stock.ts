import { createHash } from "node:crypto";

// WORLD BOX（Takasumi 版）の株式（純粋ロジック）。
// 数字とルールの正は TakasumiBOT v3 の株式仕様（V3-COMPANY-SPEC.md §5）:
// 架空企業10社の株を売買する、プレイヤー会社とは無関係の投資システム。
// プレイヤーが設立した会社は上場しない（会社パネルとは混ぜない）。
//
// 株価: v3 は「事前生成された価格配列（約5,700〜6,200点）を Cron が
// 1時間ごとに index +1 して辿る」方式。本実装は配列をファイルに持たず、
// 銘柄ごとの固定シードから決定的に生成する（同じ位置はいつでも同じ価格
// になる）。現在位置は「エポックからの経過時間（時）」で引くため、
// index を進める Cron は要らない（状態を持たない等価な実装）。
// 系列の長さは 8,760 点（= 1年分）。v3 は末尾到達時の処理が不明だった
// ため、ここでは末尾まで来たら先頭に戻す（系列をループする）と決める。
//
// 売買: 購入は 個数 × 現在株価 を個人が支払い対価は国庫へ、売却は
// 個数 × 現在株価 から売却税10%を差し引いて個人へ（税は国庫に残る）。
// 金の移動そのものは経済ブリッジのオプ経由だけ（stock-online.ts）。
// 配当: 毎日 JST 0:00、保有数が銘柄の dividendAmount 以上の場合に
// 配当額 = ceil(min(保有数, 10,000) × 現在株価 × dividendRate)。

/** 価格系列の起点（この時刻の index が 0）。 */
export const STOCK_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
/** 価格系列の長さ（点数 = 時間数。8,760 = 365日分）。末尾で先頭へ戻る。 */
export const STOCK_SERIES_LENGTH = 8_760;
/** 株価の変動間隔（v3: 1時間ごとに1つ進む）。 */
export const STOCK_TICK_MS = 3_600_000;
/** 株価の下限・上限（生成時のクランプ）。 */
export const STOCK_PRICE_MIN = 10;
export const STOCK_PRICE_MAX = 999_999;
/** 1回の取引の株数上限（v3 の config stockBuyLimit: 100000。v3 本体では未使用だったが、ここでは実際に効かせる）。 */
export const STOCK_COUNT_MAX = 100_000;
/**
 * 1回の取引の総額上限。個人残高との出入りは経済ブリッジのオプ
 * （1件 1,000,000 まで）で運ぶため、その上限に合わせる
 * （economy-bridge.ts の ECONOMY_AMOUNT_MAX と同値。単体テストで
 * このモジュールを切り出せるよう、値はここに持つ）。
 */
export const STOCK_TRADE_TOTAL_MAX = 1_000_000;
/** 株式売却税率（v3: tradeTaxRate 10%）。 */
export const STOCK_SELL_TAX_RATE = 0.1;
/** 配当の計算対象になる株数の上限（v3: stockDividendAmountLimit）。 */
export const STOCK_DIVIDEND_SHARES_CAP = 10_000;
/** 配当履歴の保持件数（ユーザーごと、直近分）。 */
export const STOCK_DIVIDEND_LOG_LIMIT = 30;

export interface StockDef {
  /** 銘柄 ID（ティッカー）。 */
  id: string;
  /** 社名。 */
  name: string;
  /** 業種。 */
  industry: string;
  /** 配当を受けられる最低保有数（v3: dividendAmount、100〜5,000）。 */
  dividendAmount: number;
  /** 配当率（v3: dividendRate、0.0001〜0.003）。 */
  dividendRate: number;
  /** 価格系列のアンカー（基準価格）。 */
  basePrice: number;
  /** 1ティックの対数リターンの散らばり。 */
  volatility: number;
  /** 価格系列生成のシード（銘柄ごとに固定）。 */
  seed: number;
}

/**
 * 架空企業10社（v3 の静的定義 companies.json の銘柄が正）。
 * 配当パラメータは仕様の範囲（dividendAmount 100〜5,000、
 * dividendRate 0.0001〜0.003）の中で銘柄ごとに割り当てた。
 * プレイヤー会社とは無関係であり、一覧でも混同しないこと。
 */
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

/** 銘柄 ID から定義を引く。無ければ null。 */
export function stockById(id: unknown): StockDef | null {
  if (typeof id !== "string") return null;
  return STOCK_BY_ID.get(id) ?? null;
}

// ---- 価格系列（決定的生成） ----

/** mulberry32: 固定シードの決定的 PRNG（0..1）。 */
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

/**
 * 銘柄の価格系列（長さ STOCK_SERIES_LENGTH）を決定的に生成する。
 * 対数価格の平均回帰ランダムウォーク: 基準価格から離れるほど
 * 戻る力が働くため、系列のどこを辿っても価格帯が崩れない。
 * 生成結果はモジュール内でキャッシュする（再生成しても同じ値）。
 */
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

/** 時刻 → 系列の絶対インデックス（エポック前は 0）。 */
export function stockIndexAt(now: number): number {
  if (!Number.isFinite(now) || now <= STOCK_EPOCH_MS) return 0;
  return Math.floor((now - STOCK_EPOCH_MS) / STOCK_TICK_MS);
}

/** 絶対インデックス → 系列内の位置（末尾を超えたら先頭へ戻る）。 */
export function stockPositionAt(now: number): number {
  return stockIndexAt(now) % STOCK_SERIES_LENGTH;
}

/** 位置を指定した株価。位置は系列長で折り返す。 */
export function stockPriceAtPosition(def: StockDef, position: number): number {
  const series = stockPriceSeries(def);
  const pos =
    ((Math.trunc(position) % STOCK_SERIES_LENGTH) + STOCK_SERIES_LENGTH) % STOCK_SERIES_LENGTH;
  return series[pos];
}

/** 現在株価。 */
export function stockPrice(def: StockDef, now: number): number {
  return stockPriceAtPosition(def, stockPositionAt(now));
}

/** 1ティック前（前時間）の株価。前時間比の表示用。 */
export function stockPrevPrice(def: StockDef, now: number): number {
  return stockPriceAtPosition(def, stockPositionAt(now) - 1);
}

/** 直近 count 点の価格推移（古い順）。グラフ表示用。 */
export function stockPriceHistory(def: StockDef, now: number, count: number): number[] {
  const n = Math.max(1, Math.min(500, Math.trunc(count) || 1));
  const pos = stockPositionAt(now);
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(stockPriceAtPosition(def, pos - i));
  return out;
}

// ---- 売買の計算 ----

/** 取引株数: 整数 1..STOCK_COUNT_MAX のときだけ通す。 */
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

/** 購入の計算。総額がオプ上限を超える場合は null（分割購入してもらう）。 */
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
  /** 売却総額（税引前）。 */
  gross: number;
  /** 売却税（10%、切り捨て）。国庫に残る分。 */
  tax: number;
  /** 個人が受け取る額（gross - tax）。経済ブリッジの earn オプで運ぶ。 */
  net: number;
}

/** 売却の計算。保有数を超える場合は null。 */
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

// ---- 配当 ----

/**
 * 1銘柄の配当額（v3 の式）: 保有数が dividendAmount 未満なら 0。
 * 計算対象の株数は STOCK_DIVIDEND_SHARES_CAP で頭打ち。
 */
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

/** 保有全体の配当計画（配当が出る銘柄だけ）。 */
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

// ---- JST の日付キー（配当 Cron の冪等化） ----

const JST_OFFSET_MS = 9 * 3_600_000;

/** 配当の冪等キー（JST の日付 "YYYY-MM-DD"）。毎日 0:00 JST に切り替わる。 */
export function stockDividendDateKey(now: number): string {
  const jst = new Date(now + JST_OFFSET_MS);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 配当オプの決定的 ID（ユーザー×日付×分割番号）。
 * Cron が途中で落ちて再実行されても、同じ ID のオプは経済ブリッジ側で
 * 既存記録を見て二重適用にならない（冪等化の第二の担保）。
 */
export function stockDividendOpId(ownerKey: string, dateKey: string, chunk: number): string {
  const hash = createHash("sha256").update(ownerKey).digest("hex").slice(0, 12);
  const day = dateKey.replaceAll("-", "");
  return chunk > 0 ? `stockdiv-${day}-${hash}-${chunk}` : `stockdiv-${day}-${hash}`;
}

// ---- 保有アカウント（保存値の形とパース） ----

export interface StockDividendEntry {
  /** 配当の日付キー（JST、"YYYY-MM-DD"）。 */
  date: string;
  stockId: string;
  shares: number;
  price: number;
  amount: number;
}

/** ユーザーごとの株式アカウント（bot_kv に保存する形）。 */
export interface StockAccount {
  /** 銘柄 ID → 保有数（0 の銘柄は持たない）。 */
  holdings: Record<string, number>;
  /** 最後に配当を処理した日付キー（冪等化用）。 */
  lastDividendDate: string | null;
  /** 配当履歴（新しい順、最大 STOCK_DIVIDEND_LOG_LIMIT 件）。 */
  dividends: StockDividendEntry[];
}

export function emptyStockAccount(): StockAccount {
  return { holdings: {}, lastDividendDate: null, dividends: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 保存済みの値（オブジェクト、または JSON 文字列）を株式アカウント
 * として解釈する。形が壊れていれば null。未知の銘柄・不正な株数は
 * 落とし、正の整数の保有だけを残す。
 */
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

/** 購入後の保有（純粋関数）。 */
export function applyStockBuy(account: StockAccount, stockId: string, count: number): StockAccount {
  if (!stockById(stockId) || !Number.isInteger(count) || count <= 0) return account;
  return {
    ...account,
    holdings: { ...account.holdings, [stockId]: (account.holdings[stockId] ?? 0) + count },
  };
}

/** 売却後の保有（純粋関数）。0 になった銘柄はキーごと消える（v3 と同じ）。 */
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

/** 保有の評価額合計（現在株価）。 */
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
