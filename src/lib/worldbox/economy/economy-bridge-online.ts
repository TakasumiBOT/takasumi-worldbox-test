import {
  BotApiError,
  isBotApiConfigured,
  kvDelete,
  kvGet,
  kvList,
  kvSet,
  rpc,
  tableInsert,
  tableSelect,
  tableUpdate,
} from "../../bot-api";
import {
  EARN_REASONS,
  GAMBLE_REASONS,
  WORLDBOX_ECONOMY_NAMESPACE,
  parseEconomyOp,
  recentEconomyOps,
  type EconomyOp,
} from "./economy-bridge";

export function isEconomyEnabled(): boolean {
  return isBotApiConfigured();
}

export const GUEST_NOT_ALLOWED = "guest_not_allowed";

export function isGuestEconomyOp(op: EconomyOp): boolean {
  return op.userKey.startsWith("guest:");
}

async function queueEconomyOp(op: EconomyOp): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_ECONOMY_NAMESPACE, op.id, op);
    return true;
  } catch {
    return false;
  }
}

export async function enqueueEconomyOp(op: EconomyOp): Promise<boolean> {
  if (isGuestEconomyOp(op)) return false;
  const result = await submitEconomyOp(op);
  return result.state !== "unavailable";
}

export async function enqueueEconomyOpOnce(op: EconomyOp): Promise<boolean> {
  if (isGuestEconomyOp(op)) return false;
  const result = await submitEconomyOp(op);
  return result.state !== "unavailable";
}

export async function loadAllEconomyOps(): Promise<EconomyOp[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const all = await kvList(WORLDBOX_ECONOMY_NAMESPACE);
    const ops: EconomyOp[] = [];
    for (const raw of all.values()) {
      const op = parseEconomyOp(raw);
      if (op) ops.push(op);
    }
    return ops;
  } catch {
    return [];
  }
}

export async function loadMyEconomyOps(userKey: string): Promise<EconomyOp[]> {
  return recentEconomyOps(await loadAllEconomyOps(), userKey);
}

export async function findEconomyOp(userKey: string, opId: string): Promise<EconomyOp | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_ECONOMY_NAMESPACE, opId);
    if (raw === null) return null;
    const op = parseEconomyOp(raw);
    return op && op.userKey === userKey ? op : null;
  } catch {
    return null;
  }
}

export async function deleteEconomyOp(opId: string): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvDelete(WORLDBOX_ECONOMY_NAMESPACE, opId);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const OP_WAIT_TIMEOUT_MS = 3_000;
export const OP_WAIT_INTERVAL_MS = 200;

export type OpWaitOptions = { timeoutMs?: number; intervalMs?: number };

export async function waitForOpDone(
  userKey: string,
  opId: string,
  options: OpWaitOptions = {},
): Promise<EconomyOp | null> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? OP_WAIT_TIMEOUT_MS);
  const intervalMs = Math.max(10, options.intervalMs ?? OP_WAIT_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const op = await findEconomyOp(userKey, opId);
    if (op === null || op.status !== "pending") return op;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return op;
    await sleep(Math.min(intervalMs, remaining));
  }
}

export async function waitForOpsDone(
  targets: readonly { userKey: string; opId: string }[],
  options: OpWaitOptions = {},
): Promise<(EconomyOp | null)[]> {
  return Promise.all(targets.map((t) => waitForOpDone(t.userKey, t.opId, options)));
}

type UserBalanceRow = { balance?: unknown };

export async function readUserBalance(discordId: string): Promise<number | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const rows = await tableSelect<UserBalanceRow>(
      "users",
      "balance",
      [{ column: "user_id", op: "eq", value: discordId }],
      1,
    );
    if (rows.length === 0) return 0;
    const balance = Number(rows[0].balance ?? 0);
    return Number.isFinite(balance) ? Math.trunc(balance) : null;
  } catch {
    return null;
  }
}

export const WORLDBOX_ECONOMY_APPLIED_NAMESPACE = "worldbox_economy_applied";
export const WORLDBOX_ECONOMY_METRICS_NAMESPACE = "worldbox_metrics_econ";
export const WORLDBOX_HISTORY_ID = "WORLD_BOX";
export const NEW_USER_BALANCE = 10_000;
const BALANCE_UPDATE_ATTEMPTS = 5;

interface AppliedLedgerEntry {
  status: "applying" | "applied" | "failed";
  appliedAmount?: number;
  metricRecorded?: boolean;
  error?: string;
  at: number;
}

function parseAppliedLedger(raw: unknown): AppliedLedgerEntry | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.status !== "applying" && record.status !== "applied" && record.status !== "failed")
    return null;
  const entry: AppliedLedgerEntry = {
    status: record.status,
    at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0,
  };
  if (
    typeof record.appliedAmount === "number" &&
    Number.isInteger(record.appliedAmount) &&
    record.appliedAmount >= 0
  ) {
    entry.appliedAmount = record.appliedAmount;
  }
  if (typeof record.metricRecorded === "boolean") entry.metricRecorded = record.metricRecorded;
  if (typeof record.error === "string" && record.error.length > 0) entry.error = record.error;
  return entry;
}

export async function deleteEconomyOpLedger(opId: string): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvDelete(WORLDBOX_ECONOMY_APPLIED_NAMESPACE, opId);
    return true;
  } catch {
    return false;
  }
}

async function loadAppliedLedger(opId: string): Promise<AppliedLedgerEntry | null> {
  try {
    return parseAppliedLedger(await kvGet(WORLDBOX_ECONOMY_APPLIED_NAMESPACE, opId));
  } catch {
    return null;
  }
}

async function saveAppliedLedger(opId: string, entry: AppliedLedgerEntry): Promise<boolean> {
  try {
    await kvSet(WORLDBOX_ECONOMY_APPLIED_NAMESPACE, opId, entry);
    return true;
  } catch {
    return false;
  }
}

async function writeOpTerminal(
  op: EconomyOp,
  status: "done" | "failed",
  extra: { appliedAmount?: number; error?: string },
): Promise<EconomyOp> {
  const record: EconomyOp = { ...op, status, appliedAt: Date.now() };
  if (extra.appliedAmount !== undefined) record.appliedAmount = extra.appliedAmount;
  if (extra.error !== undefined) record.error = extra.error;
  try {
    await kvSet(WORLDBOX_ECONOMY_NAMESPACE, op.id, record);
  } catch {
    // 記録の書き直し失敗は適用結果を覆さない（台帳が正で、履歴表示は
    // 次回取得時に直る範囲に留める）。
  }
  return record;
}

type ChangeBalanceResult =
  | { ok: true; newBalance: number }
  | { ok: false; error: "insufficient_funds" | "balance_update_failed" };

async function changeBalanceDirect(
  discordId: string,
  delta: number,
  options: { requireFunds?: boolean; createWith?: number | null } = {},
): Promise<ChangeBalanceResult> {
  const requireFunds = options.requireFunds === true;
  const createWith = options.createWith ?? null;
  for (let attempt = 0; attempt < BALANCE_UPDATE_ATTEMPTS; attempt++) {
    const rows = await tableSelect<UserBalanceRow>(
      "users",
      "balance",
      [{ column: "user_id", op: "eq", value: discordId }],
      1,
    );
    if (rows.length === 0) {
      if (requireFunds) return { ok: false, error: "insufficient_funds" };
      if (createWith === null) return { ok: false, error: "balance_update_failed" };
      const newBalance = createWith + delta;
      try {
        await tableInsert("users", { user_id: discordId, balance: newBalance, debt: 0 });
        return { ok: true, newBalance };
      } catch {
        continue;
      }
    }
    const oldBalance = Number(rows[0].balance ?? 0);
    if (!Number.isFinite(oldBalance)) return { ok: false, error: "balance_update_failed" };
    const newBalance = Math.trunc(oldBalance) + delta;
    if (requireFunds && newBalance < 0) return { ok: false, error: "insufficient_funds" };
    let updated: unknown[];
    try {
      updated = await tableUpdate("users", { balance: newBalance }, [
        { column: "user_id", op: "eq", value: discordId },
        { column: "balance", op: "eq", value: Math.trunc(oldBalance) },
      ]);
    } catch (error) {
      const now = await readUserBalance(discordId);
      if (now === newBalance) return { ok: true, newBalance };
      throw error;
    }
    if (updated.length > 0) return { ok: true, newBalance };
  }
  return { ok: false, error: "balance_update_failed" };
}

async function recordHistoryDirect(
  senderId: string,
  receiverId: string,
  amount: number,
  reason: string,
): Promise<void> {
  try {
    await tableInsert("transaction_history", {
      sender_id: senderId,
      receiver_id: receiverId,
      amount,
      reason,
    });
  } catch {
    // ワーカー側も履歴記録の失敗では適用を止めない
  }
}

interface MetricRecord {
  earn: Record<string, number>;
  spend: Record<string, number>;
  bankroll: number | null;
}

function applyMetricRecord(
  record: unknown,
  op: EconomyOp,
  applied: number,
  bankroll: number | null = null,
): MetricRecord {
  const out: MetricRecord = { earn: {}, spend: {}, bankroll: null };
  if (typeof record === "object" && record !== null && !Array.isArray(record)) {
    const source = record as Record<string, unknown>;
    if (typeof source.bankroll === "number" && Number.isFinite(source.bankroll))
      out.bankroll = Math.trunc(source.bankroll);
    for (const key of ["earn", "spend"] as const) {
      const part = source[key];
      if (typeof part === "object" && part !== null && !Array.isArray(part)) {
        for (const [name, value] of Object.entries(part as Record<string, unknown>)) {
          if (typeof value === "number" && Number.isFinite(value))
            out[key][name] = Math.trunc(value);
        }
      }
    }
  }
  if (op.kind === "earn") {
    out.earn[op.reason] = (out.earn[op.reason] ?? 0) + applied;
  } else if (op.kind === "spend") {
    out.spend[op.reason] = (out.spend[op.reason] ?? 0) + applied;
  } else if (op.kind === "gamble") {
    out.spend["casino_bet"] = (out.spend["casino_bet"] ?? 0) + op.amount;
    out.earn["casino_payout"] = (out.earn["casino_payout"] ?? 0) + applied;
  }
  if (bankroll !== null) out.bankroll = bankroll;
  return out;
}

async function recordMetricDirect(op: EconomyOp, applied: number): Promise<boolean> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const current = await kvGet(WORLDBOX_ECONOMY_METRICS_NAMESPACE, date);
    const bankroll = await readBankrollDirect();
    await kvSet(
      WORLDBOX_ECONOMY_METRICS_NAMESPACE,
      date,
      applyMetricRecord(current, op, applied, bankroll),
    );
    return true;
  } catch {
    return false;
  }
}

class DirectFailure extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

interface PayHouseBreakdown {
  paid: number;
  pool: number;
  treasury: number;
}

let poolProbeCache: { at: number; available: boolean } | null = null;
const POOL_PROBE_TTL_MS = 60_000;

export function resetEconomyPoolProbe(): void {
  poolProbeCache = null;
}

async function isPoolDbAvailable(): Promise<boolean> {
  if (poolProbeCache && Date.now() - poolProbeCache.at < POOL_PROBE_TTL_MS) {
    return poolProbeCache.available;
  }
  let available = false;
  try {
    await tableSelect("economy_pool_state", "pool", [{ column: "id", op: "eq", value: 1 }], 1);
    available = true;
  } catch {
    available = false;
  }
  poolProbeCache = { at: Date.now(), available };
  return available;
}

async function readBankrollDirect(): Promise<number | null> {
  try {
    const rows = await tableSelect<{ pool?: unknown; treasury?: unknown }>(
      "economy_pool_state",
      "pool,treasury",
      [{ column: "id", op: "eq", value: 1 }],
      1,
    );
    if (rows.length === 0) return 0;
    const pool = Number(rows[0].pool ?? 0);
    const treasury = Number(rows[0].treasury ?? 0);
    if (!Number.isFinite(pool) || !Number.isFinite(treasury)) return null;
    return Math.trunc(pool) + Math.trunc(treasury);
  } catch {
    return null;
  }
}

function toBreakdown(raw: unknown): PayHouseBreakdown | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const paid = Number(record.paid);
  const pool = Number(record.pool_part);
  const treasury = Number(record.treasury_part);
  if (!Number.isFinite(paid) || !Number.isFinite(pool) || !Number.isFinite(treasury)) return null;
  return { paid: Math.trunc(paid), pool: Math.trunc(pool), treasury: Math.trunc(treasury) };
}

async function payHouseDirect(amount: number): Promise<PayHouseBreakdown> {
  const breakdown = toBreakdown(await rpc("economy_pool_pay_house", { p_amount: amount }));
  if (!breakdown) throw new Error("economy_pool_pay_house returned an invalid result");
  return breakdown;
}

async function refundHouseDirect(breakdown: PayHouseBreakdown): Promise<void> {
  try {
    await rpc("economy_pool_refund_house", {
      p_pool_part: breakdown.pool,
      p_treasury_part: breakdown.treasury,
    });
  } catch {
    // ワーカー側も refund_house の失敗は記録のみで適用結果を覆さない
  }
}

async function addLossDirect(amount: number): Promise<void> {
  if (amount <= 0) return;
  try {
    await rpc("economy_pool_add_loss", { p_amount: amount });
  } catch {
    // ワーカー側も add_loss の失敗は適用を止めない
  }
}

async function applyEarnDirect(op: EconomyOp): Promise<number> {
  const breakdown = await payHouseDirect(op.amount);
  const paid = breakdown.paid;
  if (paid <= 0) return 0;
  let credited: ChangeBalanceResult;
  try {
    credited = await changeBalanceDirect(op.discordId, paid, { createWith: NEW_USER_BALANCE });
  } catch (error) {
    await refundHouseDirect(breakdown);
    throw error;
  }
  if (!credited.ok) {
    await refundHouseDirect(breakdown);
    throw new DirectFailure("credit_failed");
  }
  await recordHistoryDirect(WORLDBOX_HISTORY_ID, op.discordId, paid, op.reason);
  return paid;
}

async function applyGambleDirect(op: EconomyOp): Promise<number> {
  if (op.payout === undefined) throw new DirectFailure("invalid_op");
  const user = op.discordId;
  const bet = op.amount;
  const payout = op.payout;
  const prepaid = op.prepaid === true;

  const profit = Math.max(0, payout - bet);
  let breakdown: PayHouseBreakdown | null = null;
  let housePaid = 0;
  if (profit > 0) {
    breakdown = await payHouseDirect(profit);
    housePaid = breakdown.paid;
  }

  if (!prepaid) {
    const debit = await changeBalanceDirect(user, -bet, { requireFunds: true });
    if (!debit.ok) {
      if (breakdown) await refundHouseDirect(breakdown);
      throw new DirectFailure(debit.error);
    }
    await recordHistoryDirect(user, WORLDBOX_HISTORY_ID, bet, op.reason);
  }

  if (payout <= 0) {
    await addLossDirect(bet);
    return 0;
  }
  if (prepaid && payout < bet) {
    await addLossDirect(bet - payout);
  }

  const creditAmount = Math.min(payout, bet) + housePaid;
  let credited: ChangeBalanceResult | null = null;
  try {
    credited = await changeBalanceDirect(user, creditAmount, { createWith: NEW_USER_BALANCE });
  } catch {
    credited = null;
  }
  if (!credited || !credited.ok) {
    if (breakdown) await refundHouseDirect(breakdown);
    if (!prepaid) {
      try {
        await changeBalanceDirect(user, bet);
      } catch {
        // 返金の成否は終端コードを変えない
      }
    }
    throw new DirectFailure("credit_failed");
  }
  await recordHistoryDirect(WORLDBOX_HISTORY_ID, user, creditAmount, op.reason);
  return creditAmount;
}

async function applySpendDirect(op: EconomyOp): Promise<number> {
  const result = await changeBalanceDirect(op.discordId, -op.amount, { requireFunds: true });
  if (!result.ok) throw new DirectFailure(result.error);
  await recordHistoryDirect(op.discordId, WORLDBOX_HISTORY_ID, op.amount, op.reason);
  return op.amount;
}

async function applyTransferDirect(op: EconomyOp): Promise<number> {
  if (!op.toDiscordId) throw new DirectFailure("invalid_op");
  try {
    await rpc<number>("transfer_coins", {
      p_sender_id: op.discordId,
      p_receiver_id: op.toDiscordId,
      p_amount: op.amount,
      p_new_user_balance: NEW_USER_BALANCE,
    });
  } catch (error) {
    if (error instanceof BotApiError && error.status === 400) {
      throw new DirectFailure("insufficient_funds");
    }
    throw error;
  }
  await recordHistoryDirect(op.discordId, op.toDiscordId, op.amount, op.reason);
  return op.amount;
}

async function isDirectKind(op: EconomyOp): Promise<boolean> {
  if (op.kind === "spend" || op.kind === "transfer") return true;
  if (op.kind === "earn" || op.kind === "gamble") return isPoolDbAvailable();
  return false;
}

async function applyDirectByKind(op: EconomyOp): Promise<number> {
  if (op.kind === "spend") return applySpendDirect(op);
  if (op.kind === "transfer") return applyTransferDirect(op);
  if (op.kind === "earn") return applyEarnDirect(op);
  if (op.kind === "gamble") return applyGambleDirect(op);
  throw new DirectFailure("invalid_op");
}

export type SubmitEconomyOpResult =
  | { state: "done" | "failed" | "pending"; op: EconomyOp }
  | { state: "unavailable" };

export async function submitEconomyOp(op: EconomyOp): Promise<SubmitEconomyOpResult> {
  if (isGuestEconomyOp(op)) {
    return {
      state: "failed",
      op: { ...op, status: "failed", error: GUEST_NOT_ALLOWED, appliedAt: Date.now() },
    };
  }
  if (!isBotApiConfigured()) return { state: "unavailable" };

  let existingRaw: unknown = null;
  try {
    existingRaw = await kvGet(WORLDBOX_ECONOMY_NAMESPACE, op.id);
  } catch {
    existingRaw = null;
  }
  const existing = parseEconomyOp(existingRaw);
  if (existing) {
    if (existing.status === "done") return { state: "done", op: existing };
    if (existing.status === "failed") return { state: "failed", op: existing };
    return { state: "pending", op: existing };
  }

  const ledger = await loadAppliedLedger(op.id);
  if (ledger?.status === "applied") {
    const record = await writeOpTerminal(op, "done", { appliedAmount: ledger.appliedAmount ?? 0 });
    return { state: "done", op: record };
  }
  if (ledger?.status === "failed") {
    const record = await writeOpTerminal(op, "failed", { error: ledger.error ?? "apply_failed" });
    return { state: "failed", op: record };
  }
  if (ledger?.status === "applying") {
    if (await queueEconomyOp(op)) return { state: "pending", op };
    return { state: "unavailable" };
  }

  if (!(await isDirectKind(op))) {
    if (await queueEconomyOp(op)) return { state: "pending", op };
    return { state: "unavailable" };
  }

  const token = crypto.randomUUID();
  const claimed: EconomyOp & { claim: { token: string; at: number } } = {
    ...op,
    claim: { token, at: Date.now() },
  };
  try {
    await kvSet(WORLDBOX_ECONOMY_NAMESPACE, op.id, claimed);
    const current = await kvGet(WORLDBOX_ECONOMY_NAMESPACE, op.id);
    const currentClaim =
      typeof current === "object" && current !== null
        ? (current as { claim?: { token?: unknown } }).claim
        : undefined;
    if (!currentClaim || currentClaim.token !== token) {
      const currentOp = parseEconomyOp(current);
      if (currentOp) return { state: "pending", op: currentOp };
      return { state: "unavailable" };
    }
  } catch {
    if (await queueEconomyOp(op)) return { state: "pending", op };
    return { state: "unavailable" };
  }

  if (!(await saveAppliedLedger(op.id, { status: "applying", at: Date.now() }))) {
    if (await queueEconomyOp(op)) return { state: "pending", op };
    return { state: "unavailable" };
  }

  let applied: number;
  try {
    applied = await applyDirectByKind(op);
  } catch (error) {
    if (error instanceof DirectFailure) {
      await saveAppliedLedger(op.id, { status: "failed", error: error.code, at: Date.now() });
      const record = await writeOpTerminal(op, "failed", { error: error.code });
      return { state: "failed", op: record };
    }
    const record = await writeOpTerminal(op, "failed", { error: "apply_failed" });
    return { state: "failed", op: record };
  }

  const metricRecorded = await recordMetricDirect(op, applied);
  await saveAppliedLedger(op.id, {
    status: "applied",
    appliedAmount: applied,
    metricRecorded,
    at: Date.now(),
  });
  const record = await writeOpTerminal(op, "done", { appliedAmount: applied });
  return { state: "done", op: record };
}

export const ECONOMY_CLAIM_STALE_MS = 90_000;
export const ECONOMY_SWEEP_BATCH = 100;
export const ECONOMY_PRUNE_KEEP_TERMINAL = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

interface SweepCandidate {
  key: string;
  raw: unknown;
  sortKey: number;
}

function selectSweepCandidates(records: Map<string, unknown>, now: number): SweepCandidate[] {
  const out: SweepCandidate[] = [];
  for (const [key, raw] of records) {
    const value = asRecord(raw);
    if (!value) {
      out.push({ key, raw, sortKey: 0 });
      continue;
    }
    if (value.status !== "pending") continue;
    const claim = asRecord(value.claim);
    if (
      claim &&
      typeof claim.at === "number" &&
      Number.isFinite(claim.at) &&
      now - claim.at < ECONOMY_CLAIM_STALE_MS
    ) {
      continue;
    }
    const created =
      typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
        ? Math.trunc(value.createdAt)
        : 0;
    out.push({ key, raw, sortKey: created });
  }
  out.sort((a, b) => a.sortKey - b.sortKey || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out.slice(0, ECONOMY_SWEEP_BATCH);
}

async function writeSweepInvalidResult(key: string, raw: unknown): Promise<void> {
  const base = asRecord(raw) ?? {};
  const record: Record<string, unknown> = {
    ...base,
    status: "failed",
    error: "invalid_op",
    appliedAt: Date.now(),
  };
  delete record.claim;
  try {
    await kvSet(WORLDBOX_ECONOMY_NAMESPACE, key, record);
  } catch {
    // ベストエフォート（次回のスイープで再び候補になる）
  }
}

async function applySweepByKind(op: EconomyOp): Promise<number> {
  if (op.kind === "steal") throw new DirectFailure("steal_disabled");
  if (op.kind === "earn" && !EARN_REASONS.has(op.reason)) throw new DirectFailure("invalid_reason");
  if (op.kind === "gamble" && !GAMBLE_REASONS.has(op.reason))
    throw new DirectFailure("invalid_reason");
  return applyDirectByKind(op);
}

async function sweepOneOp(key: string, raw: unknown): Promise<boolean> {
  const op = parseEconomyOp(raw);
  if (!op) {
    await writeSweepInvalidResult(key, raw);
    return true;
  }
  const rawRecord = asRecord(raw) ?? {};
  const token = crypto.randomUUID();
  const claimed = { ...rawRecord, ...op, status: "pending", claim: { token, at: Date.now() } };
  try {
    await kvSet(WORLDBOX_ECONOMY_NAMESPACE, key, claimed);
    const current = await kvGet(WORLDBOX_ECONOMY_NAMESPACE, key);
    const currentRecord = asRecord(current);
    const currentOp = parseEconomyOp(current);
    const claim = currentRecord ? asRecord(currentRecord.claim) : null;
    if (!currentOp || currentOp.status !== "pending" || !claim || claim.token !== token) {
      return false;
    }
  } catch {
    return false;
  }

  let ledgerRaw: unknown;
  try {
    ledgerRaw = await kvGet(WORLDBOX_ECONOMY_APPLIED_NAMESPACE, op.id);
  } catch {
    return false;
  }
  let ledger: AppliedLedgerEntry | null = null;
  if (ledgerRaw !== null && ledgerRaw !== undefined) {
    ledger = parseAppliedLedger(ledgerRaw) ?? { status: "applying", at: 0 };
  }
  if (ledger?.status === "applied") {
    const applied = ledger.appliedAmount ?? 0;
    await writeOpTerminal(op, "done", { appliedAmount: applied });
    if (!ledger.metricRecorded) {
      const metricRecorded = await recordMetricDirect(op, applied);
      if (metricRecorded) {
        await saveAppliedLedger(op.id, {
          status: "applied",
          appliedAmount: applied,
          metricRecorded: true,
          at: Date.now(),
        });
      }
    }
    return true;
  }
  if (ledger?.status === "failed") {
    await writeOpTerminal(op, "failed", { error: ledger.error ?? "apply_failed" });
    return true;
  }
  if (ledger?.status === "applying") {
    await writeOpTerminal(op, "failed", { error: "apply_uncertain" });
    return true;
  }

  if (!(await saveAppliedLedger(op.id, { status: "applying", at: Date.now() }))) {
    return false;
  }
  let applied: number;
  try {
    applied = await applySweepByKind(op);
  } catch (error) {
    if (error instanceof DirectFailure) {
      await saveAppliedLedger(op.id, { status: "failed", error: error.code, at: Date.now() });
      await writeOpTerminal(op, "failed", { error: error.code });
      return true;
    }
    await writeOpTerminal(op, "failed", { error: "apply_failed" });
    return true;
  }
  const metricRecorded = await recordMetricDirect(op, applied);
  await saveAppliedLedger(op.id, {
    status: "applied",
    appliedAmount: applied,
    metricRecorded,
    at: Date.now(),
  });
  await writeOpTerminal(op, "done", { appliedAmount: applied });
  return true;
}

async function pruneSweepTerminal(records: Map<string, unknown>): Promise<number> {
  const terminal: { at: number; key: string }[] = [];
  for (const [key, raw] of records) {
    const value = asRecord(raw);
    if (!value || (value.status !== "done" && value.status !== "failed")) continue;
    const at =
      typeof value.appliedAt === "number" && Number.isFinite(value.appliedAt)
        ? Math.trunc(value.appliedAt)
        : 0;
    terminal.push({ at, key });
  }
  terminal.sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  let pruned = 0;
  for (const entry of terminal.slice(ECONOMY_PRUNE_KEEP_TERMINAL)) {
    try {
      await kvDelete(WORLDBOX_ECONOMY_NAMESPACE, entry.key);
      pruned += 1;
    } catch {
      // ベストエフォート
    }
  }
  for (const entry of terminal) {
    try {
      await kvDelete(WORLDBOX_ECONOMY_APPLIED_NAMESPACE, entry.key);
    } catch {
      // ベストエフォート
    }
  }
  return pruned;
}

export interface EconomySweepResult {
  handled: number;
  pruned: number;
  candidates: number;
}

export async function sweepEconomyOps(): Promise<EconomySweepResult> {
  const zero: EconomySweepResult = { handled: 0, pruned: 0, candidates: 0 };
  if (!isBotApiConfigured()) return zero;
  let records: Map<string, unknown>;
  try {
    records = await kvList(WORLDBOX_ECONOMY_NAMESPACE);
  } catch {
    return zero;
  }
  const candidates = selectSweepCandidates(records, Date.now());
  let handled = 0;
  for (const candidate of candidates) {
    try {
      if (await sweepOneOp(candidate.key, candidate.raw)) handled += 1;
    } catch {
      // 1件の予期しない例外でスイープ全体は止めない（ワーカーと同じ）
    }
  }
  const pruned = await pruneSweepTerminal(records);
  return { handled, pruned, candidates: candidates.length };
}
