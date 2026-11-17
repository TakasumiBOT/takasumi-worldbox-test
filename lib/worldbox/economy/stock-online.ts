// WORLD BOX（Takasumi 版）株式の保存と送金（サーバー専用）。
// 保存先は bot_kv（名前空間 "worldbox_stock"):
//   キー = 所有者キー（"discord:<id>"） → StockAccount（保有・配当履歴）
// 株価そのものは保存しない（stock.ts の決定的系列から時刻で引く）。
// 個人残高との金の出入りは経済ブリッジのオプ経由だけ:
//   購入: spend オプ（対価は国庫へ、理由 "stock_buy"）
//   売却: earn オプ（売却税10%控除後の額、理由 "stock_sell"）
//   配当: earn オプ（理由 "stock_dividend"、日次 Cron）
// お金が動いたことを確認してから台帳（保有）を書き換える
// （購入は課金が done になってから株を増やし、売却は払い出しが
// done になってから株を減らす。会社システムの設立と同じ原則）。
// ゲストは submitEconomyOp の入口で guest_not_allowed として終端
// するため、株式経由でもゲストへ金が渡ることはない（ルート側でも
// ゲストの取引を 403 で弾く）。
import { isBotApiConfigured, kvGet, kvList, kvSet } from "../../bot-api";
import { buildEconomyOp, ECONOMY_AMOUNT_MAX, type EconomyOp } from "./economy-bridge";
import {
  submitEconomyOp,
  waitForOpDone,
  type SubmitEconomyOpResult,
} from "./economy-bridge-online";
import {
  applyStockBuy,
  applyStockSell,
  emptyStockAccount,
  parseStockAccount,
  planStockBuy,
  planStockDividends,
  planStockSell,
  stockById,
  stockDividendDateKey,
  stockDividendOpId,
  STOCK_DIVIDEND_LOG_LIMIT,
  type StockAccount,
} from "./stock";

export const WORLDBOX_STOCK_NAMESPACE = "worldbox_stock";

async function kvGetString(namespace: string, key: string): Promise<string | null> {
  const raw = await kvGet(namespace, key);
  if (raw === null || raw === undefined) return null;
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

export function isStockEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadStockAccount(ownerKey: string): Promise<StockAccount> {
  if (!isBotApiConfigured()) return emptyStockAccount();
  try {
    return (
      parseStockAccount(await kvGetString(WORLDBOX_STOCK_NAMESPACE, ownerKey)) ??
      emptyStockAccount()
    );
  } catch {
    return emptyStockAccount();
  }
}

export async function storeStockAccount(ownerKey: string, account: StockAccount): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_STOCK_NAMESPACE, ownerKey, JSON.stringify(account));
    return true;
  } catch {
    return false;
  }
}

export type StockMoneyState = "done" | "failed" | "pending" | "unavailable";
export interface StockMoneyResult {
  state: StockMoneyState;
  op?: EconomyOp;
}

/** 個人 → 国庫の支払い（購入の対価）。会社システムの chargeUser と同じ手順。 */
async function chargeUser(
  ownerKey: string,
  discordId: string,
  amount: number,
  reason: string,
): Promise<StockMoneyResult> {
  const op = buildEconomyOp(
    { kind: "spend", userKey: ownerKey, discordId, amount, reason },
    crypto.randomUUID(),
    Date.now(),
  );
  if (!op) return { state: "failed" };
  const submitted: SubmitEconomyOpResult = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return { state: "unavailable" };
  if (submitted.state !== "pending") return { state: submitted.state, op: submitted.op };
  const waited = await waitForOpDone(ownerKey, op.id);
  if (!waited) return { state: "pending", op: submitted.op };
  return { state: waited.status === "done" ? "done" : waited.status, op: waited };
}

/** 国庫 → 個人の払い出し（売却代金・配当）。 */
async function payOutToUser(
  ownerKey: string,
  discordId: string,
  amount: number,
  reason: string,
  opId: string = crypto.randomUUID(),
): Promise<StockMoneyResult> {
  const op = buildEconomyOp(
    { kind: "earn", userKey: ownerKey, discordId, amount, reason },
    opId,
    Date.now(),
  );
  if (!op) return { state: "failed" };
  const submitted: SubmitEconomyOpResult = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return { state: "unavailable" };
  if (submitted.state !== "pending") return { state: submitted.state, op: submitted.op };
  const waited = await waitForOpDone(ownerKey, opId);
  if (!waited) return { state: "pending", op: submitted.op };
  return { state: waited.status === "done" ? "done" : waited.status, op: waited };
}

export interface StockBuyResult {
  state: StockMoneyState | "invalid";
  account?: StockAccount;
  price?: number;
  total?: number;
  error?: string;
}

/** 株の購入: 課金（spend）が確定してから保有を増やす。 */
export async function buyShares(
  ownerKey: string,
  discordId: string,
  stockId: string,
  count: unknown,
  now: number,
): Promise<StockBuyResult> {
  const def = stockById(stockId);
  if (!def) return { state: "invalid" };
  const plan = planStockBuy(def, count, now);
  if (!plan) return { state: "invalid" };
  if (!isBotApiConfigured()) return { state: "unavailable" };
  const charged = await chargeUser(ownerKey, discordId, plan.total, "stock_buy");
  if (charged.state !== "done") {
    return { state: charged.state, error: charged.op?.error, price: plan.price, total: plan.total };
  }
  const account = applyStockBuy(await loadStockAccount(ownerKey), def.id, plan.count);
  if (!(await storeStockAccount(ownerKey, account))) return { state: "unavailable" };
  return { state: "done", account, price: plan.price, total: plan.total };
}

export interface StockSellResult {
  state: StockMoneyState | "invalid";
  account?: StockAccount;
  price?: number;
  gross?: number;
  tax?: number;
  net?: number;
  error?: string;
}

/** 株の売却: 払い出し（earn、税引後）が確定してから保有を減らす。 */
export async function sellShares(
  ownerKey: string,
  discordId: string,
  stockId: string,
  count: unknown,
  now: number,
): Promise<StockSellResult> {
  const def = stockById(stockId);
  if (!def) return { state: "invalid" };
  if (!isBotApiConfigured()) return { state: "unavailable" };
  const before = await loadStockAccount(ownerKey);
  const plan = planStockSell(def, before.holdings, count, now);
  if (!plan) return { state: "invalid" };
  const paid = await payOutToUser(ownerKey, discordId, plan.net, "stock_sell");
  if (paid.state !== "done") {
    return {
      state: paid.state,
      error: paid.op?.error,
      price: plan.price,
      gross: plan.gross,
      tax: plan.tax,
      net: plan.net,
    };
  }
  const account = applyStockSell(before, def.id, plan.count);
  if (!(await storeStockAccount(ownerKey, account))) return { state: "unavailable" };
  return {
    state: "done",
    account,
    price: plan.price,
    gross: plan.gross,
    tax: plan.tax,
    net: plan.net,
  };
}

// ---- 配当 Cron（日次） ----

export interface StockDividendCronResult {
  accounts: number;
  paidUsers: number;
  totalPaid: number;
  skipped: number;
}

/**
 * 配当の日次処理（JST 0:00 の Cron から呼ぶ）。
 * 冪等化はアカウントごとの lastDividendDate（日付キー）が担保する:
 * 同じ日付で処理済みのアカウントは触らない。払い出しオプも決定的 ID
 * なので、途中で落ちて翌回に再実行されても二重払いにならない。
 * 配当総額がオプ上限を超える場合は分割して運ぶ（全分割が受け付け
 * られたときだけ処理済みとして記録する）。
 */
export async function runStockDividendCron(now: number): Promise<StockDividendCronResult> {
  const result: StockDividendCronResult = { accounts: 0, paidUsers: 0, totalPaid: 0, skipped: 0 };
  if (!isBotApiConfigured()) return result;
  const dateKey = stockDividendDateKey(now);
  let all: Map<string, unknown>;
  try {
    all = await kvList(WORLDBOX_STOCK_NAMESPACE);
  } catch {
    return result;
  }
  for (const [ownerKey, raw] of all) {
    const account = parseStockAccount(raw);
    if (!account) continue;
    if (Object.keys(account.holdings).length === 0) continue;
    result.accounts += 1;
    if (account.lastDividendDate === dateKey) continue;
    const discordId = ownerKey.startsWith("discord:") ? ownerKey.slice("discord:".length) : null;
    if (!discordId) {
      result.skipped += 1;
      continue;
    }
    const plan = planStockDividends(account.holdings, now);
    let accepted = true;
    if (plan.total > 0) {
      const chunks: number[] = [];
      for (let rest = plan.total; rest > 0; rest -= ECONOMY_AMOUNT_MAX) {
        chunks.push(Math.min(rest, ECONOMY_AMOUNT_MAX));
      }
      for (let i = 0; i < chunks.length; i++) {
        const paid = await payOutToUser(
          ownerKey,
          discordId,
          chunks[i],
          "stock_dividend",
          stockDividendOpId(ownerKey, dateKey, i),
        );
        if (paid.state !== "done" && paid.state !== "pending") {
          accepted = false;
          break;
        }
      }
    }
    if (!accepted) {
      result.skipped += 1;
      continue;
    }
    const dividends = [
      ...plan.entries.map((e) => ({
        date: dateKey,
        stockId: e.stockId,
        shares: e.shares,
        price: e.price,
        amount: e.amount,
      })),
      ...account.dividends,
    ].slice(0, STOCK_DIVIDEND_LOG_LIMIT);
    const next: StockAccount = { ...account, lastDividendDate: dateKey, dividends };
    if (await storeStockAccount(ownerKey, next)) {
      if (plan.total > 0) {
        result.paidUsers += 1;
        result.totalPaid += plan.total;
      }
    } else {
      result.skipped += 1;
    }
  }
  return result;
}
