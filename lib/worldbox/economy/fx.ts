import { computeCommodityMacroIndices, type CommoditiesMarketState } from "./commodities";

export const FX_SPREAD_RATE = 0.005; // 0.5% 片道スプレッド
export const FX_UNIT_SCALE = 100; // 1.00 通貨 = 100 centi-units
export const FX_BASE_WBC_RATE_APR = 0.03; // WBC 基準年利 3%
export const FX_LEVERAGE_CHOICES: readonly number[] = [2, 5, 10];
export const FX_MARGIN_MIN = 1_000;
export const FX_MARGIN_MAX = 1_000_000;
export const FX_MAINTENANCE_RATIO = 0.3; // 維持率 30% 以下でロスカット
export const FX_POSITIONS_LIMIT_PER_USER = 10;
export const FX_HISTORY_LIMIT = 48;

export type FxCurrencyId = "GLD" | "NRD" | "EST" | "VLT";

export interface FxCurrencyDef {
  id: FxCurrencyId;
  name: string;
  desc: string;
  baseRate: number; // WBC per 1.00 unit
  apr: number; // 政策金利（年率）
  sector: "material" | "food" | "crafted" | "special";
}

export const FX_CURRENCIES: readonly FxCurrencyDef[] = [
  {
    id: "GLD",
    name: "ゴールド本位 (GLD)",
    desc: "鉱石・貴金属市場とインフレに連動する安全通貨",
    baseRate: 2_500,
    apr: 0.02,
    sector: "material",
  },
  {
    id: "NRD",
    name: "ノーザン貿易フラン (NRD)",
    desc: "木材・農作物・国家繁栄に連動する貿易通貨",
    baseRate: 150,
    apr: 0.045,
    sector: "food",
  },
  {
    id: "EST",
    name: "イースタン製造円 (EST)",
    desc: "企業工場の加工品取引指数に連動する工業通貨",
    baseRate: 100,
    apr: 0.015,
    sector: "crafted",
  },
  {
    id: "VLT",
    name: "ヴォールトクレジット (VLT)",
    desc: "高金利スワップと金融活性度に連動する高リスク通貨",
    baseRate: 500,
    apr: 0.11,
    sector: "special",
  },
];

const FX_BY_ID = new Map<string, FxCurrencyDef>(FX_CURRENCIES.map((c) => [c.id, c]));

export function fxCurrencyById(id: unknown): FxCurrencyDef | null {
  return typeof id === "string" ? (FX_BY_ID.get(id.trim().toUpperCase()) ?? null) : null;
}

export interface FxFlowState {
  netFlowWbc: number;
  skewBps: number; // -3000 .. +4000
  volumeWbc: number;
  history: number[];
}

export interface FxMarginPosition {
  id: string;
  ownerKey: string;
  discordId: string;
  currency: FxCurrencyId;
  side: "long" | "short";
  leverage: number;
  marginWbc: number;
  notionalWbc: number;
  entryRate: number;
  openedAt: number;
  lastSwapAt: number;
  swapAccrued: number;
}

export interface FxAccount {
  // 保有外貨（centi-units: 100 = 1.00通貨）
  balances: Partial<Record<FxCurrencyId, number>>;
}

export interface FxMarketState {
  flows: Record<FxCurrencyId, FxFlowState>;
  accounts: Record<string, FxAccount>;
  positions: FxMarginPosition[];
  feeTreasury: number;
  seq: number;
}

export function emptyFxState(): FxMarketState {
  return {
    flows: {
      GLD: { netFlowWbc: 0, skewBps: 0, volumeWbc: 0, history: [2_500] },
      NRD: { netFlowWbc: 0, skewBps: 0, volumeWbc: 0, history: [150] },
      EST: { netFlowWbc: 0, skewBps: 0, volumeWbc: 0, history: [100] },
      VLT: { netFlowWbc: 0, skewBps: 0, volumeWbc: 0, history: [500] },
    },
    accounts: {},
    positions: [],
    feeTreasury: 0,
    seq: 0,
  };
}

function macroCycleFactor(id: FxCurrencyId, now: number): number {
  const hour = Math.floor(now / 3_600_000);
  const phase = id === "GLD" ? 0.7 : id === "NRD" ? 1.9 : id === "EST" ? 3.1 : 4.5;
  const wave = Math.sin(hour * 0.27 + phase) * 0.045 + Math.cos(hour * 0.11 + phase * 2) * 0.025;
  return 1 + wave;
}

export function fxMidRate(
  def: FxCurrencyDef,
  state: FxMarketState,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
): number {
  const macro = computeCommodityMacroIndices(commodities);
  const sectorIdx = macro.sectors[def.sector]?.priceRatio ?? 1;
  const sectorBoost = Math.max(0.8, Math.min(1.3, 1 + (sectorIdx - 1) * 0.6));
  const nationBoost = def.id === "NRD" ? Math.min(1.2, 1 + nationCount * 0.015) : 1;
  const flow = state.flows[def.id];
  const skewFactor = flow ? 1 + Math.max(-0.3, Math.min(0.4, flow.skewBps / 10_000)) : 1;
  const raw = def.baseRate * macroCycleFactor(def.id, now) * sectorBoost * nationBoost * skewFactor;
  return Math.max(10, Math.round(raw));
}

export function fxQuote(
  def: FxCurrencyDef,
  state: FxMarketState,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
): { mid: number; bid: number; ask: number } {
  const mid = fxMidRate(def, state, commodities, nationCount, now);
  const spread = Math.max(1, Math.round(mid * FX_SPREAD_RATE));
  return {
    mid,
    bid: Math.max(1, mid - spread),
    ask: mid + spread,
  };
}

export function fxSpotSwapBuy(
  state: FxMarketState,
  ownerKey: string,
  currencyRaw: unknown,
  wbcSpendRaw: unknown,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
):
  | {
      ok: true;
      state: FxMarketState;
      currency: FxCurrencyId;
      wbcSpent: number;
      centiReceived: number;
      askRate: number;
      fee: number;
    }
  | { ok: false; error: "unknown_currency" | "invalid_amount" | "amount_too_small" } {
  const def = fxCurrencyById(currencyRaw);
  if (!def) return { ok: false, error: "unknown_currency" };
  if (
    typeof wbcSpendRaw !== "number" ||
    !Number.isInteger(wbcSpendRaw) ||
    wbcSpendRaw < 100 ||
    wbcSpendRaw > 5_000_000
  ) {
    return { ok: false, error: "invalid_amount" };
  }
  const q = fxQuote(def, state, commodities, nationCount, now);
  const centiReceived = Math.floor((wbcSpendRaw * FX_UNIT_SCALE) / q.ask);
  if (centiReceived < 1) return { ok: false, error: "amount_too_small" };
  const exactCost = Math.ceil((centiReceived * q.ask) / FX_UNIT_SCALE);
  const fee = Math.floor((centiReceived * (q.ask - q.mid)) / FX_UNIT_SCALE);

  const prevAcc = state.accounts[ownerKey] ?? { balances: {} };
  const prevBal = prevAcc.balances[def.id] ?? 0;
  const prevFlow = state.flows[def.id];
  const bpsDelta = Math.max(1, Math.round(exactCost / 25_000));
  const nextSkew = Math.max(-3000, Math.min(4000, prevFlow.skewBps + bpsDelta));

  const nextState: FxMarketState = {
    ...state,
    accounts: {
      ...state.accounts,
      [ownerKey]: {
        balances: { ...prevAcc.balances, [def.id]: prevBal + centiReceived },
      },
    },
    flows: {
      ...state.flows,
      [def.id]: {
        netFlowWbc: prevFlow.netFlowWbc + exactCost,
        skewBps: nextSkew,
        volumeWbc: prevFlow.volumeWbc + exactCost,
        history: [...prevFlow.history, q.mid].slice(-FX_HISTORY_LIMIT),
      },
    },
    feeTreasury: state.feeTreasury + Math.max(0, fee),
    seq: state.seq + 1,
  };
  return {
    ok: true,
    state: nextState,
    currency: def.id,
    wbcSpent: exactCost,
    centiReceived,
    askRate: q.ask,
    fee: Math.max(0, fee),
  };
}

export function fxSpotSwapSell(
  state: FxMarketState,
  ownerKey: string,
  currencyRaw: unknown,
  centiUnitsRaw: unknown,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
):
  | {
      ok: true;
      state: FxMarketState;
      currency: FxCurrencyId;
      centiSold: number;
      wbcReceived: number;
      bidRate: number;
      fee: number;
    }
  | {
      ok: false;
      error: "unknown_currency" | "invalid_amount" | "not_enough_foreign" | "amount_too_small";
    } {
  const def = fxCurrencyById(currencyRaw);
  if (!def) return { ok: false, error: "unknown_currency" };
  if (typeof centiUnitsRaw !== "number" || !Number.isInteger(centiUnitsRaw) || centiUnitsRaw < 1) {
    return { ok: false, error: "invalid_amount" };
  }
  const prevAcc = state.accounts[ownerKey] ?? { balances: {} };
  const held = prevAcc.balances[def.id] ?? 0;
  if (held < centiUnitsRaw) return { ok: false, error: "not_enough_foreign" };

  const q = fxQuote(def, state, commodities, nationCount, now);
  const wbcReceived = Math.floor((centiUnitsRaw * q.bid) / FX_UNIT_SCALE);
  if (wbcReceived < 1) return { ok: false, error: "amount_too_small" };
  const fee = Math.floor((centiUnitsRaw * (q.mid - q.bid)) / FX_UNIT_SCALE);

  const nextBalances = { ...prevAcc.balances };
  const rem = held - centiUnitsRaw;
  if (rem === 0) delete nextBalances[def.id];
  else nextBalances[def.id] = rem;

  const prevFlow = state.flows[def.id];
  const bpsDelta = Math.max(1, Math.round(wbcReceived / 25_000));
  const nextSkew = Math.max(-3000, Math.min(4000, prevFlow.skewBps - bpsDelta));

  const nextState: FxMarketState = {
    ...state,
    accounts: {
      ...state.accounts,
      [ownerKey]: { balances: nextBalances },
    },
    flows: {
      ...state.flows,
      [def.id]: {
        netFlowWbc: prevFlow.netFlowWbc - wbcReceived,
        skewBps: nextSkew,
        volumeWbc: prevFlow.volumeWbc + wbcReceived,
        history: [...prevFlow.history, q.mid].slice(-FX_HISTORY_LIMIT),
      },
    },
    feeTreasury: state.feeTreasury + Math.max(0, fee),
    seq: state.seq + 1,
  };
  return {
    ok: true,
    state: nextState,
    currency: def.id,
    centiSold: centiUnitsRaw,
    wbcReceived,
    bidRate: q.bid,
    fee: Math.max(0, fee),
  };
}

export function accruePositionSwap(pos: FxMarginPosition, def: FxCurrencyDef, now: number): number {
  const hours = Math.floor(Math.max(0, now - pos.lastSwapAt) / 3_600_000);
  if (hours <= 0) return 0;
  const diffApr = def.apr - FX_BASE_WBC_RATE_APR;
  const signedApr = pos.side === "long" ? diffApr : -diffApr;
  return Math.round((pos.notionalWbc * signedApr * hours) / (24 * 365));
}

export function evaluateMarginPosition(
  pos: FxMarginPosition,
  currentRate: number,
  def: FxCurrencyDef,
  now: number,
): {
  unrealizedPnl: number;
  swapDelta: number;
  totalSwap: number;
  equity: number;
  marginRatio: number;
  liquidatable: boolean;
} {
  const pnl =
    pos.side === "long"
      ? Math.floor((pos.notionalWbc * (currentRate - pos.entryRate)) / pos.entryRate)
      : Math.floor((pos.notionalWbc * (pos.entryRate - currentRate)) / pos.entryRate);
  const swapDelta = accruePositionSwap(pos, def, now);
  const totalSwap = pos.swapAccrued + swapDelta;
  const equity = pos.marginWbc + pnl + totalSwap;
  const marginRatio = equity / Math.max(1, pos.marginWbc);
  return {
    unrealizedPnl: pnl,
    swapDelta,
    totalSwap,
    equity,
    marginRatio,
    liquidatable: marginRatio <= FX_MAINTENANCE_RATIO,
  };
}

export function openFxMarginPosition(
  state: FxMarketState,
  input: {
    ownerKey: string;
    discordId: string;
    currency: unknown;
    side: unknown;
    leverage: unknown;
    marginWbc: unknown;
    now: number;
  },
  commodities: CommoditiesMarketState,
  nationCount: number,
):
  | { ok: true; state: FxMarketState; position: FxMarginPosition }
  | {
      ok: false;
      error:
        | "unknown_currency"
        | "invalid_side"
        | "invalid_leverage"
        | "invalid_margin"
        | "position_limit";
    } {
  const def = fxCurrencyById(input.currency);
  if (!def) return { ok: false, error: "unknown_currency" };
  if (input.side !== "long" && input.side !== "short") return { ok: false, error: "invalid_side" };
  if (typeof input.leverage !== "number" || !FX_LEVERAGE_CHOICES.includes(input.leverage)) {
    return { ok: false, error: "invalid_leverage" };
  }
  if (
    typeof input.marginWbc !== "number" ||
    !Number.isInteger(input.marginWbc) ||
    input.marginWbc < FX_MARGIN_MIN ||
    input.marginWbc > FX_MARGIN_MAX
  ) {
    return { ok: false, error: "invalid_margin" };
  }
  const userPosCount = state.positions.filter((p) => p.ownerKey === input.ownerKey).length;
  if (userPosCount >= FX_POSITIONS_LIMIT_PER_USER) return { ok: false, error: "position_limit" };

  const q = fxQuote(def, state, commodities, nationCount, input.now);
  const entryRate = input.side === "long" ? q.ask : q.bid;
  const nextSeq = state.seq + 1;
  const pos: FxMarginPosition = {
    id: `FX${input.now.toString(36)}-${nextSeq}`,
    ownerKey: input.ownerKey,
    discordId: input.discordId,
    currency: def.id,
    side: input.side,
    leverage: input.leverage,
    marginWbc: input.marginWbc,
    notionalWbc: input.marginWbc * input.leverage,
    entryRate,
    openedAt: input.now,
    lastSwapAt: input.now,
    swapAccrued: 0,
  };

  const prevFlow = state.flows[def.id];
  const bpsMove = Math.max(1, Math.round(pos.notionalWbc / 50_000));
  const nextSkew = Math.max(
    -3000,
    Math.min(4000, prevFlow.skewBps + (input.side === "long" ? bpsMove : -bpsMove)),
  );

  return {
    ok: true,
    state: {
      ...state,
      positions: [...state.positions, pos],
      flows: {
        ...state.flows,
        [def.id]: {
          ...prevFlow,
          skewBps: nextSkew,
          volumeWbc: prevFlow.volumeWbc + pos.notionalWbc,
        },
      },
      seq: nextSeq,
    },
    position: pos,
  };
}

export function closeFxMarginPosition(
  state: FxMarketState,
  positionId: unknown,
  actorKey: string,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
  allowForcedLiquidation = false,
):
  | {
      ok: true;
      state: FxMarketState;
      position: FxMarginPosition;
      payout: number;
      liquidatorReward: number;
      pnl: number;
      liquidated: boolean;
    }
  | { ok: false; error: "position_not_found" | "forbidden" | "not_liquidatable" } {
  if (typeof positionId !== "string") return { ok: false, error: "position_not_found" };
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) return { ok: false, error: "position_not_found" };
  const def = fxCurrencyById(pos.currency);
  if (!def) return { ok: false, error: "position_not_found" };

  const q = fxQuote(def, state, commodities, nationCount, now);
  const closeRate = pos.side === "long" ? q.bid : q.ask;
  const evalRes = evaluateMarginPosition(pos, closeRate, def, now);
  const isOwner = pos.ownerKey === actorKey;

  if (!isOwner) {
    if (!allowForcedLiquidation) return { ok: false, error: "forbidden" };
    if (!evalRes.liquidatable) return { ok: false, error: "not_liquidatable" };
  }

  const rawEquity = Math.max(0, evalRes.equity);
  const liquidated = evalRes.liquidatable;
  const liquidatorReward = !isOwner && liquidated ? Math.floor(rawEquity * 0.05) : 0;
  const payout = Math.max(0, rawEquity - liquidatorReward);

  return {
    ok: true,
    state: {
      ...state,
      positions: state.positions.filter((p) => p.id !== positionId),
      seq: state.seq + 1,
    },
    position: pos,
    payout,
    liquidatorReward,
    pnl: evalRes.unrealizedPnl + evalRes.totalSwap,
    liquidated,
  };
}

export function fxSpotPortfolioValue(
  state: FxMarketState,
  ownerKey: string,
  commodities: CommoditiesMarketState,
  nationCount: number,
  now: number,
): number {
  const acc = state.accounts[ownerKey];
  if (!acc) return 0;
  let total = 0;
  for (const def of FX_CURRENCIES) {
    const centi = acc.balances[def.id] ?? 0;
    if (centi <= 0) continue;
    const mid = fxMidRate(def, state, commodities, nationCount, now);
    total += Math.floor((centi * mid) / FX_UNIT_SCALE);
  }
  return total;
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

export function parseFxState(raw: unknown): FxMarketState {
  const base = emptyFxState();
  const data = asRecord(raw);
  if (!data) return base;

  const flowsRaw = asRecord(data.flows);
  if (flowsRaw) {
    for (const def of FX_CURRENCIES) {
      const f = asRecord(flowsRaw[def.id]);
      if (!f) continue;
      const history = Array.isArray(f.history)
        ? f.history
            .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
            .map((n) => Math.trunc(n))
            .slice(-FX_HISTORY_LIMIT)
        : base.flows[def.id].history;
      base.flows[def.id] = {
        netFlowWbc: asInt(f.netFlowWbc),
        skewBps: Math.max(-3000, Math.min(4000, asInt(f.skewBps))),
        volumeWbc: Math.max(0, asInt(f.volumeWbc)),
        history: history.length > 0 ? history : base.flows[def.id].history,
      };
    }
  }

  const accRaw = asRecord(data.accounts);
  if (accRaw) {
    for (const [ownerKey, entry] of Object.entries(accRaw)) {
      const a = asRecord(entry);
      const bRaw = asRecord(a?.balances);
      if (!bRaw) continue;
      const balances: Partial<Record<FxCurrencyId, number>> = {};
      for (const def of FX_CURRENCIES) {
        const val = asInt(bRaw[def.id]);
        if (val > 0) balances[def.id] = val;
      }
      if (Object.keys(balances).length > 0) {
        base.accounts[ownerKey] = { balances };
      }
    }
  }

  if (Array.isArray(data.positions)) {
    for (const entry of data.positions) {
      const p = asRecord(entry);
      if (!p || typeof p.id !== "string" || typeof p.ownerKey !== "string") continue;
      const def = fxCurrencyById(p.currency);
      if (!def) continue;
      if (p.side !== "long" && p.side !== "short") continue;
      const leverage = asInt(p.leverage);
      const marginWbc = asInt(p.marginWbc);
      const entryRate = asInt(p.entryRate);
      if (leverage < 1 || marginWbc < 1 || entryRate < 1) continue;
      base.positions.push({
        id: p.id,
        ownerKey: p.ownerKey,
        discordId: typeof p.discordId === "string" ? p.discordId : "",
        currency: def.id,
        side: p.side,
        leverage,
        marginWbc,
        notionalWbc: Math.max(marginWbc, asInt(p.notionalWbc, marginWbc * leverage)),
        entryRate,
        openedAt: Math.max(0, asInt(p.openedAt)),
        lastSwapAt: Math.max(0, asInt(p.lastSwapAt)),
        swapAccrued: asInt(p.swapAccrued),
      });
    }
  }

  base.feeTreasury = Math.max(0, asInt(data.feeTreasury));
  base.seq = Math.max(0, asInt(data.seq));
  return base;
}
