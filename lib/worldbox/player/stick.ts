export const STICK_RADIUS = 52;
export const STICK_CENTER_OFFSET = 78;
export const STICK_HIT_RADIUS = 68;

export function stickBase(width: number, height: number): { x: number; y: number } {
  return { x: STICK_CENTER_OFFSET, y: Math.max(STICK_CENTER_OFFSET, height - STICK_CENTER_OFFSET) };
}

export function isStickTouch(x: number, y: number, base: { x: number; y: number }): boolean {
  return Math.hypot(x - base.x, y - base.y) <= STICK_HIT_RADIUS;
}

export function stickVector(
  x: number,
  y: number,
  base: { x: number; y: number },
): { dx: number; dy: number } {
  let dx = (x - base.x) / STICK_RADIUS;
  let dy = (y - base.y) / STICK_RADIUS;
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  return { dx, dy };
}
