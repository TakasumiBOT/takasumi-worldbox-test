import { WORLD_COORD_LIMIT, isSolidMapTile, mapTileAt, type TopDownMap } from "../world/mapgen";
import { findFreeNear } from "../player/move";
import { presenceIdFor } from "../player/presence";

export const TERRITORY_RADIUS = 6;

export const NATIONS_STATE_VERSION = 2;

export type NationRole = "king" | "minister" | "citizen";

export type Nation = {
  guildId: string;
  name: string;
  color: string;
  kingKey: string;
  capital: { x: number; y: number };
  createdAt: number;
};

export type Membership = {
  nationId: string;
  role: NationRole;
};

export type NationsState = {
  nations: Record<string, Nation>;
  members: Record<string, Membership>;
};

export const NATION_PALETTE = [
  "#e5484d",
  "#f76b15",
  "#ffb224",
  "#46a758",
  "#12a594",
  "#0091ff",
  "#6e56cf",
  "#d6409f",
  "#8d6e63",
  "#697177",
] as const;

export function emptyNationsState(): NationsState {
  return { nations: {}, members: {} };
}

export function pickNationColor(state: NationsState): string {
  const used = new Map<string, number>();
  for (const n of Object.values(state.nations)) used.set(n.color, (used.get(n.color) ?? 0) + 1);
  let best: string = NATION_PALETTE[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of NATION_PALETTE) {
    const count = used.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function capitalFits(map: TopDownMap, x: number, y: number, nations: Nation[]): boolean {
  const r = TERRITORY_RADIUS;
  if (Math.abs(x) > WORLD_COORD_LIMIT - r || Math.abs(y) > WORLD_COORD_LIMIT - r) return false;
  if (isSolidMapTile(mapTileAt(map, x, y))) return false;
  for (const n of nations) {
    if (chebyshev(x, y, n.capital.x, n.capital.y) <= r * 2) return false;
  }
  return true;
}

export const CAPITAL_SEARCH_CENTER = { x: 512, y: 512 };
const CAPITAL_SEARCH_MAX_RING = 1024;

export function findCapitalTile(
  map: TopDownMap,
  nations: Nation[],
  center: { x: number; y: number } = CAPITAL_SEARCH_CENTER,
): { x: number; y: number } | null {
  for (let r = 0; r <= CAPITAL_SEARCH_MAX_RING; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        if (capitalFits(map, x, y, nations)) return { x, y };
      }
    }
  }
  return null;
}

export function memberCounts(state: NationsState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of Object.values(state.members)) {
    counts[m.nationId] = (counts[m.nationId] ?? 0) + 1;
  }
  return counts;
}

export type NationActionResult =
  | { ok: true; state: NationsState; nation?: Nation; disbanded?: boolean }
  | { ok: false; error: string };

export type FoundGuild = { id: string; name: string };

export function applyFound(
  state: NationsState,
  ownerKey: string,
  guild: FoundGuild,
  map: TopDownMap,
  now: number,
): NationActionResult {
  if (typeof guild?.id !== "string" || !/^\d+$/.test(guild.id))
    return { ok: false, error: "invalid_request" };
  if (state.nations[guild.id]) return { ok: false, error: "nation_exists" };
  if (state.members[ownerKey]) return { ok: false, error: "already_in_nation" };
  const capital = findCapitalTile(map, Object.values(state.nations));
  if (!capital) return { ok: false, error: "no_free_tile" };
  const name = (typeof guild.name === "string" ? guild.name.trim() : "") || "サーバー";
  const nation: Nation = {
    guildId: guild.id,
    name: Array.from(name).slice(0, 100).join(""),
    color: pickNationColor(state),
    kingKey: ownerKey,
    capital,
    createdAt: now,
  };
  const next: NationsState = {
    nations: { ...state.nations, [nation.guildId]: nation },
    members: { ...state.members, [ownerKey]: { nationId: nation.guildId, role: "king" } },
  };
  return { ok: true, state: next, nation };
}

export function applyJoin(
  state: NationsState,
  ownerKey: string,
  guildId: unknown,
  role: NationRole,
): NationActionResult {
  if (state.members[ownerKey]) return { ok: false, error: "already_in_nation" };
  if (typeof guildId !== "string" || !state.nations[guildId])
    return { ok: false, error: "nation_not_found" };
  const next: NationsState = {
    nations: state.nations,
    members: { ...state.members, [ownerKey]: { nationId: guildId, role } },
  };
  return { ok: true, state: next, nation: state.nations[guildId] };
}

export function applyLeave(state: NationsState, ownerKey: string): NationActionResult {
  const mine = state.members[ownerKey];
  if (!mine) return { ok: false, error: "not_in_nation" };
  const members = { ...state.members };
  if (mine.role === "king") {
    const othersRemain = Object.entries(members).some(
      ([key, m]) => key !== ownerKey && m.nationId === mine.nationId,
    );
    if (othersRemain) return { ok: false, error: "king_must_transfer_or_disband" };
    delete members[ownerKey];
    const nations = { ...state.nations };
    delete nations[mine.nationId];
    return { ok: true, state: { nations, members }, disbanded: true };
  }
  delete members[ownerKey];
  return { ok: true, state: { nations: state.nations, members }, disbanded: false };
}

export const FAST_TRAVEL_COST = 0;
export const FAST_TRAVEL_COOLDOWN_MS = 0;

export type FastTravelResult =
  | { ok: true; nationId: string; x: number; y: number }
  | { ok: false; error: string };

export function fastTravelDestination(
  state: NationsState,
  ownerKey: string,
  map: TopDownMap,
): FastTravelResult {
  const mine = state.members[ownerKey];
  if (!mine) return { ok: false, error: "not_in_nation" };
  const nation = state.nations[mine.nationId];
  if (!nation) return { ok: false, error: "not_in_nation" };
  const free = findFreeNear(map, nation.capital.x + 0.5, nation.capital.y + 0.5, undefined, {
    swim: true,
  });
  return { ok: true, nationId: nation.guildId, x: free.x, y: free.y };
}

export const PROSPERITY_PER_MEMBER = 5;

export function prosperityOf(state: NationsState, nationId: string): number {
  return PROSPERITY_PER_MEMBER * (memberCounts(state)[nationId] ?? 0);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function parseNation(raw: unknown): Nation | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const cap = v.capital as Record<string, unknown> | null;
  if (typeof v.guildId !== "string" || !/^\d+$/.test(v.guildId)) return null;
  if (typeof v.name !== "string" || v.name.length === 0) return null;
  if (typeof v.color !== "string" || !(NATION_PALETTE as readonly string[]).includes(v.color))
    return null;
  if (typeof v.kingKey !== "string" || v.kingKey.length === 0) return null;
  if (!cap || typeof cap.x !== "number" || typeof cap.y !== "number") return null;
  if (!Number.isFinite(cap.x) || !Number.isFinite(cap.y)) return null;
  const x = Math.floor(cap.x);
  const y = Math.floor(cap.y);
  if (Math.abs(x) > WORLD_COORD_LIMIT || Math.abs(y) > WORLD_COORD_LIMIT) return null;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return null;
  return {
    guildId: v.guildId,
    name: v.name,
    color: v.color,
    kingKey: v.kingKey,
    capital: { x, y },
    createdAt: v.createdAt,
  };
}

export function parseNationsState(rawNations: unknown, rawMembers: unknown): NationsState {
  const state = emptyNationsState();
  const wrapped = asRecord(rawNations);
  if (!wrapped || wrapped.v !== NATIONS_STATE_VERSION) return state;
  const nationsRaw = asRecord(wrapped.nations);
  if (nationsRaw) {
    for (const raw of Object.values(nationsRaw)) {
      const nation = parseNation(raw);
      if (nation) state.nations[nation.guildId] = nation;
    }
  }
  const membersRaw = asRecord(rawMembers);
  if (membersRaw) {
    for (const [ownerKey, raw] of Object.entries(membersRaw)) {
      if (!raw || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      if (typeof v.nationId !== "string" || !state.nations[v.nationId]) continue;
      if (v.role !== "king" && v.role !== "minister" && v.role !== "citizen") continue;
      state.members[ownerKey] = { nationId: v.nationId, role: v.role };
    }
  }
  return state;
}

export type NationView = {
  id: string;
  guildId: string;
  name: string;
  color: string;
  capital: { x: number; y: number };
  members: number;
  prosperity: number;
  kingId: string;
  createdAt: number;
};

export type MyGuildView = {
  guildId: string;
  name: string;
  owner: boolean;
  hasNation: boolean;
  myRole: NationRole;
};

export type NationsResponse = {
  nations: NationView[];
  me: { nationId: string; role: NationRole } | null;
  playerNations: Record<string, { nationId: string; color: string }>;
  loggedIn: boolean;
  myGuilds: MyGuildView[];
  guildsScopeRequired: boolean;
};

export function nationViews(state: NationsState): NationView[] {
  const counts = memberCounts(state);
  return Object.values(state.nations)
    .sort((a, b) => a.createdAt - b.createdAt || a.guildId.localeCompare(b.guildId))
    .map((n) => ({
      id: n.guildId,
      guildId: n.guildId,
      name: n.name,
      color: n.color,
      capital: { ...n.capital },
      members: counts[n.guildId] ?? 0,
      prosperity: prosperityOf(state, n.guildId),
      kingId: presenceIdFor(n.kingKey),
      createdAt: n.createdAt,
    }));
}

export function playerNationMap(
  state: NationsState,
): Record<string, { nationId: string; color: string }> {
  const out: Record<string, { nationId: string; color: string }> = {};
  for (const [ownerKey, m] of Object.entries(state.members)) {
    const nation = state.nations[m.nationId];
    if (nation) out[presenceIdFor(ownerKey)] = { nationId: nation.guildId, color: nation.color };
  }
  return out;
}

export function buildNationsResponse(
  state: NationsState,
  selfKey: string | null,
  extra: { myGuilds?: MyGuildView[]; guildsScopeRequired?: boolean } = {},
): NationsResponse {
  const mine = selfKey ? state.members[selfKey] : undefined;
  return {
    nations: nationViews(state),
    me: mine ? { nationId: mine.nationId, role: mine.role } : null,
    playerNations: playerNationMap(state),
    loggedIn: selfKey !== null,
    myGuilds: extra.myGuilds ?? [],
    guildsScopeRequired: extra.guildsScopeRequired ?? false,
  };
}
