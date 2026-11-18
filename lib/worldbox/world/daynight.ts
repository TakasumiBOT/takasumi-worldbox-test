export const DAY_CYCLE_SEC = 240;

export function phaseAtTime(unixSec: number): number {
  const t = (unixSec / DAY_CYCLE_SEC) % 1;
  return t < 0 ? t + 1 : t;
}

export function nightAmount(t: number): number {
  if (t < 0.18 || t > 0.9) return 1;
  if (t > 0.24 && t < 0.8) return 0;
  if (t <= 0.24) return 1 - (t - 0.18) / 0.06;
  return (t - 0.8) / 0.1;
}

export function isNightPhase(t: number): boolean {
  return nightAmount(t) > 0.5;
}
