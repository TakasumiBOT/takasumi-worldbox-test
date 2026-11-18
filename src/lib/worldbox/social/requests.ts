import { itemById } from "../economy/items";
import { addItem, removeItem, type PlayerProfile } from "../player/profile";
import type { CoinMovement } from "../economy/economy";

export const REQUESTS_STATE_VERSION = 1;
export const MAX_OPEN_PER_GUILD = 20;
export const MAX_OPEN_PER_POSTER = 5;

export type GuildRequest = {
  id: string;
  guildId: string;
  posterKey: string;
  posterName: string;
  itemId: string;
  count: number;
  reward: number;
  createdAt: number;
};

export type RequestsState = {
  requests: Record<string, GuildRequest>;
};

export function emptyRequestsState(): RequestsState {
  return { requests: {} };
}

export type RequestError =
  | "unknown_item"
  | "invalid_count"
  | "invalid_reward"
  | "not_enough_coins"
  | "not_enough_items"
  | "too_many_guild"
  | "too_many_poster"
  | "not_found"
  | "not_poster"
  | "self_fulfill"
  | "wrong_guild";

export type PostResult =
  | { ok: true; state: RequestsState; request: GuildRequest; coin: CoinMovement }
  | { ok: false; error: RequestError };

export function postRequest(
  state: RequestsState,
  input: {
    id: string;
    guildId: string;
    posterKey: string;
    posterName: string;
    itemId: unknown;
    count: unknown;
    reward: unknown;
    now: number;
  },
  balance: number,
): PostResult {
  const item = itemById(input.itemId);
  if (!item) return { ok: false, error: "unknown_item" };
  if (
    typeof input.count !== "number" ||
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 99
  ) {
    return { ok: false, error: "invalid_count" };
  }
  if (
    typeof input.reward !== "number" ||
    !Number.isInteger(input.reward) ||
    input.reward < 1 ||
    input.reward > 1_000_000
  ) {
    return { ok: false, error: "invalid_reward" };
  }
  if (balance < input.reward) return { ok: false, error: "not_enough_coins" };
  const open = Object.values(state.requests).filter((r) => r.guildId === input.guildId);
  if (open.length >= MAX_OPEN_PER_GUILD) return { ok: false, error: "too_many_guild" };
  if (open.filter((r) => r.posterKey === input.posterKey).length >= MAX_OPEN_PER_POSTER) {
    return { ok: false, error: "too_many_poster" };
  }
  const request: GuildRequest = {
    id: input.id,
    guildId: input.guildId,
    posterKey: input.posterKey,
    posterName: input.posterName,
    itemId: item.id,
    count: input.count,
    reward: input.reward,
    createdAt: input.now,
  };
  return {
    ok: true,
    state: { requests: { ...state.requests, [request.id]: request } },
    request,
    coin: { kind: "spend", amount: request.reward, reason: "guild_request_escrow" },
  };
}

export type FulfillResult =
  | {
      ok: true;
      state: RequestsState;
      request: GuildRequest;
      fulfillerProfile: PlayerProfile;
      posterProfile: PlayerProfile;
      coin: CoinMovement;
    }
  | { ok: false; error: RequestError };

export function fulfillRequest(
  state: RequestsState,
  requestId: string,
  guildId: string,
  fulfillerKey: string,
  fulfillerProfile: PlayerProfile,
  posterProfile: PlayerProfile,
): FulfillResult {
  const request = state.requests[requestId];
  if (!request) return { ok: false, error: "not_found" };
  if (request.guildId !== guildId) return { ok: false, error: "wrong_guild" };
  if (request.posterKey === fulfillerKey) return { ok: false, error: "self_fulfill" };
  const removed = removeItem(fulfillerProfile, request.itemId, request.count);
  if (!removed) return { ok: false, error: "not_enough_items" };
  const requests = { ...state.requests };
  delete requests[requestId];
  return {
    ok: true,
    state: { requests },
    request,
    fulfillerProfile: removed,
    posterProfile: addItem(posterProfile, request.itemId, request.count),
    coin: { kind: "earn", amount: request.reward, reason: "guild_request_reward" },
  };
}

export type CancelResult =
  | { ok: true; state: RequestsState; request: GuildRequest; coin: CoinMovement }
  | { ok: false; error: RequestError };

export function cancelRequest(
  state: RequestsState,
  requestId: string,
  posterKey: string,
): CancelResult {
  const request = state.requests[requestId];
  if (!request) return { ok: false, error: "not_found" };
  if (request.posterKey !== posterKey) return { ok: false, error: "not_poster" };
  const requests = { ...state.requests };
  delete requests[requestId];
  return {
    ok: true,
    state: { requests },
    request,
    coin: { kind: "earn", amount: request.reward, reason: "guild_request_refund" },
  };
}

export function requestsForGuild(state: RequestsState, guildId: string): GuildRequest[] {
  return Object.values(state.requests)
    .filter((r) => r.guildId === guildId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function isValidRequest(value: unknown): value is GuildRequest {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    REQUEST_ID_RE.test(r.id) &&
    typeof r.guildId === "string" &&
    r.guildId.length > 0 &&
    typeof r.posterKey === "string" &&
    r.posterKey.length > 0 &&
    typeof r.posterName === "string" &&
    itemById(r.itemId) !== null &&
    typeof r.count === "number" &&
    Number.isInteger(r.count) &&
    r.count >= 1 &&
    r.count <= 99 &&
    typeof r.reward === "number" &&
    Number.isInteger(r.reward) &&
    r.reward >= 1 &&
    r.reward <= 1_000_000 &&
    typeof r.createdAt === "number" &&
    Number.isFinite(r.createdAt)
  );
}

export function parseRequestsState(raw: unknown): RequestsState {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return emptyRequestsState();
    }
  }
  if (typeof value !== "object" || value === null) return emptyRequestsState();
  const doc = value as { v?: unknown; requests?: unknown };
  if (doc.v !== REQUESTS_STATE_VERSION) return emptyRequestsState();
  if (typeof doc.requests !== "object" || doc.requests === null) return emptyRequestsState();
  const requests: Record<string, GuildRequest> = {};
  for (const entry of Object.values(doc.requests as Record<string, unknown>)) {
    if (isValidRequest(entry)) requests[entry.id] = entry;
  }
  return { requests };
}

export function serializeRequestsState(state: RequestsState): string {
  return JSON.stringify({ v: REQUESTS_STATE_VERSION, requests: state.requests });
}
