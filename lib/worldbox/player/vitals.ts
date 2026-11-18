import { ITEMS, itemById } from "../economy/items";
import { HUNGER_MAX, type PlayerProfile, type StatusEffect } from "./profile";

export type HungerActivity = "idle" | "move" | "dash";
export const HUNGER_DRAIN_IDLE_PER_SEC = 100 / 14400;
export const HUNGER_MOVE_MULT = 1.6;
export const HUNGER_DASH_MULT = 2.5;

export function hungerDrainPerSec(activity: HungerActivity): number {
  if (activity === "dash") return HUNGER_DRAIN_IDLE_PER_SEC * HUNGER_DASH_MULT;
  if (activity === "move") return HUNGER_DRAIN_IDLE_PER_SEC * HUNGER_MOVE_MULT;
  return HUNGER_DRAIN_IDLE_PER_SEC;
}

export const ACTIVITY_SPEED_CAP = 7;
export const ACTIVITY_IDLE_MAX_SPEED = 0.3;
export const ACTIVITY_DASH_MIN_SPEED = 5.6;

export function classifyActivity(avgSpeed: number): HungerActivity {
  if (!Number.isFinite(avgSpeed)) return "idle";
  const s = Math.min(Math.max(0, avgSpeed), ACTIVITY_SPEED_CAP);
  if (s < ACTIVITY_IDLE_MAX_SPEED) return "idle";
  if (s < ACTIVITY_DASH_MIN_SPEED) return "move";
  return "dash";
}

export function activityForWindow(
  prev: { x: number; y: number; space: string } | null,
  cur: { x: number; y: number; space: string } | null,
  elapsedSec: number,
): HungerActivity {
  if (!prev || !cur || prev.space !== cur.space || !(elapsedSec > 0)) return "idle";
  return classifyActivity(Math.hypot(cur.x - prev.x, cur.y - prev.y) / elapsedSec);
}
export const VITAL_SETTLE_CAP_MS = 30 * 60 * 1000;

function statusOf(profile: PlayerProfile): StatusEffect[] {
  return Array.isArray(profile.status) ? profile.status : [];
}

function buffDurationFromCatalog(kind: "warm", fallbackMinutes: number): number {
  const def = ITEMS.find((i) => i.buff?.kind === kind);
  return (def?.buff?.minutes ?? fallbackMinutes) * 60 * 1000;
}
export const BUFF_DURATION_MS: Record<"warm", number> = {
  warm: buffDurationFromCatalog("warm", 10),
};
export const WARM_HUNGER_MULT = 0.6;

export function applyBuff(profile: PlayerProfile, kind: "warm", now: number): PlayerProfile {
  const status = statusOf(profile).filter((e) => e.kind !== kind);
  status.push({ kind, until: now + BUFF_DURATION_MS[kind] });
  return { ...profile, status };
}

function buffWindowSec(
  profile: PlayerProfile,
  kind: "warm",
  windowEnd: number,
): { startSec: number; endSec: number } | null {
  const e = statusOf(profile).find((x) => x.kind === kind);
  if (!e) return null;
  const start = Math.max(profile.vitalAt, e.until - BUFF_DURATION_MS[kind]);
  const end = Math.min(e.until, windowEnd);
  if (end <= start) return null;
  return { startSec: (start - profile.vitalAt) / 1000, endSec: (end - profile.vitalAt) / 1000 };
}

export function stepVitals(
  profile: PlayerProfile,
  now: number,
  activity: HungerActivity = "idle",
): { profile: PlayerProfile } {
  if (profile.vitalAt <= 0 || now <= profile.vitalAt) {
    return { profile: { ...profile, vitalAt: now } };
  }
  const elapsedMs = Math.min(now - profile.vitalAt, VITAL_SETTLE_CAP_MS);
  const elapsedSec = elapsedMs / 1000;
  const windowEnd = profile.vitalAt + elapsedMs;
  const rate = hungerDrainPerSec(activity);
  const warmWin = buffWindowSec(profile, "warm", windowEnd);
  const warmSec = warmWin ? warmWin.endSec - warmWin.startSec : 0;
  const drainSec = elapsedSec - warmSec + warmSec * WARM_HUNGER_MULT;
  const hunger = Math.max(0, profile.hunger - rate * drainSec);
  const status = statusOf(profile).filter((e) => e.until > now);
  return {
    profile: { ...profile, hunger: Math.round(hunger * 1000) / 1000, status, vitalAt: now },
  };
}

export function consumeEffect(
  profile: PlayerProfile,
  itemId: string,
  now: number = Date.now(),
): { profile: PlayerProfile; hungerGain: number } | null {
  const item = itemById(itemId);
  if (!item || (!item.hunger && !item.buff)) return null;
  let next = profile;
  const hungerGain = item.hunger
    ? Math.min(HUNGER_MAX, next.hunger + item.hunger) - next.hunger
    : 0;
  next = { ...next, hunger: next.hunger + hungerGain };
  if (item.buff) next = applyBuff(next, item.buff.kind, now);
  return { profile: next, hungerGain };
}
