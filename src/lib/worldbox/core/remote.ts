import { predictPosition, type CoordBounds, type PresenceEntry } from "../player/presence";

export const REMOTE_SNAP_DISTANCE = 8;
export const REMOTE_SMOOTH_TIME_SEC = 0.16;

export type RemoteTrack = {
  entry: PresenceEntry;
  rx: number;
  ry: number;
  rvx: number;
  rvy: number;
};

type Bounds = CoordBounds;

export function createRemoteTrack(entry: PresenceEntry, now: number, bounds: Bounds): RemoteTrack {
  const p = predictPosition(entry, now, bounds);
  return { entry, rx: p.x, ry: p.y, rvx: entry.vx, rvy: entry.vy };
}

export function updateRemoteTrack(
  track: RemoteTrack,
  entry: PresenceEntry,
  now: number,
  bounds: Bounds,
): RemoteTrack {
  const p = predictPosition(entry, now, bounds);
  if (Math.hypot(p.x - track.rx, p.y - track.ry) > REMOTE_SNAP_DISTANCE) {
    return { entry, rx: p.x, ry: p.y, rvx: entry.vx, rvy: entry.vy };
  }
  return { ...track, entry };
}

function smoothDampAxis(
  current: number,
  target: number,
  vel: number,
  smoothTime: number,
  dt: number,
): { x: number; v: number } {
  if (dt <= 0) return { x: current, v: vel };
  const omega = 2 / Math.max(0.01, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel + omega * change) * dt;
  const v = (vel - omega * temp) * exp;
  return { x: target + (change + temp) * exp, v };
}

export function stepRemoteTrack(
  track: RemoteTrack,
  now: number,
  dt: number,
  bounds: Bounds,
): RemoteTrack {
  const target = predictPosition(track.entry, now, bounds);
  const ax = smoothDampAxis(track.rx, target.x, track.rvx, REMOTE_SMOOTH_TIME_SEC, dt);
  const ay = smoothDampAxis(track.ry, target.y, track.rvy, REMOTE_SMOOTH_TIME_SEC, dt);
  return { entry: track.entry, rx: ax.x, ry: ay.x, rvx: ax.v, rvy: ay.v };
}
