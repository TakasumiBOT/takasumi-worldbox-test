import { isBotApiConfigured, kvDelete, kvGet, kvSet } from "../../bot-api";

export const WORLDBOX_INSTANCES_NAMESPACE = "worldbox_instances";

export type InstanceState = {
  veins: Record<string, number>;
  chest: number;
};

export function parseInstanceState(raw: unknown): InstanceState {
  const empty: InstanceState = { veins: {}, chest: 0 };
  if (typeof raw !== "string" || raw === "") return empty;
  try {
    const v = JSON.parse(raw) as { veins?: unknown; chest?: unknown };
    const veins: Record<string, number> = {};
    if (v.veins && typeof v.veins === "object") {
      for (const [k, val] of Object.entries(v.veins as Record<string, unknown>)) {
        if (typeof val === "number" && Number.isFinite(val)) veins[k] = val;
      }
    }
    return { veins, chest: typeof v.chest === "number" && Number.isFinite(v.chest) ? v.chest : 0 };
  } catch {
    return empty;
  }
}

export async function loadInstanceState(space: string): Promise<InstanceState> {
  if (!isBotApiConfigured()) return { veins: {}, chest: 0 };
  try {
    return parseInstanceState(await kvGet(WORLDBOX_INSTANCES_NAMESPACE, space));
  } catch {
    return { veins: {}, chest: 0 };
  }
}

export async function storeInstanceState(space: string, state: InstanceState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_INSTANCES_NAMESPACE, space, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function isInstancesEnabled(): boolean {
  return isBotApiConfigured();
}

export type RuinsPersonalState = {
  week: string;
  chests: Record<string, boolean>;
  traps: Record<string, boolean>;
  doors: Record<string, boolean>;
  completed: boolean;
};

export function emptyRuinsPersonal(week: string): RuinsPersonalState {
  return { week, chests: {}, traps: {}, doors: {}, completed: false };
}

export function parseRuinsPersonal(raw: unknown, week: string): RuinsPersonalState {
  const base = emptyRuinsPersonal(week);
  if (typeof raw !== "string" || raw === "") return base;
  try {
    const v = JSON.parse(raw) as Partial<RuinsPersonalState>;
    const completed = v.completed === true;
    if (v.week !== week) return { ...base, completed };
    const boolMap = (m: unknown): Record<string, boolean> => {
      const out: Record<string, boolean> = {};
      if (m && typeof m === "object") {
        for (const [k, val] of Object.entries(m as Record<string, unknown>))
          if (val === true) out[k] = true;
      }
      return out;
    };
    return {
      week,
      chests: boolMap(v.chests),
      traps: boolMap(v.traps),
      doors: boolMap(v.doors),
      completed,
    };
  } catch {
    return base;
  }
}

function ruinsKey(space: string, ownerKey: string): string {
  return `${space}#${ownerKey}`;
}

export async function loadRuinsPersonal(
  space: string,
  ownerKey: string,
  week: string,
): Promise<RuinsPersonalState> {
  if (!isBotApiConfigured()) return emptyRuinsPersonal(week);
  try {
    return parseRuinsPersonal(
      await kvGet(WORLDBOX_INSTANCES_NAMESPACE, ruinsKey(space, ownerKey)),
      week,
    );
  } catch {
    return emptyRuinsPersonal(week);
  }
}

export async function storeRuinsPersonal(
  space: string,
  ownerKey: string,
  state: RuinsPersonalState,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_INSTANCES_NAMESPACE, ruinsKey(space, ownerKey), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export type DungeonSession = {
  partyKey: string;
  entrance: { x: number; y: number };
  size: number;
  members: string[];
  departed: string[];
  chests: Record<string, number>;
  startedAt: number;
};

export function dungeonSessionKey(spaceFloor1: string, partyKey: string): string {
  return `${spaceFloor1}#${partyKey}`;
}

function parseDungeonSession(raw: unknown, partyKey: string): DungeonSession | null {
  let data: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (raw && typeof raw === "object") {
    data = raw as Record<string, unknown>;
  }
  if (!data) return null;
  const entrance = data.entrance as { x?: unknown; y?: unknown } | null;
  if (!entrance || typeof entrance.x !== "number" || typeof entrance.y !== "number") return null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  const chests: Record<string, number> = {};
  if (data.chests && typeof data.chests === "object" && !Array.isArray(data.chests)) {
    for (const [k, v] of Object.entries(data.chests as Record<string, unknown>)) {
      if (typeof v === "number") chests[k] = v;
    }
  }
  return {
    partyKey,
    entrance: { x: entrance.x, y: entrance.y },
    size: typeof data.size === "number" ? Math.max(1, Math.min(4, Math.floor(data.size))) : 1,
    members: strList(data.members),
    departed: strList(data.departed),
    chests,
    startedAt: typeof data.startedAt === "number" ? data.startedAt : 0,
  };
}

export async function loadDungeonSession(
  spaceFloor1: string,
  partyKey: string,
): Promise<DungeonSession | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_INSTANCES_NAMESPACE, dungeonSessionKey(spaceFloor1, partyKey));
    return parseDungeonSession(raw, partyKey);
  } catch {
    return null;
  }
}

export async function storeDungeonSession(
  spaceFloor1: string,
  session: DungeonSession,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(
      WORLDBOX_INSTANCES_NAMESPACE,
      dungeonSessionKey(spaceFloor1, session.partyKey),
      JSON.stringify(session),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteDungeonSession(spaceFloor1: string, partyKey: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_INSTANCES_NAMESPACE, dungeonSessionKey(spaceFloor1, partyKey));
  } catch {
    /* ベストエフォート */
  }
}

export function dungeonSessionClosed(session: DungeonSession): boolean {
  return session.members.every((m) => session.departed.includes(m));
}

export async function loadDungeonClearWeek(ownerKey: string): Promise<string | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_INSTANCES_NAMESPACE, `dungeonclear:${ownerKey}`);
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const v = (raw as { week?: unknown }).week;
      return typeof v === "string" ? v : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function storeDungeonClearWeek(ownerKey: string, week: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvSet(WORLDBOX_INSTANCES_NAMESPACE, `dungeonclear:${ownerKey}`, JSON.stringify({ week }));
  } catch {
    /* ベストエフォート */
  }
}
