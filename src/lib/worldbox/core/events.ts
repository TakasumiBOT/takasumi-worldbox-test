export type WorldEventKind = "seasonal" | "limited_dungeon";

export interface WorldEventDef {
  id: string;
  name: string;
  kind: WorldEventKind;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}

export const EVENT_DUNGEON_ENTRANCE = { x: -9999, y: -9999 };

export const WORLD_EVENTS: readonly WorldEventDef[] = [
  {
    id: "stardust_festival",
    name: "星屑祭り",
    kind: "seasonal",
    startMonth: 12,
    startDay: 20,
    endMonth: 1,
    endDay: 5,
  },
  {
    id: "stardust_ruins",
    name: "星屑の旧市街",
    kind: "limited_dungeon",
    startMonth: 12,
    startDay: 20,
    endMonth: 1,
    endDay: 5,
  },
];

export function isEventActive(def: WorldEventDef, now: number): boolean {
  const d = new Date(now);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const cur = month * 100 + day;
  const start = def.startMonth * 100 + def.startDay;
  const end = def.endMonth * 100 + def.endDay;
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end;
}

export function activeEvents(now: number): WorldEventDef[] {
  return WORLD_EVENTS.filter((def) => isEventActive(def, now));
}

export function activeLimitedDungeon(now: number): WorldEventDef | null {
  return (
    WORLD_EVENTS.find((def) => def.kind === "limited_dungeon" && isEventActive(def, now)) ?? null
  );
}

export function isEventDungeonEntrance(x: number, y: number): boolean {
  return x === EVENT_DUNGEON_ENTRANCE.x && y === EVENT_DUNGEON_ENTRANCE.y;
}

export function eventDaysLeft(def: WorldEventDef, now: number): number {
  if (!isEventActive(def, now)) return -1;
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const start = def.startMonth * 100 + def.startDay;
  const end = def.endMonth * 100 + def.endDay;
  const cur = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const endYear = start <= end || cur <= end ? year : year + 1;
  const endDate = Date.UTC(endYear, def.endMonth - 1, def.endDay);
  const today = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());
  return Math.round((endDate - today) / 86_400_000);
}
