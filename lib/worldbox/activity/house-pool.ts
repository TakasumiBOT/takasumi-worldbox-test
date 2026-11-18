export const HOUSE_POOL_MIN_DEPOSIT = 1_000;
export const HOUSE_POOL_MAX_DEPOSIT = 10_000_000;
export const HOUSE_POOL_EXIT_FEE_RATE = 0.005;
export const HOUSE_POOL_SEED_RESERVE = 1_000_000;

export interface HousePoolState {
  poolWbc: number; // 実流動性 + 初期シード基準プール
  playerDepositWbc: number; // プレイヤー出資分の実預かり額
  totalShares: number; // プレイヤーに発行済のシェア総数
  systemSeedShares: number;
  sharesByActor: Record<string, number>;
  cumulativeYield: number;
  cumulativeLoss: number;
  seq: number;
}

export function emptyHousePoolState(): HousePoolState {
  return {
    poolWbc: HOUSE_POOL_SEED_RESERVE,
    playerDepositWbc: 0,
    totalShares: HOUSE_POOL_SEED_RESERVE,
    systemSeedShares: HOUSE_POOL_SEED_RESERVE,
    sharesByActor: {},
    cumulativeYield: 0,
    cumulativeLoss: 0,
    seq: 0,
  };
}

export function housePoolNavPerShare(state: HousePoolState): number {
  if (state.totalShares <= 0) return 1;
  return state.poolWbc / state.totalShares;
}

export function housePoolActorValue(state: HousePoolState, actorKey: string): number {
  const shares = state.sharesByActor[actorKey] ?? 0;
  if (shares <= 0 || state.totalShares <= 0) return 0;
  return Math.floor((shares * state.poolWbc) / state.totalShares);
}

export function planHousePoolDeposit(
  state: HousePoolState,
  actorKey: string,
  amountRaw: unknown,
):
  | { ok: true; state: HousePoolState; sharesMinted: number; amount: number }
  | { ok: false; error: "invalid_amount" } {
  if (
    typeof amountRaw !== "number" ||
    !Number.isInteger(amountRaw) ||
    amountRaw < HOUSE_POOL_MIN_DEPOSIT ||
    amountRaw > HOUSE_POOL_MAX_DEPOSIT
  ) {
    return { ok: false, error: "invalid_amount" };
  }
  const sharesMinted = Math.max(
    1,
    Math.floor((amountRaw * state.totalShares) / Math.max(1, state.poolWbc)),
  );
  const prevShares = state.sharesByActor[actorKey] ?? 0;
  return {
    ok: true,
    amount: amountRaw,
    sharesMinted,
    state: {
      ...state,
      poolWbc: state.poolWbc + amountRaw,
      playerDepositWbc: state.playerDepositWbc + amountRaw,
      totalShares: state.totalShares + sharesMinted,
      sharesByActor: {
        ...state.sharesByActor,
        [actorKey]: prevShares + sharesMinted,
      },
      seq: state.seq + 1,
    },
  };
}

export function planHousePoolWithdraw(
  state: HousePoolState,
  actorKey: string,
  sharesRaw: unknown,
):
  | {
      ok: true;
      state: HousePoolState;
      sharesBurned: number;
      gross: number;
      fee: number;
      net: number;
    }
  | { ok: false; error: "invalid_shares" | "insufficient_shares" | "insufficient_pool" } {
  if (typeof sharesRaw !== "number" || !Number.isInteger(sharesRaw) || sharesRaw < 1) {
    return { ok: false, error: "invalid_shares" };
  }
  const held = state.sharesByActor[actorKey] ?? 0;
  if (held < sharesRaw) return { ok: false, error: "insufficient_shares" };

  const gross = Math.floor((sharesRaw * state.poolWbc) / Math.max(1, state.totalShares));
  const fee = Math.floor(gross * HOUSE_POOL_EXIT_FEE_RATE);
  const net = Math.max(1, gross - fee);

  // 初期システムシード分以上には引き出せない安全制限
  const availablePlayerLiquidity = Math.max(
    0,
    state.poolWbc - Math.floor(HOUSE_POOL_SEED_RESERVE * 0.25),
  );
  if (net > availablePlayerLiquidity && state.playerDepositWbc < net) {
    return { ok: false, error: "insufficient_pool" };
  }

  const nextSharesMap = { ...state.sharesByActor };
  const rem = held - sharesRaw;
  if (rem === 0) delete nextSharesMap[actorKey];
  else nextSharesMap[actorKey] = rem;

  return {
    ok: true,
    sharesBurned: sharesRaw,
    gross,
    fee,
    net,
    state: {
      ...state,
      poolWbc: Math.max(1, state.poolWbc - net),
      playerDepositWbc: Math.max(0, state.playerDepositWbc - net),
      totalShares: Math.max(state.systemSeedShares, state.totalShares - sharesRaw),
      sharesByActor: nextSharesMap,
      seq: state.seq + 1,
    },
  };
}

export function applyHousePoolYield(state: HousePoolState, deltaWbc: number): HousePoolState {
  if (!Number.isInteger(deltaWbc) || deltaWbc === 0) return state;
  if (deltaWbc > 0) {
    return {
      ...state,
      poolWbc: state.poolWbc + deltaWbc,
      cumulativeYield: state.cumulativeYield + deltaWbc,
      seq: state.seq + 1,
    };
  }
  const loss = Math.min(-deltaWbc, Math.max(0, state.poolWbc - 10_000));
  return {
    ...state,
    poolWbc: Math.max(10_000, state.poolWbc - loss),
    cumulativeLoss: state.cumulativeLoss + loss,
    seq: state.seq + 1,
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

export function parseHousePoolState(raw: unknown): HousePoolState {
  const base = emptyHousePoolState();
  const data = asRecord(raw);
  if (!data) return base;
  const sharesByActor: Record<string, number> = {};
  const sRaw = asRecord(data.sharesByActor);
  let playerSharesSum = 0;
  if (sRaw) {
    for (const [k, v] of Object.entries(sRaw)) {
      const n = asInt(v);
      if (n > 0) {
        sharesByActor[k] = n;
        playerSharesSum += n;
      }
    }
  }
  const seed = Math.max(1, asInt(data.systemSeedShares, HOUSE_POOL_SEED_RESERVE));
  return {
    poolWbc: Math.max(1, asInt(data.poolWbc, HOUSE_POOL_SEED_RESERVE)),
    playerDepositWbc: Math.max(0, asInt(data.playerDepositWbc)),
    totalShares: Math.max(seed + playerSharesSum, asInt(data.totalShares, seed)),
    systemSeedShares: seed,
    sharesByActor,
    cumulativeYield: Math.max(0, asInt(data.cumulativeYield)),
    cumulativeLoss: Math.max(0, asInt(data.cumulativeLoss)),
    seq: Math.max(0, asInt(data.seq)),
  };
}
