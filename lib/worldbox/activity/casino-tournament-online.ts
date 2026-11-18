import { kvGet, kvSet } from "../../bot-api";
import { buildEconomyOp, type EconomyOp } from "../economy/economy-bridge";
import {
  enqueueEconomyOpOnce,
  findEconomyOp,
  loadAllEconomyOps,
} from "../economy/economy-bridge-online";
import {
  casinoPrizeSplit,
  casinoTournamentFeeOpId,
  casinoTournamentPrizeOpId,
  casinoTournamentRefundOpId,
  closeCasinoEntry,
  closeCasinoPlay,
  recordScore,
  CASINO_TOURNAMENT_FEE,
  CASINO_TOURNAMENT_PRIZE_REASON,
  CASINO_TOURNAMENT_REFUND_REASON,
  parseCasinoTournament,
  type CasinoTournament,
} from "./casino-tournament";
import { withUserLock } from "../core/user-lock";

export const WORLDBOX_CASINO_TOURNAMENT_NAMESPACE = "worldbox_casino_tournament";

const CURRENT_KEY = "current";

export async function loadCasinoTournament(): Promise<CasinoTournament | null> {
  const raw = await kvGet(WORLDBOX_CASINO_TOURNAMENT_NAMESPACE, CURRENT_KEY);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return parseCasinoTournament(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveCasinoTournament(t: CasinoTournament): Promise<void> {
  await kvSet(WORLDBOX_CASINO_TOURNAMENT_NAMESPACE, CURRENT_KEY, JSON.stringify(t));
}

type FeeStatus = "done" | "failed" | "pending" | "unknown";

async function casinoFeeStatusOf(t: CasinoTournament, discordId: string): Promise<FeeStatus> {
  const op = await findEconomyOp(`discord:${discordId}`, casinoTournamentFeeOpId(t.id, discordId));
  if (!op) return "unknown";
  return op.status;
}

async function casinoFeeStatusesOf(t: CasinoTournament): Promise<Map<string, FeeStatus>> {
  const statuses = new Map<string, FeeStatus>();
  for (const discordId of t.entrants) {
    statuses.set(discordId, await casinoFeeStatusOf(t, discordId));
  }
  return statuses;
}

async function dropFailedCasinoFeeEntrantsInner(t: CasinoTournament): Promise<CasinoTournament> {
  const statuses = await casinoFeeStatusesOf(t);
  const kept = t.entrants.filter((id) => statuses.get(id) !== "failed");
  if (kept.length === t.entrants.length) return t;
  const scores = { ...t.scores };
  for (const id of t.entrants) {
    if (!kept.includes(id)) delete scores[id];
  }
  return { ...t, entrants: kept, scores };
}

const scoredKey = (tournamentId: string) => `scored-${tournamentId}`;

async function loadScoredOpIds(tournamentId: string): Promise<Set<string>> {
  try {
    const raw = await kvGet(WORLDBOX_CASINO_TOURNAMENT_NAMESPACE, scoredKey(tournamentId));
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

async function saveScoredOpIds(tournamentId: string, scored: ReadonlySet<string>): Promise<void> {
  await kvSet(
    WORLDBOX_CASINO_TOURNAMENT_NAMESPACE,
    scoredKey(tournamentId),
    JSON.stringify([...scored]),
  );
}

function scoreWindow(t: CasinoTournament): { from: number; to: number } {
  return { from: t.playStartedAt ?? t.entryEndsAt, to: t.playEndsAt };
}

async function applyDoneGambleOpsInner(
  t: CasinoTournament,
  ops: readonly EconomyOp[],
): Promise<CasinoTournament> {
  if (t.status !== "running") return t;
  const { from, to } = scoreWindow(t);
  const candidates = ops.filter(
    (op) =>
      op.kind === "gamble" &&
      op.status === "done" &&
      op.createdAt >= from &&
      op.createdAt <= to &&
      t.entrants.includes(op.discordId),
  );
  if (candidates.length === 0) return t;
  const scored = await loadScoredOpIds(t.id);
  let out = t;
  let changed = false;
  for (const op of candidates) {
    if (scored.has(op.id)) continue;
    scored.add(op.id);
    out = recordScore(out, op.discordId, op.amount, op.payout ?? 0);
    changed = true;
  }
  if (changed) await saveScoredOpIds(t.id, scored);
  return out;
}

export async function reconcileCasinoTournamentScores(
  userKey: string,
  discordId: string,
  ops: readonly EconomyOp[],
): Promise<void> {
  try {
    await withUserLock("casino-tournament", async () => {
      const t = await loadCasinoTournament();
      if (!t) return;
      const before = JSON.stringify(t);
      let out = await advanceCasinoTournamentInner(t, Date.now());
      const mine = ops.filter((op) => op.userKey === userKey && op.discordId === discordId);
      out = await applyDoneGambleOpsInner(out, mine);
      if (JSON.stringify(out) !== before) await saveCasinoTournament(out);
    });
  } catch {
    // スコア照合の失敗はカジノのプレイを壊さない
  }
}

async function sweepCasinoScoresInner(t: CasinoTournament): Promise<CasinoTournament> {
  if (t.status !== "running") return t;
  const ops = await loadAllEconomyOps();
  return applyDoneGambleOpsInner(t, ops);
}

export async function payCasinoPrizesInner(t: CasinoTournament): Promise<CasinoTournament> {
  if (t.status !== "done" || t.prizesPaid) return t;
  const statuses = await casinoFeeStatusesOf(t);
  for (const discordId of t.entrants) {
    const s = statuses.get(discordId);
    if (s === "pending" || s === "unknown") return t;
  }
  const paidEntrants = t.entrants.filter((id) => statuses.get(id) === "done");
  const split = casinoPrizeSplit({ ...t, entrants: paidEntrants });
  if (split.length === 0) return { ...t, prizesPaid: true };
  let allPaid = true;
  for (const row of split) {
    const op = buildEconomyOp(
      {
        kind: "earn",
        userKey: `discord:${row.discordId}`,
        discordId: row.discordId,
        amount: row.amount,
        reason: CASINO_TOURNAMENT_PRIZE_REASON,
      },
      casinoTournamentPrizeOpId(t.id, row.rank),
      Date.now(),
    );
    if (!op || !(await enqueueEconomyOpOnce(op))) allPaid = false;
  }
  return allPaid ? { ...t, prizesPaid: true } : t;
}

export async function payCasinoRefundsInner(t: CasinoTournament): Promise<CasinoTournament> {
  if (t.status !== "done" || t.prizesPaid || t.refundPaid) return t;
  if (t.entrants.length >= 2) return t;
  const statuses = await casinoFeeStatusesOf(t);
  let allSettled = true;
  for (const discordId of t.entrants) {
    const s = statuses.get(discordId);
    if (s === "failed") continue;
    if (s !== "done") {
      allSettled = false;
      continue;
    }
    const op = buildEconomyOp(
      {
        kind: "earn",
        userKey: `discord:${discordId}`,
        discordId,
        amount: CASINO_TOURNAMENT_FEE,
        reason: CASINO_TOURNAMENT_REFUND_REASON,
      },
      casinoTournamentRefundOpId(t.id, discordId),
      Date.now(),
    );
    if (!op || !(await enqueueEconomyOpOnce(op))) allSettled = false;
  }
  return allSettled ? { ...t, refundPaid: true } : t;
}

export async function advanceCasinoTournamentInner(
  t: CasinoTournament,
  now: number,
): Promise<CasinoTournament> {
  let out = closeCasinoEntry(t, now);
  if (t.status === "entry" && out.status === "running") {
    out = await dropFailedCasinoFeeEntrantsInner(out);
    if (out.entrants.length < 2) out = { ...out, status: "done", closedAt: now };
  }
  if (out.status === "running" && now >= out.playEndsAt) {
    out = await sweepCasinoScoresInner(out);
  }
  out = closeCasinoPlay(out, now);
  if (out.status === "done" && out.closedAt !== null) {
    out =
      out.entrants.length < 2 ? await payCasinoRefundsInner(out) : await payCasinoPrizesInner(out);
  }
  return out;
}

export async function loadCurrentCasinoTournament(now: number): Promise<CasinoTournament | null> {
  const t = await loadCasinoTournament();
  if (!t) return null;
  const before = JSON.stringify(t);
  const out = await advanceCasinoTournamentInner(t, now);
  if (JSON.stringify(out) !== before) await saveCasinoTournament(out);
  return out;
}
