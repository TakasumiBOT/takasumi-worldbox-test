export const PREDICTION_WINDOW_MS = 3_600_000; // 1時間ごとの予測市場ラウンド
export const PREDICTION_BET_CLOSE_BEFORE_MS = 5 * 60_000; // 確定5分前で締切
export const PREDICTION_BET_MIN = 100;
export const PREDICTION_BET_MAX = 500_000;
export const PREDICTION_FEE_RATE = 0.04; // 手数料4%（半分が胴元LPプールへ還流）
export const PREDICTION_HISTORY_LIMIT = 24;

export type PredictionSide = "up" | "down";
export type PredictionKind = "fx" | "stock";

export interface PredictionBet {
  id: string;
  ownerKey: string;
  discordId: string;
  roundId: string;
  side: PredictionSide;
  amount: number;
  placedAt: number;
  claimed: boolean;
  payout: number;
}

export interface PredictionRound {
  id: string;
  kind: PredictionKind;
  symbol: string;
  label: string;
  strikePrice: number;
  opensAt: number;
  closesAt: number;
  settlesAt: number;
  upPool: number;
  downPool: number;
  settled: boolean;
  finalPrice: number | null;
  winner: PredictionSide | null;
  feeCollected: number;
}

export interface PredictionMarketState {
  rounds: Record<string, PredictionRound>;
  bets: PredictionBet[];
  seq: number;
}

export function emptyPredictionState(): PredictionMarketState {
  return {
    rounds: {},
    bets: [],
    seq: 0,
  };
}

export function currentRoundWindow(now: number): {
  windowKey: string;
  opensAt: number;
  closesAt: number;
  settlesAt: number;
} {
  const opensAt = Math.floor(now / PREDICTION_WINDOW_MS) * PREDICTION_WINDOW_MS;
  const settlesAt = opensAt + PREDICTION_WINDOW_MS;
  const closesAt = settlesAt - PREDICTION_BET_CLOSE_BEFORE_MS;
  const windowKey = new Date(opensAt).toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return { windowKey, opensAt, closesAt, settlesAt };
}

export function ensureRound(
  state: PredictionMarketState,
  target: {
    kind: PredictionKind;
    symbol: string;
    label: string;
    strikePrice: number;
  },
  now: number,
): { state: PredictionMarketState; round: PredictionRound } {
  const win = currentRoundWindow(now);
  const id = `${target.kind}:${target.symbol}:${win.windowKey}`;
  const existing = state.rounds[id];
  if (existing) return { state, round: existing };

  const round: PredictionRound = {
    id,
    kind: target.kind,
    symbol: target.symbol,
    label: target.label,
    strikePrice: Math.max(1, Math.round(target.strikePrice)),
    opensAt: win.opensAt,
    closesAt: win.closesAt,
    settlesAt: win.settlesAt,
    upPool: 0,
    downPool: 0,
    settled: false,
    finalPrice: null,
    winner: null,
    feeCollected: 0,
  };

  // 古い決済済みラウンドは直近24件以内に整理
  const entries = Object.entries(state.rounds).slice(-(PREDICTION_HISTORY_LIMIT - 1));
  return {
    state: {
      ...state,
      rounds: { ...Object.fromEntries(entries), [id]: round },
    },
    round,
  };
}

export function planPredictionBet(
  state: PredictionMarketState,
  input: {
    ownerKey: string;
    discordId: string;
    roundId: unknown;
    side: unknown;
    amount: unknown;
    now: number;
  },
):
  | { ok: true; state: PredictionMarketState; bet: PredictionBet }
  | { ok: false; error: "round_not_found" | "betting_closed" | "invalid_side" | "invalid_amount" } {
  if (typeof input.roundId !== "string" || !state.rounds[input.roundId]) {
    return { ok: false, error: "round_not_found" };
  }
  const round = state.rounds[input.roundId];
  if (round.settled || input.now >= round.closesAt) {
    return { ok: false, error: "betting_closed" };
  }
  if (input.side !== "up" && input.side !== "down") {
    return { ok: false, error: "invalid_side" };
  }
  if (
    typeof input.amount !== "number" ||
    !Number.isInteger(input.amount) ||
    input.amount < PREDICTION_BET_MIN ||
    input.amount > PREDICTION_BET_MAX
  ) {
    return { ok: false, error: "invalid_amount" };
  }

  const seq = state.seq + 1;
  const bet: PredictionBet = {
    id: `PB${input.now.toString(36)}-${seq}`,
    ownerKey: input.ownerKey,
    discordId: input.discordId,
    roundId: round.id,
    side: input.side,
    amount: input.amount,
    placedAt: input.now,
    claimed: false,
    payout: 0,
  };

  const nextRound: PredictionRound = {
    ...round,
    upPool: round.upPool + (input.side === "up" ? input.amount : 0),
    downPool: round.downPool + (input.side === "down" ? input.amount : 0),
  };

  return {
    ok: true,
    bet,
    state: {
      ...state,
      rounds: { ...state.rounds, [round.id]: nextRound },
      bets: [bet, ...state.bets].slice(0, 200),
      seq,
    },
  };
}

export function settlePredictionRound(
  state: PredictionMarketState,
  roundId: string,
  finalPrice: number,
  now: number,
): {
  state: PredictionMarketState;
  settled: boolean;
  houseFeeYield: number;
} {
  const round = state.rounds[roundId];
  if (!round || round.settled || now < round.settlesAt) {
    return { state, settled: false, houseFeeYield: 0 };
  }
  const winner: PredictionSide = finalPrice >= round.strikePrice ? "up" : "down";
  const totalPool = round.upPool + round.downPool;
  const winPool = winner === "up" ? round.upPool : round.downPool;

  // 片側にしかベットが無い・勝者側ベット0の場合は手数料なしで全額返金
  const fee =
    winPool > 0 && round.upPool > 0 && round.downPool > 0
      ? Math.floor(totalPool * PREDICTION_FEE_RATE)
      : 0;
  const distributable = Math.max(0, totalPool - fee);

  const nextBets = state.bets.map((b) => {
    if (b.roundId !== roundId) return b;
    if (winPool <= 0) {
      return { ...b, payout: b.amount };
    }
    if (b.side !== winner) {
      return { ...b, payout: 0, claimed: true };
    }
    const sharePayout = Math.floor((distributable * b.amount) / winPool);
    return { ...b, payout: sharePayout };
  });

  const settledRound: PredictionRound = {
    ...round,
    settled: true,
    finalPrice: Math.max(1, Math.round(finalPrice)),
    winner,
    feeCollected: fee,
  };

  return {
    settled: true,
    houseFeeYield: Math.floor(fee * 0.5),
    state: {
      ...state,
      rounds: { ...state.rounds, [roundId]: settledRound },
      bets: nextBets,
    },
  };
}

export function claimUserPredictionPayouts(
  state: PredictionMarketState,
  ownerKey: string,
): { state: PredictionMarketState; totalPayout: number; betIds: string[] } {
  let totalPayout = 0;
  const betIds: string[] = [];
  const nextBets = state.bets.map((b) => {
    if (b.ownerKey !== ownerKey || b.claimed) return b;
    const round = state.rounds[b.roundId];
    if (!round || !round.settled) return b;
    if (b.payout > 0) {
      totalPayout += b.payout;
      betIds.push(b.id);
    }
    return { ...b, claimed: true };
  });
  if (totalPayout <= 0 && betIds.length === 0) {
    return { state, totalPayout: 0, betIds: [] };
  }
  return {
    state: { ...state, bets: nextBets },
    totalPayout,
    betIds,
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

export function parsePredictionState(raw: unknown): PredictionMarketState {
  const data = asRecord(raw);
  if (!data) return emptyPredictionState();

  const rounds: Record<string, PredictionRound> = {};
  const rRaw = asRecord(data.rounds);
  if (rRaw) {
    for (const [id, entry] of Object.entries(rRaw)) {
      const r = asRecord(entry);
      if (!r || typeof r.symbol !== "string") continue;
      if (r.kind !== "fx" && r.kind !== "stock") continue;
      rounds[id] = {
        id,
        kind: r.kind,
        symbol: r.symbol,
        label: typeof r.label === "string" ? r.label : r.symbol,
        strikePrice: Math.max(1, asInt(r.strikePrice, 1)),
        opensAt: Math.max(0, asInt(r.opensAt)),
        closesAt: Math.max(0, asInt(r.closesAt)),
        settlesAt: Math.max(0, asInt(r.settlesAt)),
        upPool: Math.max(0, asInt(r.upPool)),
        downPool: Math.max(0, asInt(r.downPool)),
        settled: r.settled === true,
        finalPrice: typeof r.finalPrice === "number" ? Math.trunc(r.finalPrice) : null,
        winner: r.winner === "up" || r.winner === "down" ? r.winner : null,
        feeCollected: Math.max(0, asInt(r.feeCollected)),
      };
    }
  }

  const bets: PredictionBet[] = [];
  if (Array.isArray(data.bets)) {
    for (const entry of data.bets.slice(0, 200)) {
      const b = asRecord(entry);
      if (!b || typeof b.id !== "string" || typeof b.ownerKey !== "string") continue;
      if (typeof b.roundId !== "string") continue;
      if (b.side !== "up" && b.side !== "down") continue;
      const amount = asInt(b.amount);
      if (amount < 1) continue;
      bets.push({
        id: b.id,
        ownerKey: b.ownerKey,
        discordId: typeof b.discordId === "string" ? b.discordId : "",
        roundId: b.roundId,
        side: b.side,
        amount,
        placedAt: Math.max(0, asInt(b.placedAt)),
        claimed: b.claimed === true,
        payout: Math.max(0, asInt(b.payout)),
      });
    }
  }

  return {
    rounds,
    bets,
    seq: Math.max(0, asInt(data.seq)),
  };
}
