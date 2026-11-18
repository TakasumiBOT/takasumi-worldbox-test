import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { emptyExchangeState, parseExchangeState, type ExchangeState } from "./exchange";
import { payoutUserChunked } from "./settlement";
import { stockById } from "./stock";
import { loadStockAccount, storeStockAccount } from "./stock-online";

export const WORLDBOX_EXCHANGE_NAMESPACE = "worldbox_exchange";
const EXCHANGE_STATE_KEY = "exchange_v1";

export function isExchangeEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadExchangeState(): Promise<ExchangeState> {
  if (!isBotApiConfigured()) return emptyExchangeState();
  try {
    const raw = await kvGet(WORLDBOX_EXCHANGE_NAMESPACE, EXCHANGE_STATE_KEY);
    return parseExchangeState(raw);
  } catch {
    return emptyExchangeState();
  }
}

export async function storeExchangeState(state: ExchangeState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_EXCHANGE_NAMESPACE, EXCHANGE_STATE_KEY, state);
    return true;
  } catch {
    return false;
  }
}

export async function syncNpcHoldingsForDividendCron(
  ownerKey: string,
  exchangeHoldings: Record<string, number>,
): Promise<void> {
  try {
    const account = await loadStockAccount(ownerKey);
    const nextNpc: Record<string, number> = {};
    for (const [sym, shares] of Object.entries(exchangeHoldings)) {
      if (stockById(sym) && shares > 0) nextNpc[sym] = shares;
    }
    await storeStockAccount(ownerKey, { ...account, holdings: nextNpc });
  } catch {
    /* best effort */
  }
}

export async function flushExchangeDividends(
  state: ExchangeState,
  ownerKey: string,
  discordId: string,
): Promise<{ state: ExchangeState; paid: number }> {
  const portfolio = state.portfolios[ownerKey];
  if (!portfolio || portfolio.claimableDividends <= 0) {
    return { state, paid: 0 };
  }
  const amount = portfolio.claimableDividends;
  const res = await payoutUserChunked(ownerKey, discordId, amount, "company_dividend");
  if (res.state !== "done" && res.state !== "pending") {
    return { state, paid: 0 };
  }
  const nextState: ExchangeState = {
    ...state,
    portfolios: {
      ...state.portfolios,
      [ownerKey]: {
        ...portfolio,
        claimableDividends: 0,
      },
    },
  };
  await storeExchangeState(nextState);
  return { state: nextState, paid: amount };
}
