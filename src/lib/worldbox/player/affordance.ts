export const AFFORDANCE_RANGE_TILES = 2;
export const AFFORDANCE_PULSE_DIVISOR = 240;
export const AFFORDANCE_PULSE_BASE = 0.35;
export const AFFORDANCE_PULSE_AMP = 0.25;
export const AFFORDANCE_NUDGE_MS = 900;
export const AFFORDANCE_NUDGE_ALPHA_MAX = 0.85;
export const AFFORDANCE_NUDGE_BOB_PX = 4;
export const DENIED_MS = 260;
export const DENIED_ALPHA_MAX = 0.9;
export const DENIED_SHAKE_PX = 2.5;
export const STICK_KNOB_RADIUS = 22;
export const STICK_KNOB_RADIUS_ACTIVE = 26;
export const AFFORDANCE_RING_RGB = "255,210,62";
export const DENIED_RING_RGB = "226,72,58";

export function affordancePulseAlpha(nowMs: number): number {
  const a =
    AFFORDANCE_PULSE_BASE + AFFORDANCE_PULSE_AMP * Math.sin(nowMs / AFFORDANCE_PULSE_DIVISOR);
  return Math.max(0.1, Math.min(0.6, a));
}

export function isWithinAffordanceRange(
  px: number,
  py: number,
  ox: number,
  oy: number,
  w: number,
  h: number,
  range: number = AFFORDANCE_RANGE_TILES,
): boolean {
  const dx = px < ox ? ox - px : px > ox + w ? px - (ox + w) : 0;
  const dy = py < oy ? oy - py : py > oy + h ? py - (oy + h) : 0;
  return Math.max(dx, dy) <= range;
}

export function nudgeProgress(ageMs: number): number {
  if (ageMs <= 0) return 0;
  if (ageMs >= AFFORDANCE_NUDGE_MS) return 1;
  return ageMs / AFFORDANCE_NUDGE_MS;
}

export function nudgeBobPx(ageMs: number): number {
  const p = nudgeProgress(ageMs);
  if (p >= 1) return 0;
  const v = -AFFORDANCE_NUDGE_BOB_PX * Math.sin(p * Math.PI * 2) * (1 - p);
  return v === 0 ? 0 : v;
}

export function nudgeRingAlpha(nowMs: number, ageMs: number): number {
  const p = nudgeProgress(ageMs);
  if (p >= 1) return affordancePulseAlpha(nowMs);
  return Math.min(AFFORDANCE_NUDGE_ALPHA_MAX, affordancePulseAlpha(nowMs) + 0.25 * (1 - p));
}

export function deniedActive(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < DENIED_MS;
}

export function deniedFeedback(ageMs: number): { alpha: number; dx: number } | null {
  if (!deniedActive(ageMs)) return null;
  const remain = 1 - ageMs / DENIED_MS;
  return {
    alpha: DENIED_ALPHA_MAX * remain,
    dx: DENIED_SHAKE_PX * remain * Math.sin(ageMs / 24),
  };
}

export function stickKnobRadius(active: boolean): number {
  return active ? STICK_KNOB_RADIUS_ACTIVE : STICK_KNOB_RADIUS;
}
