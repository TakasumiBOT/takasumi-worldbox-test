import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { buildEconomyOp, type EconomyOp } from "@/lib/worldbox/economy/economy-bridge";
import {
  enqueueEconomyOpOnce,
  isEconomyEnabled,
  loadMyEconomyOps,
  readUserBalance,
} from "@/lib/worldbox/economy/economy-bridge-online";
import { casinoMachineNear } from "@/lib/worldbox/activity/casino";
import {
  CASINO_TOURNAMENT_ENTRY_MS,
  CASINO_TOURNAMENT_FEE,
  CASINO_TOURNAMENT_MAX_ENTRANTS,
  CASINO_TOURNAMENT_PLAY_MS,
  casinoTournamentFeeOpId,
  casinoTournamentId,
  publicCasinoTournamentView,
  type CasinoTournament,
} from "@/lib/worldbox/activity/casino-tournament";
import {
  advanceCasinoTournamentInner,
  loadCurrentCasinoTournament,
  saveCasinoTournament,
} from "@/lib/worldbox/activity/casino-tournament-online";
import { buildLobby } from "@/lib/worldbox/world/lobby";
import { isPresenceEnabled, loadMyPresence } from "@/lib/worldbox/player/presence-online";
import { withUserLock } from "@/lib/worldbox/core/user-lock";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function casinoTournamentSession(request: Request) {
  const session = getRequestSession(request);
  if (!session) return { session: null, status: 401 as const };
  if (session.provider !== "discord") return { session: null, status: 403 as const };
  return { session, status: 200 as const };
}

async function currentMachine(ownerKey: string) {
  if (!isPresenceEnabled()) return null;
  const presence = await loadMyPresence(ownerKey);
  if (!presence || presence.space !== "lobby") return null;
  return casinoMachineNear(buildLobby().objects, Math.floor(presence.x), Math.floor(presence.y));
}

async function effectiveBalanceOf(ownerKey: string, discordId: string): Promise<number | null> {
  const balance = await readUserBalance(discordId);
  if (balance === null) return null;
  const ops = await loadMyEconomyOps(ownerKey);
  const pending = ops
    .filter((op) => op.status === "pending" && op.kind === "spend")
    .reduce((sum, op) => sum + op.amount, 0);
  return balance - pending;
}

async function stateResponse(ownerKey: string, discordId: string, t: CasinoTournament | null) {
  const [balance, ops] = await Promise.all([
    readUserBalance(discordId),
    loadMyEconomyOps(ownerKey),
  ]);
  const pending = ops
    .filter((op) => op.status === "pending" && op.kind === "spend")
    .reduce((sum, op) => sum + op.amount, 0);
  return NextResponse.json(
    {
      balance,
      effectiveBalance: balance === null ? null : balance - pending,
      tournament: publicCasinoTournamentView(t, discordId),
    },
    { headers: NO_STORE },
  );
}

export async function GET(request: Request) {
  const { session, status } = casinoTournamentSession(request);
  if (!session) return errorResponse("unauthorized", status);
  if (!isEconomyEnabled()) return errorResponse("economy_unavailable", 503);
  const t = await withUserLock("casino-tournament", () => loadCurrentCasinoTournament(Date.now()));
  return stateResponse(sessionOwnerKey(session), session.id, t);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return errorResponse("bad_origin", 403);
  const { session, status } = casinoTournamentSession(request);
  if (!session) return errorResponse("unauthorized", status);
  if (!isEconomyEnabled()) return errorResponse("economy_unavailable", 503);
  return withUserLock("casino-tournament", () => handlePost(request, session));
}

type AuthedSession = NonNullable<ReturnType<typeof casinoTournamentSession>["session"]>;

async function enqueueFee(
  ownerKey: string,
  discordId: string,
  id: string,
): Promise<EconomyOp | null> {
  const op = buildEconomyOp(
    {
      kind: "spend",
      userKey: ownerKey,
      discordId,
      amount: CASINO_TOURNAMENT_FEE,
      reason: "casino_tournament_entry",
    },
    id,
    Date.now(),
  );
  if (!op) return null;
  return (await enqueueEconomyOpOnce(op)) ? op : null;
}

async function handlePost(request: Request, session: AuthedSession) {
  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("bad_json", 400);
  }
  if (body.action !== "enter") return errorResponse("bad_action", 400);

  if (!(await currentMachine(ownerKey))) return errorResponse("not_at_casino", 409);

  const now = Date.now();
  let t = await loadCurrentCasinoTournament(now);
  if (t && t.status !== "entry") return errorResponse("tournament_closed", 409);
  if (t && t.entrants.includes(discordId)) return stateResponse(ownerKey, discordId, t);
  if (t && t.entrants.length >= CASINO_TOURNAMENT_MAX_ENTRANTS)
    return errorResponse("tournament_full", 409);

  const mine = await effectiveBalanceOf(ownerKey, discordId);
  if (mine === null || mine < CASINO_TOURNAMENT_FEE)
    return errorResponse("insufficient_balance", 409);

  if (!t) {
    t = {
      id: casinoTournamentId(now),
      status: "entry",
      createdAt: now,
      entryEndsAt: now + CASINO_TOURNAMENT_ENTRY_MS,
      playEndsAt: now + CASINO_TOURNAMENT_ENTRY_MS + CASINO_TOURNAMENT_PLAY_MS,
      playStartedAt: null,
      entrants: [],
      scores: {},
      prizesPaid: false,
      refundPaid: false,
      closedAt: null,
    };
  }
  const fee = await enqueueFee(ownerKey, discordId, casinoTournamentFeeOpId(t.id, discordId));
  if (!fee) return errorResponse("economy_unavailable", 503);
  t = { ...t, entrants: [...t.entrants, discordId] };
  t = await advanceCasinoTournamentInner(t, now);
  await saveCasinoTournament(t);
  return stateResponse(ownerKey, discordId, t);
}
