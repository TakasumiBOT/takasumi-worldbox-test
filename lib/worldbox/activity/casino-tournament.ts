export const CASINO_TOURNAMENT_FEE = 200;
export const CASINO_TOURNAMENT_MAX_ENTRANTS = 16;
export const CASINO_TOURNAMENT_ENTRY_MS = 30 * 60 * 1000;
export const CASINO_TOURNAMENT_PLAY_MS = 60 * 60 * 1000;
export const CASINO_TOURNAMENT_PRIZE_REASON = "casino_tournament_prize";
export const CASINO_TOURNAMENT_REFUND_REASON = "casino_tournament_refund";
export const CASINO_TOURNAMENT_SHARES = [0.5, 0.3, 0.2] as const;

export type CasinoTournamentStatus = "entry" | "running" | "done";

export interface CasinoTournamentScore {
  bet: number;
  payout: number;
}

export interface CasinoTournament {
  id: string;
  status: CasinoTournamentStatus;
  createdAt: number;
  entryEndsAt: number;
  playEndsAt: number;
  playStartedAt: number | null;
  entrants: string[];
  scores: Record<string, CasinoTournamentScore>;
  prizesPaid: boolean;
  refundPaid: boolean;
  closedAt: number | null;
}

export function casinoTournamentId(now: number): string {
  return `ct-${now}`;
}

export function casinoTournamentPrizePool(t: Pick<CasinoTournament, "entrants">): number {
  return t.entrants.length * CASINO_TOURNAMENT_FEE;
}

export function casinoTournamentPrizeOpId(tournamentId: string, rank: number): string {
  return `ct-prize-${tournamentId}-${rank}`;
}

export function casinoTournamentFeeOpId(tournamentId: string, discordId: string): string {
  return `ct-fee-${tournamentId}-${discordId}`;
}

export function casinoTournamentRefundOpId(tournamentId: string, discordId: string): string {
  return `ct-refund-${tournamentId}-${discordId}`;
}

export function netScore(score: CasinoTournamentScore): number {
  return score.payout - score.bet;
}

export function casinoStandings(
  t: CasinoTournament,
): { discordId: string; net: number; rank: number }[] {
  return t.entrants
    .map((discordId) => ({
      discordId,
      net: netScore(t.scores[discordId] ?? { bet: 0, payout: 0 }),
    }))
    .sort(
      (a, b) => b.net - a.net || t.entrants.indexOf(a.discordId) - t.entrants.indexOf(b.discordId),
    )
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function casinoPrizeSplit(
  t: CasinoTournament,
): { rank: number; discordId: string; amount: number }[] {
  const pool = casinoTournamentPrizePool(t);
  return casinoStandings(t)
    .filter((row) => row.net > 0)
    .slice(0, CASINO_TOURNAMENT_SHARES.length)
    .map((row) => ({
      rank: row.rank,
      discordId: row.discordId,
      amount: Math.floor(pool * CASINO_TOURNAMENT_SHARES[row.rank - 1]),
    }))
    .filter((row) => row.amount >= 1);
}

export function recordScore(
  t: CasinoTournament,
  discordId: string,
  bet: number,
  payout: number,
): CasinoTournament {
  if (t.status !== "running") return t;
  if (!t.entrants.includes(discordId)) return t;
  const prev = t.scores[discordId] ?? { bet: 0, payout: 0 };
  return {
    ...t,
    scores: { ...t.scores, [discordId]: { bet: prev.bet + bet, payout: prev.payout + payout } },
  };
}

export function closeCasinoEntry(t: CasinoTournament, now: number): CasinoTournament {
  if (t.status !== "entry") return t;
  if (now < t.entryEndsAt && t.entrants.length < CASINO_TOURNAMENT_MAX_ENTRANTS) return t;
  if (t.entrants.length < 2) {
    return { ...t, status: "done", closedAt: now };
  }
  return {
    ...t,
    status: "running",
    playStartedAt: now,
    playEndsAt: now + CASINO_TOURNAMENT_PLAY_MS,
  };
}

export function closeCasinoPlay(t: CasinoTournament, now: number): CasinoTournament {
  if (t.status !== "running") return t;
  if (now < t.playEndsAt) return t;
  return { ...t, status: "done", closedAt: now };
}

export function publicCasinoTournamentView(t: CasinoTournament | null, viewerDiscordId: string) {
  if (!t) {
    return {
      status: "none" as const,
      fee: CASINO_TOURNAMENT_FEE,
      maxEntrants: CASINO_TOURNAMENT_MAX_ENTRANTS,
      entrantCount: 0,
      entryEndsAt: null as number | null,
      playEndsAt: null as number | null,
      prizePool: 0,
      entered: false,
      myNet: 0,
      myRank: null as number | null,
      standings: [] as { rank: number; net: number; you: boolean }[],
    };
  }
  const rows = casinoStandings(t);
  const mine = rows.find((r) => r.discordId === viewerDiscordId);
  return {
    status: t.status,
    fee: CASINO_TOURNAMENT_FEE,
    maxEntrants: CASINO_TOURNAMENT_MAX_ENTRANTS,
    entrantCount: t.entrants.length,
    entryEndsAt: t.status === "entry" ? t.entryEndsAt : null,
    playEndsAt: t.status === "running" ? t.playEndsAt : null,
    prizePool: casinoTournamentPrizePool(t),
    entered: t.entrants.includes(viewerDiscordId),
    myNet: mine?.net ?? 0,
    myRank: mine?.rank ?? null,
    standings: rows.slice(0, 5).map((r) => ({
      rank: r.rank,
      net: r.net,
      you: r.discordId === viewerDiscordId,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCasinoTournament(raw: unknown): CasinoTournament | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !/^ct-\d+$/.test(raw.id)) return null;
  if (raw.status !== "entry" && raw.status !== "running" && raw.status !== "done") return null;
  if (
    typeof raw.createdAt !== "number" ||
    typeof raw.entryEndsAt !== "number" ||
    typeof raw.playEndsAt !== "number"
  )
    return null;
  if (!Array.isArray(raw.entrants) || raw.entrants.some((e) => typeof e !== "string")) return null;
  if (!isRecord(raw.scores)) return null;
  for (const [key, value] of Object.entries(raw.scores)) {
    if (typeof key !== "string" || !isRecord(value)) return null;
    if (typeof value.bet !== "number" || typeof value.payout !== "number") return null;
  }
  if (typeof raw.prizesPaid !== "boolean" || typeof raw.refundPaid !== "boolean") return null;
  if (raw.closedAt !== null && typeof raw.closedAt !== "number") return null;
  const playStartedAt =
    typeof raw.playStartedAt === "number" && Number.isFinite(raw.playStartedAt)
      ? raw.playStartedAt
      : null;
  return { ...(raw as unknown as CasinoTournament), playStartedAt };
}
