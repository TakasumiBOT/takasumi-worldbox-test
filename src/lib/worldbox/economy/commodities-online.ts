import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { addItem, type PlayerProfile } from "../player/profile";
import { loadProfile, storeProfile } from "../player/profile-online";
import { appendCompanyHistory, loadCompany, storeCompany } from "../social/company-online";
import { addCompanyInventory, applyCompanyMarketRevenue } from "../social/company-production";
import {
  emptyCommoditiesMarket,
  parseCommoditiesMarket,
  takeActorClaims,
  type CommoditiesMarketState,
} from "./commodities";
import { payoutUserChunked } from "./settlement";

export const WORLDBOX_MARKET_NAMESPACE = "worldbox_market";
const ORDERBOOK_KEY = "orderbook_v1";

export function isMarketEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadCommoditiesMarket(): Promise<CommoditiesMarketState> {
  if (!isBotApiConfigured()) return emptyCommoditiesMarket();
  try {
    const raw = await kvGet(WORLDBOX_MARKET_NAMESPACE, ORDERBOOK_KEY);
    return parseCommoditiesMarket(raw);
  } catch {
    return emptyCommoditiesMarket();
  }
}

export async function storeCommoditiesMarket(state: CommoditiesMarketState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_MARKET_NAMESPACE, ORDERBOOK_KEY, state);
    return true;
  } catch {
    return false;
  }
}

export async function flushPlayerMarketClaims(
  state: CommoditiesMarketState,
  ownerKey: string,
  discordId: string,
): Promise<{
  state: CommoditiesMarketState;
  claimedCoins: number;
  claimedItems: Record<string, number>;
}> {
  const { state: nextState, claim } = takeActorClaims(state, ownerKey);
  if (claim.coins <= 0 && Object.keys(claim.items).length === 0) {
    return { state, claimedCoins: 0, claimedItems: {} };
  }

  let profile: PlayerProfile | null = null;
  if (Object.keys(claim.items).length > 0) {
    profile = await loadProfile(ownerKey);
    for (const [itemId, qty] of Object.entries(claim.items)) {
      if (qty > 0) profile = addItem(profile, itemId, qty);
    }
    const saved = await storeProfile(ownerKey, profile);
    if (!saved) {
      return { state, claimedCoins: 0, claimedItems: {} };
    }
  }

  if (claim.coins > 0) {
    const paid = await payoutUserChunked(ownerKey, discordId, claim.coins, "market_sale");
    if (paid.state !== "done" && paid.state !== "pending") {
      // アイテムだけ付与済みだった場合はコインのみ未受取として残す
      const rollbackState: CommoditiesMarketState = {
        ...nextState,
        claims: {
          ...nextState.claims,
          [ownerKey]: { coins: claim.coins, items: {} },
        },
      };
      await storeCommoditiesMarket(rollbackState);
      return { state: rollbackState, claimedCoins: 0, claimedItems: claim.items };
    }
  }

  await storeCommoditiesMarket(nextState);
  return { state: nextState, claimedCoins: claim.coins, claimedItems: claim.items };
}

export async function flushCompanyMarketClaims(
  state: CommoditiesMarketState,
  companyId: string,
  now: number,
): Promise<{
  state: CommoditiesMarketState;
  claimedCoins: number;
  claimedItems: Record<string, number>;
}> {
  const actorKey = `company:${companyId}`;
  const { state: nextState, claim } = takeActorClaims(state, actorKey);
  if (claim.coins <= 0 && Object.keys(claim.items).length === 0) {
    return { state, claimedCoins: 0, claimedItems: {} };
  }
  const loaded = await loadCompany(companyId);
  if (!loaded) return { state, claimedCoins: 0, claimedItems: {} };

  let company = loaded;
  const entries = [];
  for (const [itemId, qty] of Object.entries(claim.items)) {
    const stocked = addCompanyInventory(company, itemId, qty);
    if (stocked) company = stocked;
  }
  if (claim.coins > 0) {
    const step = applyCompanyMarketRevenue(company, claim.coins, 0, "market", 1, "", now);
    company = step.company;
    entries.push(step.entry);
  }
  if (!(await storeCompany(company))) {
    return { state, claimedCoins: 0, claimedItems: {} };
  }
  if (entries.length > 0) await appendCompanyHistory(company.id, entries);
  await storeCommoditiesMarket(nextState);
  return { state: nextState, claimedCoins: claim.coins, claimedItems: claim.items };
}
