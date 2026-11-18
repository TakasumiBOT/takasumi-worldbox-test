export type WinTier = 0 | 1 | 2 | 3 | 4;

export function winTier(payout: number, bet: number): WinTier {
  if (payout <= 0 || bet <= 0) return 0;
  const ratio = payout / bet;
  if (ratio >= 50) return 4;
  if (ratio >= 10) return 3;
  if (ratio >= 2) return 2;
  return 1;
}

export interface TierFx {
  confetti: number;
  countUpMs: number;
  flash: boolean;
  shake: boolean;
}

export function tierFx(tier: WinTier): TierFx {
  switch (tier) {
    case 1:
      return { confetti: 24, countUpMs: 500, flash: false, shake: false };
    case 2:
      return { confetti: 60, countUpMs: 900, flash: true, shake: false };
    case 3:
      return { confetti: 130, countUpMs: 1500, flash: true, shake: true };
    case 4:
      return { confetti: 240, countUpMs: 2400, flash: true, shake: true };
    default:
      return { confetti: 0, countUpMs: 0, flash: false, shake: false };
  }
}

export function countUpValue(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = 1 - Math.pow(1 - clamped, 3);
  return Math.round(from + (to - from) * eased);
}

export function isReach(reels: readonly number[]): boolean {
  return reels.length >= 2 && reels[0] === reels[1];
}

export function sevenHeat(reels: readonly (number | null)[]): number {
  return reels.filter((d) => d === 7).length;
}

export interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  delay: number;
  spin: number;
}

export const CONFETTI_COLORS = ["#ffd23e", "#ff7a7a", "#7ac7ff", "#9dff70", "#e8e8f0"] as const;

export function confettiParticles(count: number, rng: () => number): ConfettiParticle[] {
  const out: ConfettiParticle[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: 0.5 + (rng() - 0.5) * 0.5,
      y: 0.28 + (rng() - 0.5) * 0.08,
      vx: (rng() - 0.5) * 1.6,
      vy: -(0.9 + rng() * 1.1),
      size: 4 + rng() * 6,
      color: CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length) % CONFETTI_COLORS.length],
      delay: rng() * 0.25,
      spin: (rng() - 0.5) * 12,
    });
  }
  return out;
}
