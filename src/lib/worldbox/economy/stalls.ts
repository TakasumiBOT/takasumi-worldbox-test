import { itemById } from "./items";

export type StallState = {
  ownerKey: string;
  itemId: string;
  price: number;
  count: number;
};

export const STALL_PRICE_MAX = 1_000_000;
export const STALL_COUNT_MAX = 99;

export function validStallPrice(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 && n <= STALL_PRICE_MAX ? n : null;
}

export function validStallCount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 && n <= STALL_COUNT_MAX ? n : null;
}

export function parseStall(raw: unknown): StallState | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const v = data as Record<string, unknown>;
  if (typeof v.ownerKey !== "string" || v.ownerKey.length === 0) return null;
  if (!itemById(v.itemId)) return null;
  const price = validStallPrice(v.price);
  const count = validStallCount(v.count);
  if (price === null || count === null) return null;
  return { ownerKey: v.ownerKey, itemId: v.itemId as string, price, count };
}

export function serializeStall(state: StallState): string {
  return JSON.stringify(state);
}

export function stallAfterSale(state: StallState): StallState | null {
  return state.count > 1 ? { ...state, count: state.count - 1 } : null;
}

export function isStallItem(itemId: unknown): boolean {
  return itemId === "market_stall";
}
