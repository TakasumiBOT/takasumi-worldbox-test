export const STAMINA_MAX = 100;
export const DASH_DRAIN_PER_SEC = 22;
export const SWIM_DRAIN_PER_SEC = 7;
export const SWIM_DASH_DRAIN_PER_SEC = 26;
export const STAMINA_REGEN_PER_SEC = 16;
export const STAMINA_REGEN_DELAY_SEC = 0.8;
export const DASH_RELOCK_STAMINA = 30;
export const SWIM_RESCUE_STAMINA = 20;
export const STAMINA_GAUGE_HOLD_SEC = 1.6;
export const STICK_DASH_THRESHOLD = 0.85;
export const DOUBLE_TAP_MS = 300;

export type StaminaUse = "none" | "dash" | "swim" | "swimDash";

export type StaminaState = {
  value: number;
  exhausted: boolean;
  idleSec: number;
};

export function createStamina(): StaminaState {
  return { value: STAMINA_MAX, exhausted: false, idleSec: STAMINA_GAUGE_HOLD_SEC };
}

export function staminaDrainRate(use: StaminaUse): number {
  switch (use) {
    case "dash":
      return DASH_DRAIN_PER_SEC;
    case "swim":
      return SWIM_DRAIN_PER_SEC;
    case "swimDash":
      return SWIM_DASH_DRAIN_PER_SEC;
    default:
      return 0;
  }
}

export function canDash(s: StaminaState): boolean {
  return s.value > 0 && !s.exhausted;
}

export function stepStamina(
  s: StaminaState,
  use: StaminaUse,
  dt: number,
): { state: StaminaState; emptied: boolean } {
  const step = Math.max(0, dt);
  const rate = staminaDrainRate(use);
  if (rate > 0) {
    const value = Math.max(0, s.value - rate * step);
    const emptied = value <= 0 && s.value > 0;
    return {
      state: { value, exhausted: s.exhausted || emptied, idleSec: 0 },
      emptied,
    };
  }
  const idleBefore = s.idleSec;
  const idleSec = idleBefore + step;
  const regenTime =
    Math.max(0, idleSec - STAMINA_REGEN_DELAY_SEC) -
    Math.max(0, idleBefore - STAMINA_REGEN_DELAY_SEC);
  const value = Math.min(STAMINA_MAX, s.value + STAMINA_REGEN_PER_SEC * regenTime);
  return {
    state: { value, exhausted: s.exhausted && value < DASH_RELOCK_STAMINA, idleSec },
    emptied: false,
  };
}

export function rescueStamina(s: StaminaState): StaminaState {
  return { value: Math.max(s.value, SWIM_RESCUE_STAMINA), exhausted: true, idleSec: 0 };
}

export function staminaGaugeVisible(s: StaminaState): boolean {
  return s.value < STAMINA_MAX || s.idleSec < STAMINA_GAUGE_HOLD_SEC;
}

export function isStickDash(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > STICK_DASH_THRESHOLD;
}

export type TapTracker = {
  key: string | null;
  at: number;
};

export function createTapTracker(): TapTracker {
  return { key: null, at: 0 };
}

export function registerKeyTap(
  t: TapTracker,
  key: string,
  nowMs: number,
): { tracker: TapTracker; doubleTapped: boolean } {
  const doubleTapped = t.key === key && nowMs >= t.at && nowMs - t.at <= DOUBLE_TAP_MS;
  return { tracker: { key, at: nowMs }, doubleTapped };
}
