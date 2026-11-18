import { isBotApiConfigured } from "../../bot-api";
import {
  buildEconomyOp,
  chunkEconomyAmounts,
  EARN_REASONS,
  type EconomyOp,
} from "./economy-bridge";
import {
  readUserBalance,
  submitEconomyOp,
  waitForOpDone,
  type SubmitEconomyOpResult,
} from "./economy-bridge-online";

export type SettlementState = "done" | "failed" | "pending" | "unavailable" | "insufficient_funds";

export interface SettlementResult {
  state: SettlementState;
  applied: number;
  error?: string;
}

const CHUNK_ID_SAFE_RE = /^[A-Za-z0-9-]{4,48}$/;

function chunkOpId(prefix: string | undefined, index: number): string {
  if (!prefix || !CHUNK_ID_SAFE_RE.test(prefix)) return crypto.randomUUID();
  return `${prefix}-c${index}`;
}

async function runSingleOp(op: EconomyOp): Promise<{
  state: "done" | "failed" | "pending" | "unavailable";
  op?: EconomyOp;
}> {
  const submitted: SubmitEconomyOpResult = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return { state: "unavailable" };
  if (submitted.state !== "pending") return { state: submitted.state, op: submitted.op };
  const waited = await waitForOpDone(op.userKey, op.id);
  if (!waited) return { state: "pending", op: submitted.op };
  return { state: waited.status === "done" ? "done" : waited.status, op: waited };
}

/**
 * 大口（1,000,000円超）を含むコイン引き落としを安全にチャンク実行する。
 * 途中チャンクで失敗した場合は引き落とし済み分を可能な範囲で返金する。
 */
export async function chargeUserChunked(
  ownerKey: string,
  discordId: string,
  totalAmount: number,
  reason: string,
  options: { opPrefix?: string; refundReason?: string } = {},
): Promise<SettlementResult> {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return { state: "failed", applied: 0, error: "invalid_amount" };
  }
  if (!isBotApiConfigured()) {
    return { state: "unavailable", applied: 0 };
  }
  const balance = await readUserBalance(discordId);
  if (balance === null) return { state: "unavailable", applied: 0 };
  if (balance < totalAmount) {
    return { state: "insufficient_funds", applied: 0, error: "insufficient_funds" };
  }

  const chunks = chunkEconomyAmounts(totalAmount);
  let charged = 0;
  for (let i = 0; i < chunks.length; i++) {
    const amount = chunks[i];
    const op = buildEconomyOp(
      { kind: "spend", userKey: ownerKey, discordId, amount, reason },
      chunkOpId(options.opPrefix, i),
      Date.now(),
    );
    if (!op) {
      return { state: "failed", applied: charged, error: "invalid_op" };
    }
    const res = await runSingleOp(op);
    if (res.state !== "done") {
      const rollbackReason =
        options.refundReason && EARN_REASONS.has(options.refundReason)
          ? options.refundReason
          : "market_refund";
      if (charged > 0) {
        await payoutUserChunked(ownerKey, discordId, charged, rollbackReason);
      }
      const errCode = res.op?.error;
      if (errCode === "insufficient_funds") {
        return { state: "insufficient_funds", applied: 0, error: errCode };
      }
      return {
        state: res.state === "unavailable" ? "unavailable" : "failed",
        applied: 0,
        error: errCode,
      };
    }
    charged += amount;
  }
  return { state: "done", applied: charged };
}

/**
 * 大口（1,000,000円超）を含むコイン支払いをチャンク実行する。
 */
export async function payoutUserChunked(
  ownerKey: string,
  discordId: string,
  totalAmount: number,
  reason: string,
  options: { opPrefix?: string } = {},
): Promise<SettlementResult> {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return { state: "failed", applied: 0, error: "invalid_amount" };
  }
  if (!EARN_REASONS.has(reason)) {
    return { state: "failed", applied: 0, error: "invalid_reason" };
  }
  if (!isBotApiConfigured()) {
    return { state: "unavailable", applied: 0 };
  }

  const chunks = chunkEconomyAmounts(totalAmount);
  let paid = 0;
  for (let i = 0; i < chunks.length; i++) {
    const amount = chunks[i];
    const op = buildEconomyOp(
      { kind: "earn", userKey: ownerKey, discordId, amount, reason },
      chunkOpId(options.opPrefix, i),
      Date.now(),
    );
    if (!op) {
      return { state: "failed", applied: paid, error: "invalid_op" };
    }
    const res = await runSingleOp(op);
    if (res.state !== "done" && res.state !== "pending") {
      return {
        state: res.state === "unavailable" ? "unavailable" : "failed",
        applied: paid,
        error: res.op?.error,
      };
    }
    paid += amount;
  }
  return { state: "done", applied: paid };
}
