export interface DayMetrics {
  date: string;
  dau: string[];
  peak: number;
  blocksPlaced: number;
  harvests: number;
  chatsNear: number;
  chatsGlobal: number;
  chatsUnion: number;
  guildShopVolume: number;
  unionMembers: number;
}

export interface UserFirstSteps {
  firstAt: number;
  gatherAt?: number;
  placeAt?: number;
  lobbyAt?: number;
}

export const METRICS_DAU_CAP = 2000;
export const FUNNEL_WINDOW_MS = 5 * 60 * 1000;

export function emptyDayMetrics(date: string): DayMetrics {
  return {
    date,
    dau: [],
    peak: 0,
    blocksPlaced: 0,
    harvests: 0,
    chatsNear: 0,
    chatsGlobal: 0,
    chatsUnion: 0,
    guildShopVolume: 0,
    unionMembers: 0,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function parseDayMetrics(raw: unknown, date: string): DayMetrics {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyDayMetrics(date);
    }
  }
  const out = emptyDayMetrics(date);
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  const v = data as Record<string, unknown>;
  if (Array.isArray(v.dau)) {
    out.dau = v.dau.filter((k): k is string => typeof k === "string").slice(0, METRICS_DAU_CAP);
  }
  out.peak = num(v.peak);
  out.blocksPlaced = num(v.blocksPlaced);
  out.harvests = num(v.harvests);
  out.chatsNear = num(v.chatsNear);
  out.chatsGlobal = num(v.chatsGlobal);
  out.chatsUnion = num(v.chatsUnion);
  out.guildShopVolume = num(v.guildShopVolume);
  out.unionMembers = num(v.unionMembers);
  return out;
}

export function parseUserFirstSteps(raw: unknown): UserFirstSteps | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data as Record<string, unknown>;
  if (typeof v.firstAt !== "number" || !Number.isFinite(v.firstAt) || v.firstAt <= 0) return null;
  const out: UserFirstSteps = { firstAt: Math.floor(v.firstAt) };
  for (const key of ["gatherAt", "placeAt", "lobbyAt"] as const) {
    if (typeof v[key] === "number" && Number.isFinite(v[key]) && (v[key] as number) > 0) {
      out[key] = Math.floor(v[key] as number);
    }
  }
  return out;
}

export function dayKeyOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function funnelRates(users: readonly UserFirstSteps[]): {
  users: number;
  gather: number;
  place: number;
  lobby: number;
} {
  const n = users.length;
  if (n === 0) return { users: 0, gather: 0, place: 0, lobby: 0 };
  const within = (at?: number, base = 0) =>
    at !== undefined && at - base <= FUNNEL_WINDOW_MS ? 1 : 0;
  let gather = 0,
    place = 0,
    lobby = 0;
  for (const u of users) {
    gather += within(u.gatherAt, u.firstAt);
    place += within(u.placeAt, u.firstAt);
    lobby += within(u.lobbyAt, u.firstAt);
  }
  return { users: n, gather: gather / n, place: place / n, lobby: lobby / n };
}

export function retentionRate(dayA: DayMetrics, dayB: DayMetrics): number | null {
  if (dayA.dau.length === 0) return null;
  const setB = new Set(dayB.dau);
  const kept = dayA.dau.filter((k) => setB.has(k)).length;
  return kept / dayA.dau.length;
}
