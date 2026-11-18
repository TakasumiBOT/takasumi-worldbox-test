import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import {
  canDouble,
  createBlackjackGame,
  doubleDown,
  handValue,
  hit,
  stand,
  startRound,
} from "@/lib/games/blackjack";
import {
  CASINO_REASON,
  CASINO_SESSION_REASONS,
  casinoMachineNear,
  isCasinoSpendReason,
  type CasinoMachine,
  playRoulette,
  playSlot,
  validateCasinoBet,
  type CasinoGame,
  type RoulettePick,
} from "@/lib/worldbox/activity/casino";
import {
  doubleCashout,
  doubleGo,
  rollDice,
  spinSlot7,
  validateDice,
} from "@/lib/worldbox/activity/casino-games";
import {
  CASINO_SESSION_TTL_MS,
  publicSessionView,
  publicUserStateView,
  type CasinoSession,
} from "@/lib/worldbox/activity/casino-session";
import {
  clearCasinoSession,
  loadCasinoSession,
  loadCasinoUserState,
  saveCasinoSession,
  saveCasinoUserState,
} from "@/lib/worldbox/activity/casino-session-online";
import { reconcileCasinoTournamentScores } from "@/lib/worldbox/activity/casino-tournament-online";
import {
  buildEconomyOp,
  ECONOMY_AMOUNT_MAX,
  GAMBLE_PAYOUT_MAX,
  type EconomyOp,
} from "@/lib/worldbox/economy/economy-bridge";
import {
  enqueueEconomyOp,
  findEconomyOp,
  isEconomyEnabled,
  loadMyEconomyOps,
  readUserBalance,
  submitEconomyOp,
  waitForOpDone,
  waitForOpsDone,
} from "@/lib/worldbox/economy/economy-bridge-online";
import { buildLobby } from "@/lib/worldbox/world/lobby";
import { isPresenceEnabled, loadMyPresence } from "@/lib/worldbox/player/presence-online";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

const userLocks = new Map<string, Promise<void>>();

async function withUserLock<T>(userKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(userKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => gate);
  userLocks.set(userKey, tail);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (userLocks.get(userKey) === tail) userLocks.delete(userKey);
  }
}

type AuthedSession = NonNullable<ReturnType<typeof casinoSession>["session"]>;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function casinoSession(request: Request) {
  const session = getRequestSession(request);
  if (!session) return { session: null, status: 401 as const };
  if (session.provider !== "discord") return { session: null, status: 403 as const };
  return { session, status: 200 as const };
}

function rng(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

async function currentMachine(ownerKey: string) {
  if (!isPresenceEnabled()) return null;
  const presence = await loadMyPresence(ownerKey);
  if (!presence || presence.space !== "lobby") return null;
  return casinoMachineNear(buildLobby().objects, Math.floor(presence.x), Math.floor(presence.y));
}

function pendingCasinoTotal(ops: readonly EconomyOp[]): number {
  return ops
    .filter(
      (op) =>
        op.status === "pending" &&
        (op.kind === "gamble" || (op.kind === "spend" && isCasinoSpendReason(op.reason))),
    )
    .reduce((sum, op) => sum + op.amount, 0);
}

type OpStatus = "pending" | "done" | "failed" | "missing";

async function spendStatus(userKey: string, opId: string): Promise<OpStatus> {
  const op = await findEconomyOp(userKey, opId);
  if (!op) return "missing";
  return op.status;
}

const GET_WAIT_MS = 1_000;

async function spendStatuses(
  userKey: string,
  ids: readonly string[],
  waitMs?: number,
): Promise<OpStatus[]> {
  let statuses: OpStatus[] = [];
  for (const id of ids) statuses.push(await spendStatus(userKey, id));
  if (statuses.some((s) => s === "pending")) {
    await waitForOpsDone(
      ids.map((opId) => ({ userKey, opId })),
      { timeoutMs: waitMs },
    );
    statuses = [];
    for (const id of ids) statuses.push(await spendStatus(userKey, id));
  }
  return statuses;
}

async function spendStatusWaited(userKey: string, opId: string): Promise<OpStatus> {
  const first = await spendStatus(userKey, opId);
  if (first !== "pending") return first;
  const op = await waitForOpDone(userKey, opId);
  return op ? op.status : "missing";
}

async function prepayGateError(userKey: string, opId: string) {
  const status = await spendStatusWaited(userKey, opId);
  if (status === "pending") return errorResponse("bet_pending", 409);
  if (status !== "done") {
    await clearCasinoSession(userKey);
    return errorResponse("bet_failed", 409);
  }
  return null;
}

async function enqueue(
  userKey: string,
  discordId: string,
  input: {
    kind: "spend" | "gamble";
    amount: number;
    reason: string;
    payout?: number;
    prepaid?: boolean;
    id?: string;
  },
): Promise<EconomyOp | null> {
  const op = buildEconomyOp(
    {
      kind: input.kind,
      userKey,
      discordId,
      amount: input.amount,
      reason: input.reason,
      payout: input.payout,
      prepaid: input.prepaid,
    },
    input.id ?? crypto.randomUUID(),
    Date.now(),
  );
  if (!op) return null;
  const stored = await enqueueEconomyOp(op);
  return stored ? op : null;
}

async function submitSpend(
  userKey: string,
  discordId: string,
  input: {
    amount: number;
    reason: string;
  },
): Promise<{ op: EconomyOp; state: "done" | "failed" | "pending" } | null> {
  const op = buildEconomyOp(
    { kind: "spend", userKey, discordId, amount: input.amount, reason: input.reason },
    crypto.randomUUID(),
    Date.now(),
  );
  if (!op) return null;
  const submitted = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return null;
  return { op: submitted.op, state: submitted.state };
}

async function enqueueSettleOnce(
  ctx: Ctx,
  id: string,
  input: {
    kind: "spend" | "gamble";
    amount: number;
    reason: string;
    payout?: number;
    prepaid?: boolean;
  },
): Promise<boolean> {
  const existing = await findEconomyOp(ctx.userKey, id);
  if (existing) return true;
  const op = await enqueue(ctx.userKey, ctx.discordId, { ...input, id });
  return op !== null;
}

type Ctx = { userKey: string; discordId: string };

async function settleSlot7(
  ctx: Ctx,
  session: Extract<CasinoSession, { kind: "slot7" }>,
): Promise<boolean> {
  const prepayTotal = session.bet * session.total;
  const netReturn =
    session.pendingReward - session.pendingPenalty + session.remaining * session.bet;
  const settle = await enqueueSettleOnce(ctx, `settle-${session.prepayOpId}`, {
    kind: "gamble",
    amount: prepayTotal,
    reason: CASINO_SESSION_REASONS.slot7Settle,
    payout: Math.min(Math.max(0, netReturn), GAMBLE_PAYOUT_MAX),
    prepaid: true,
  });
  if (!settle) return false;
  if (netReturn < 0) {
    await enqueueSettleOnce(ctx, `penalty-${session.prepayOpId}`, {
      kind: "spend",
      amount: Math.min(-netReturn, ECONOMY_AMOUNT_MAX),
      reason: CASINO_SESSION_REASONS.slot7Penalty,
    });
  }
  await clearCasinoSession(ctx.userKey);
  return true;
}

async function settleDouble(
  ctx: Ctx,
  session: Extract<CasinoSession, { kind: "double" }>,
  payout: number,
): Promise<boolean> {
  const ok = await enqueueSettleOnce(ctx, `settle-${session.prepayOpId}`, {
    kind: "gamble",
    amount: session.bet,
    reason: CASINO_SESSION_REASONS.doubleSettle,
    payout: Math.min(payout, GAMBLE_PAYOUT_MAX),
    prepaid: true,
  });
  if (!ok) return false;
  await clearCasinoSession(ctx.userKey);
  return true;
}

async function settleBlackjack(
  ctx: Ctx,
  session: Extract<CasinoSession, { kind: "blackjack" }>,
): Promise<boolean> {
  const bj = session.bj;
  if (bj.phase !== "settled" || !bj.result) return false;
  const payout = bj.bet + bj.result.delta;
  const ok = await enqueueSettleOnce(ctx, `settle-${session.spendOpIds[0]}`, {
    kind: "gamble",
    amount: bj.bet,
    reason: CASINO_SESSION_REASONS.blackjackSettle,
    payout,
    prepaid: true,
  });
  if (!ok) return false;
  await clearCasinoSession(ctx.userKey);
  return true;
}

async function tryFinishSession(
  ctx: Ctx,
  session: CasinoSession,
  waitMs?: number,
): Promise<CasinoSession | null> {
  const spendIds = session.kind === "blackjack" ? session.spendOpIds : [session.prepayOpId];
  const statuses = await spendStatuses(ctx.userKey, spendIds, waitMs);
  if (statuses.some((s) => s === "failed" || s === "missing")) {
    await clearCasinoSession(ctx.userKey);
    return null;
  }
  if (statuses.some((s) => s === "pending")) return session;
  if (session.kind === "slot7") {
    if (session.remaining > 0) return session;
    return (await settleSlot7(ctx, session)) ? null : session;
  }
  if (session.kind === "double") {
    if (!session.busted) return session;
    return (await settleDouble(ctx, session, 0)) ? null : session;
  }
  return (await settleBlackjack(ctx, session)) ? null : session;
}

async function expireSessionIfNeeded(
  ctx: Ctx,
  session: CasinoSession | null,
  waitMs?: number,
): Promise<CasinoSession | null> {
  if (!session) return null;
  if (Date.now() - session.createdAt <= CASINO_SESSION_TTL_MS) {
    return tryFinishSession(ctx, session, waitMs);
  }
  const spendIds = session.kind === "blackjack" ? session.spendOpIds : [session.prepayOpId];
  const statuses = await spendStatuses(ctx.userKey, spendIds, waitMs);
  if (statuses.some((s) => s === "pending")) return session;
  if (statuses.some((s) => s === "failed" || s === "missing")) {
    await clearCasinoSession(ctx.userKey);
    return null;
  }
  if (session.kind === "slot7") {
    return (await settleSlot7(ctx, session)) ? null : session;
  }
  if (session.kind === "double") {
    return (await settleDouble(ctx, session, session.busted ? 0 : session.bet)) ? null : session;
  }
  if (session.bj.phase === "settled") {
    return (await settleBlackjack(ctx, session)) ? null : session;
  }
  const paid = session.bet * session.spendOpIds.length;
  const ok = await enqueueSettleOnce(ctx, `refund-${session.spendOpIds[0]}`, {
    kind: "gamble",
    amount: paid,
    reason: CASINO_SESSION_REASONS.blackjackSettle,
    payout: paid,
    prepaid: true,
  });
  if (ok) await clearCasinoSession(ctx.userKey);
  return ok ? null : session;
}

async function loadSessionFor(ctx: Ctx, waitMs?: number): Promise<CasinoSession | null> {
  const session = await loadCasinoSession(ctx.userKey);
  return expireSessionIfNeeded(ctx, session, waitMs);
}

function sessionJson(session: CasinoSession | null) {
  return session ? publicSessionView(session) : null;
}

export async function GET(request: Request) {
  const { session, status } = casinoSession(request);
  if (!session) return errorResponse(status === 401 ? "unauthorized" : "discord_required", status);
  return withUserLock(sessionOwnerKey(session), () => handleGet(session));
}

async function handleGet(session: AuthedSession) {
  if (!isEconomyEnabled()) return errorResponse("economy_unavailable", 503);
  const ctx: Ctx = { userKey: sessionOwnerKey(session), discordId: session.id };
  const [balance, ops, machine, activeSession, userState] = await Promise.all([
    readUserBalance(session.id),
    loadMyEconomyOps(ctx.userKey),
    currentMachine(ctx.userKey),
    loadSessionFor(ctx, GET_WAIT_MS),
    loadCasinoUserState(ctx.userKey),
  ]);
  await reconcileCasinoTournamentScores(ctx.userKey, ctx.discordId, ops);
  if (balance === null) return errorResponse("economy_unavailable", 503);
  const gambleOps = ops.filter((op) => op.kind === "gamble");
  return NextResponse.json(
    {
      balance,
      effectiveBalance: balance - pendingCasinoTotal(ops),
      machine,
      ops: gambleOps,
      session: sessionJson(activeSession),
      userState: publicUserStateView(userState),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("forbidden", 403);
  const { session, status } = casinoSession(request);
  if (!session) return errorResponse(status === 401 ? "unauthorized" : "discord_required", status);
  return withUserLock(sessionOwnerKey(session), () => handlePost(request, session));
}

async function handlePost(request: Request, session: AuthedSession) {
  if (!isEconomyEnabled()) return errorResponse("economy_unavailable", 503);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  const fields = (body ?? {}) as Record<string, unknown>;
  const action = typeof fields.action === "string" ? fields.action : "play";
  const ctx: Ctx = { userKey: sessionOwnerKey(session), discordId: session.id };

  const machine = await currentMachine(ctx.userKey);
  if (machine === null) return errorResponse("not_at_casino", 409);

  const [balance, ops] = await Promise.all([
    readUserBalance(session.id),
    loadMyEconomyOps(ctx.userKey),
  ]);
  if (balance === null) return errorResponse("economy_unavailable", 503);
  await reconcileCasinoTournamentScores(ctx.userKey, ctx.discordId, ops);
  const effectiveBalance = balance - pendingCasinoTotal(ops);
  const activeSession = await loadSessionFor(ctx);

  const requireMachine = (want: CasinoMachine) =>
    machine === want ? null : errorResponse("wrong_machine", 409);
  const requireNoSession = () => (activeSession ? errorResponse("session_active", 409) : null);
  const requireSession = <K extends CasinoSession["kind"]>(
    kind: K,
  ): { session: Extract<CasinoSession, { kind: K }> | null; error: NextResponse | null } => {
    if (!activeSession) return { session: null, error: errorResponse("no_session", 409) };
    if (activeSession.kind !== kind)
      return { session: null, error: errorResponse("wrong_session", 409) };
    return { session: activeSession as Extract<CasinoSession, { kind: K }>, error: null };
  };

  if (action === "play") {
    const game: CasinoGame | null =
      fields.game === "slot" || fields.game === "roulette" || fields.game === "dice"
        ? fields.game
        : null;
    if (game === null) return errorResponse("invalid_game", 400);
    const bet = validateCasinoBet(fields.bet);
    if (bet === null) return errorResponse("invalid_bet", 400);
    const machineError = requireMachine(game);
    if (machineError) return machineError;
    if (bet > effectiveBalance) return errorResponse("not_enough_coins", 409);

    if (game === "dice") {
      const maxValue = typeof fields.maxValue === "number" ? fields.maxValue : NaN;
      const number = typeof fields.number === "number" ? fields.number : NaN;
      const invalid = validateDice(maxValue, number);
      if (invalid) return errorResponse(invalid, 400);
      if (bet * maxValue > GAMBLE_PAYOUT_MAX) return errorResponse("invalid_bet", 400);
      const rolled = rollDice(maxValue, rng);
      const hitDice = rolled === number;
      const payout = hitDice ? bet * maxValue : 0;
      const op = await enqueue(ctx.userKey, ctx.discordId, {
        kind: "gamble",
        amount: bet,
        reason: CASINO_REASON.dice,
        payout,
      });
      if (!op) return errorResponse("economy_failed", 503);
      return NextResponse.json(
        {
          ok: true,
          game,
          bet,
          payout,
          result: { rolled, hit: hitDice, maxValue, number },
          opId: op.id,
        },
        { headers: NO_STORE },
      );
    }

    const pick: RoulettePick | null =
      fields.pick === "red" || fields.pick === "black" ? fields.pick : null;
    if (game === "roulette" && pick === null) return errorResponse("invalid_pick", 400);
    const result =
      game === "slot" ? playSlot(bet, rng) : playRoulette(bet, pick as RoulettePick, rng);
    const op = await enqueue(ctx.userKey, ctx.discordId, {
      kind: "gamble",
      amount: bet,
      reason: CASINO_REASON[game],
      payout: result.payout,
    });
    if (!op) return errorResponse("economy_failed", 503);
    return NextResponse.json(
      { ok: true, game, bet, payout: result.payout, result, opId: op.id },
      { headers: NO_STORE },
    );
  }

  if (action === "slot7_start") {
    const machineError = requireMachine("slot7");
    if (machineError) return machineError;
    const noSession = requireNoSession();
    if (noSession) return noSession;
    const bet = validateCasinoBet(fields.bet);
    if (bet === null) return errorResponse("invalid_bet", 400);
    const total = bet;
    if (total > ECONOMY_AMOUNT_MAX) return errorResponse("invalid_bet", 400);
    if (total > effectiveBalance) return errorResponse("not_enough_coins", 409);
    const prepay = await submitSpend(ctx.userKey, ctx.discordId, {
      amount: total,
      reason: CASINO_SESSION_REASONS.slot7Prepay,
    });
    if (!prepay) return errorResponse("economy_failed", 503);
    if (prepay.state === "failed") return errorResponse("bet_failed", 409);
    const next: CasinoSession = {
      kind: "slot7",
      bet,
      total: 1,
      remaining: 1,
      prepayOpId: prepay.op.id,
      pendingReward: 0,
      pendingPenalty: 0,
      lastReels: null,
      lastEvents: [],
      createdAt: Date.now(),
    };
    await saveCasinoSession(ctx.userKey, next);
    return NextResponse.json({ ok: true, session: sessionJson(next) }, { headers: NO_STORE });
  }

  if (action === "slot7_spin") {
    const machineError = requireMachine("slot7");
    if (machineError) return machineError;
    const { session: s7, error } = requireSession("slot7");
    if (error || !s7) return error ?? errorResponse("no_session", 409);
    if (s7.remaining <= 0) return errorResponse("no_spins_left", 409);
    const prepayError = await prepayGateError(ctx.userKey, s7.prepayOpId);
    if (prepayError) return prepayError;
    const userState = await loadCasinoUserState(ctx.userKey);
    const spin = spinSlot7(userState, s7.bet, rng);
    await saveCasinoUserState(ctx.userKey, userState);
    const next: CasinoSession = {
      ...s7,
      remaining: s7.remaining - 1,
      pendingReward: s7.pendingReward + spin.reward,
      pendingPenalty: s7.pendingPenalty + spin.penalty,
      lastReels: spin.reels,
      lastEvents: spin.events,
    };
    let settled = false;
    if (next.remaining <= 0) {
      const after = await tryFinishSession(ctx, next);
      settled = after === null;
      if (!settled) await saveCasinoSession(ctx.userKey, next);
      return NextResponse.json(
        { ok: true, spin, session: sessionJson(settled ? null : next), settled },
        { headers: NO_STORE },
      );
    }
    await saveCasinoSession(ctx.userKey, next);
    return NextResponse.json({ ok: true, spin, session: sessionJson(next) }, { headers: NO_STORE });
  }

  if (action === "double_start") {
    const machineError = requireMachine("double");
    if (machineError) return machineError;
    const noSession = requireNoSession();
    if (noSession) return noSession;
    const bet = validateCasinoBet(fields.bet);
    if (bet === null) return errorResponse("invalid_bet", 400);
    if (bet > effectiveBalance) return errorResponse("not_enough_coins", 409);
    const prepay = await submitSpend(ctx.userKey, ctx.discordId, {
      amount: bet,
      reason: CASINO_SESSION_REASONS.doubleBet,
    });
    if (!prepay) return errorResponse("economy_failed", 503);
    if (prepay.state === "failed") return errorResponse("bet_failed", 409);
    const next: CasinoSession = {
      kind: "double",
      bet,
      multiplier: 1,
      streak: 0,
      prepayOpId: prepay.op.id,
      createdAt: Date.now(),
    };
    await saveCasinoSession(ctx.userKey, next);
    return NextResponse.json({ ok: true, session: sessionJson(next) }, { headers: NO_STORE });
  }

  if (action === "double_go") {
    const machineError = requireMachine("double");
    if (machineError) return machineError;
    const { session: dbl, error } = requireSession("double");
    if (error || !dbl) return error ?? errorResponse("no_session", 409);
    if (dbl.busted) return errorResponse("session_finished", 409);
    const prepayError = await prepayGateError(ctx.userKey, dbl.prepayOpId);
    if (prepayError) return prepayError;
    const userState = await loadCasinoUserState(ctx.userKey);
    const sessionState = { bet: dbl.bet, multiplier: dbl.multiplier, streak: dbl.streak };
    const go = doubleGo(sessionState, userState, rng);
    await saveCasinoUserState(ctx.userKey, userState);
    const next: CasinoSession = {
      ...dbl,
      multiplier: sessionState.multiplier,
      streak: sessionState.streak,
      ...(go.finished ? { busted: true } : {}),
    };
    if (go.finished) {
      const after = await tryFinishSession(ctx, next);
      if (after !== null) await saveCasinoSession(ctx.userKey, next);
      return NextResponse.json(
        { ok: true, go, session: sessionJson(after) },
        { headers: NO_STORE },
      );
    }
    await saveCasinoSession(ctx.userKey, next);
    return NextResponse.json({ ok: true, go, session: sessionJson(next) }, { headers: NO_STORE });
  }

  if (action === "double_cashout") {
    const machineError = requireMachine("double");
    if (machineError) return machineError;
    const { session: dbl, error } = requireSession("double");
    if (error || !dbl) return error ?? errorResponse("no_session", 409);
    if (dbl.busted) return errorResponse("session_finished", 409);
    const prepayStatus = await spendStatusWaited(ctx.userKey, dbl.prepayOpId);
    if (prepayStatus === "pending") return errorResponse("bet_pending", 409);
    if (prepayStatus !== "done") {
      await clearCasinoSession(ctx.userKey);
      return errorResponse("bet_failed", 409);
    }
    const userState = await loadCasinoUserState(ctx.userKey);
    const payout = doubleCashout(
      { bet: dbl.bet, multiplier: dbl.multiplier, streak: dbl.streak },
      userState,
    );
    await saveCasinoUserState(ctx.userKey, userState);
    const settled = await settleDouble(ctx, dbl, payout);
    if (!settled) return errorResponse("economy_failed", 503);
    return NextResponse.json({ ok: true, payout, session: null }, { headers: NO_STORE });
  }

  if (action === "bj_start") {
    const machineError = requireMachine("blackjack");
    if (machineError) return machineError;
    const noSession = requireNoSession();
    if (noSession) return noSession;
    const bet = validateCasinoBet(fields.bet);
    if (bet === null) return errorResponse("invalid_bet", 400);
    if (bet > effectiveBalance) return errorResponse("not_enough_coins", 409);
    const prepay = await submitSpend(ctx.userKey, ctx.discordId, {
      amount: bet,
      reason: CASINO_SESSION_REASONS.blackjackBet,
    });
    if (!prepay) return errorResponse("economy_failed", 503);
    if (prepay.state === "failed") return errorResponse("bet_failed", 409);
    const seed = Math.floor(rng() * 0x7fffffff);
    const bj = startRound(createBlackjackGame(seed, effectiveBalance), bet);
    const next: CasinoSession = {
      kind: "blackjack",
      bet,
      spendOpIds: [prepay.op.id],
      bj,
      createdAt: Date.now(),
    };
    await saveCasinoSession(ctx.userKey, next);
    const finalView = bj.phase === "settled" ? publicSessionView(next) : null;
    const after = await tryFinishSession(ctx, next);
    if (after !== null && after !== next) await saveCasinoSession(ctx.userKey, after);
    return NextResponse.json(
      { ok: true, session: sessionJson(after), final: finalView },
      { headers: NO_STORE },
    );
  }

  if (action === "bj_hit" || action === "bj_stand") {
    const machineError = requireMachine("blackjack");
    if (machineError) return machineError;
    const { session: bjs, error } = requireSession("blackjack");
    if (error || !bjs) return error ?? errorResponse("no_session", 409);
    if (bjs.bj.phase !== "player") return errorResponse("not_in_play", 409);
    const bjStatuses = await spendStatuses(ctx.userKey, bjs.spendOpIds);
    if (bjStatuses.some((s) => s === "pending")) return errorResponse("bet_pending", 409);
    if (bjStatuses.some((s) => s !== "done")) {
      await clearCasinoSession(ctx.userKey);
      return errorResponse("bet_failed", 409);
    }
    const bj = action === "bj_hit" ? hit(bjs.bj) : stand(bjs.bj);
    const next: CasinoSession = { ...bjs, bj };
    const finalView = bj.phase === "settled" ? publicSessionView(next) : null;
    const after = await tryFinishSession(ctx, next);
    if (after !== null) await saveCasinoSession(ctx.userKey, after);
    return NextResponse.json(
      {
        ok: true,
        session: sessionJson(after),
        final: finalView,
        playerTotal: handValue(bj.playerHand).total,
      },
      { headers: NO_STORE },
    );
  }

  if (action === "bj_double") {
    const machineError = requireMachine("blackjack");
    if (machineError) return machineError;
    const { session: bjs, error } = requireSession("blackjack");
    if (error || !bjs) return error ?? errorResponse("no_session", 409);
    if (bjs.bj.phase !== "player" || !canDouble(bjs.bj)) return errorResponse("cannot_double", 409);
    const firstStatus = await spendStatusWaited(ctx.userKey, bjs.spendOpIds[0]);
    if (firstStatus === "pending") return errorResponse("bet_pending", 409);
    if (firstStatus !== "done") {
      await clearCasinoSession(ctx.userKey);
      return errorResponse("bet_failed", 409);
    }
    if (bjs.bet > effectiveBalance) return errorResponse("not_enough_coins", 409);
    if (bjs.bet * 2 > ECONOMY_AMOUNT_MAX) return errorResponse("bet_too_large_to_double", 409);
    const second = await submitSpend(ctx.userKey, ctx.discordId, {
      amount: bjs.bet,
      reason: CASINO_SESSION_REASONS.blackjackBet,
    });
    if (!second) return errorResponse("economy_failed", 503);
    if (second.state === "failed") return errorResponse("bet_failed", 409);
    const bj = doubleDown(bjs.bj);
    const next: CasinoSession = { ...bjs, bj, spendOpIds: [...bjs.spendOpIds, second.op.id] };
    await saveCasinoSession(ctx.userKey, next);
    return NextResponse.json(
      { ok: true, session: sessionJson(next), final: publicSessionView(next) },
      { headers: NO_STORE },
    );
  }

  return errorResponse("invalid_action", 400);
}
