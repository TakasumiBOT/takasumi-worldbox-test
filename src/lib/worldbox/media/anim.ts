export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

export function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

export function damp(current: number, target: number, rate: number, dt: number): number {
  if (dt <= 0) return current;
  return target + (current - target) * Math.exp(-rate * dt);
}

export const WALK_PHASE_PER_TILE = 2.6;

export function advanceWalkPhase(phase: number, speed: number, dt: number): number {
  return phase + Math.abs(speed) * WALK_PHASE_PER_TILE * Math.max(0, dt);
}

export function stepBeatIndex(phase: number): number {
  return Math.floor(phase / Math.PI);
}

export function walkBob(phase: number): number {
  return Math.abs(Math.sin(phase));
}

export function walkSquashY(phase: number): number {
  return 1 - 0.055 * Math.abs(Math.sin(phase));
}

export function moveLean(speedRatio: number): number {
  return clamp(speedRatio, -1, 1) * 0.09;
}

export function airPose(vy: number, forwardRatio: number): { scaleY: number; tilt: number } {
  const f = clamp(forwardRatio, -1, 1);
  if (vy < 0) {
    const k = Math.min(1, -vy / 12);
    return { scaleY: 1 + 0.07 * k, tilt: f * 0.04 * k };
  }
  const k = Math.min(1, vy / 19);
  return { scaleY: 1 + 0.11 * k, tilt: f * 0.12 * k };
}

export type SpringState = { x: number; v: number };

export function springStep(
  s: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): SpringState {
  if (dt <= 0) return { x: s.x, v: s.v };
  const v = (s.v + (target - s.x) * stiffness * dt) * Math.exp(-damping * dt);
  return { x: s.x + v * dt, v };
}

export function landingSquashY(fallTiles: number): number {
  const depth = Math.min(0.16, Math.max(0, fallTiles - 0.4) * 0.024);
  return 1 - depth;
}

export const SWING_WINDUP = -0.95;
export const SWING_STRIKE = 0.62;
export const ARM_REST_ANGLE = 0.45;
export const DIG_STAGES = 4;

export function digSwingAngle(progress: number): number {
  const p = clamp01(progress);
  const seg = Math.min(DIG_STAGES - 1, Math.floor(p * DIG_STAGES));
  const local = p * DIG_STAGES - seg;
  const e = Math.pow(local, 1.7);
  return SWING_WINDUP + (SWING_STRIKE - SWING_WINDUP) * e;
}

export function attackSwingAngle(t: number): number {
  const x = clamp01(t);
  if (x < 0.3) return ARM_REST_ANGLE + (SWING_WINDUP - ARM_REST_ANGLE) * smoothstep(x / 0.3);
  if (x < 0.55) {
    const k = (x - 0.3) / 0.25;
    return SWING_WINDUP + (SWING_STRIKE - SWING_WINDUP) * (1 - Math.pow(1 - k, 3));
  }
  return SWING_STRIKE + (ARM_REST_ANGLE - SWING_STRIKE) * smoothstep((x - 0.55) / 0.45);
}

export function flickerNoise(t: number, seed: number): number {
  const a = Math.sin(t * 11.3 + seed * 12.9898);
  const b = Math.sin(t * 23.7 + seed * 78.233);
  const c = Math.sin(t * 5.1 + seed * 37.719);
  return 0.5 + (a * 0.5 + b * 0.3 + c * 0.2) / 2;
}

export function torchFlameScale(t: number, seed: number): number {
  return 0.88 + 0.24 * flickerNoise(t, seed);
}

export function torchLightFlicker(t: number, seed: number): number {
  return 0.95 + 0.1 * flickerNoise(t, seed);
}

export function magnetStep(
  x: number,
  y: number,
  tx: number,
  ty: number,
  maxStep: number,
): { x: number; y: number; dist: number } {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || maxStep <= 0) return { x, y, dist: d };
  if (d <= maxStep) return { x: tx, y: ty, dist: 0 };
  return { x: x + (dx / d) * maxStep, y: y + (dy / d) * maxStep, dist: d - maxStep };
}

export function poofPose(k: number): { scale: number; alpha: number } {
  const c = clamp01(k);
  return { scale: 1 + 0.7 * easeOutCubic(c), alpha: 1 - c };
}

export function flipDeathPose(k: number): { rot: number; alpha: number } {
  const c = clamp01(k);
  return { rot: Math.PI * (1 - Math.pow(1 - c, 2)), alpha: 1 - c * c };
}

export function respawnPose(k: number): { scale: number; alpha: number } {
  const c = clamp01(k);
  return { scale: 0.65 + 0.35 * easeOutCubic(c), alpha: Math.min(1, c * 1.6) };
}

export function advanceEnemyPhase(phase: number, speed: number, dt: number): number {
  return phase + Math.abs(speed) * 3.4 * Math.max(0, dt);
}

export function enemyRock(speed: number, phase: number): number {
  return Math.sin(phase) * 0.07 * clamp01(Math.abs(speed) / 1.7);
}

export function telegraphSquashY(k: number): number {
  return 1 - 0.22 * smoothstep(k);
}
