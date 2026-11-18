import { cropById } from "./items";
import type { TileOverride } from "../world/tiles";

export const MACHINE_ITEM_ID = "auto_harvester";
export function isMachineItem(itemId: string): boolean {
  return itemId === MACHINE_ITEM_ID;
}

export type DeviceTrigger = "mature";
export type DeviceAction = "harvest";

export interface DeviceProgram {
  version: 1;
  trigger: DeviceTrigger;
  action: DeviceAction;
  intervalSec: number;
  enabled: boolean;
}

export const DEVICE_INTERVAL_CHOICES: readonly number[] = [30, 60, 300];

export function defaultProgram(): DeviceProgram {
  return { version: 1, trigger: "mature", action: "harvest", intervalSec: 60, enabled: true };
}

export function parseProgram(raw: unknown): DeviceProgram {
  const base = defaultProgram();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const v = raw as Record<string, unknown>;
  return {
    version: 1,
    trigger: "mature",
    action: "harvest",
    intervalSec: DEVICE_INTERVAL_CHOICES.includes(v.intervalSec as number)
      ? (v.intervalSec as number)
      : base.intervalSec,
    enabled: v.enabled !== false,
  };
}

export function encodeProgram(program: DeviceProgram): string {
  const json = JSON.stringify(parseProgram(program));
  return "WB1." + Buffer.from(json, "utf8").toString("base64url");
}

export function decodeProgram(code: unknown): DeviceProgram | null {
  if (typeof code !== "string" || !code.startsWith("WB1.")) return null;
  try {
    const raw = JSON.parse(Buffer.from(code.slice(4), "base64url").toString("utf8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    return parseProgram(raw);
  } catch {
    return null;
  }
}

export const DEVICE_PRESETS: readonly { id: string; name: string; program: DeviceProgram }[] = [
  { id: "standard", name: "標準収穫", program: defaultProgram() },
  { id: "swift", name: "こまめ収穫", program: { ...defaultProgram(), intervalSec: 30 } },
  { id: "eco", name: "のんびり収穫", program: { ...defaultProgram(), intervalSec: 300 } },
];

export interface MachineState {
  ownerId: string;
  program: DeviceProgram;
  buffer: Record<string, number>;
  lastEvalAt: number;
  updatedAt: number;
}

export function parseMachineState(raw: unknown): MachineState | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const v = data as Record<string, unknown>;
  if (typeof v.ownerId !== "string" || v.ownerId.length === 0) return null;
  const buffer: Record<string, number> = {};
  if (v.buffer && typeof v.buffer === "object" && !Array.isArray(v.buffer)) {
    for (const [itemId, count] of Object.entries(v.buffer as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        buffer[itemId] = Math.floor(count);
      }
    }
  }
  return {
    ownerId: v.ownerId,
    program: parseProgram(v.program),
    buffer,
    lastEvalAt:
      typeof v.lastEvalAt === "number" && Number.isFinite(v.lastEvalAt) ? v.lastEvalAt : 0,
    updatedAt: typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
  };
}

export function machineBufferCount(state: MachineState): number {
  return Object.values(state.buffer).reduce((sum, n) => sum + n, 0);
}

export interface MachineEvalResult {
  state: MachineState;
  changed: Map<string, TileOverride>;
  harvested: number;
  evaluated: boolean;
}

export function evaluateMachine(
  state: MachineState,
  neighbors: ReadonlyMap<string, TileOverride>,
  now: number,
): MachineEvalResult {
  const unchanged: MachineEvalResult = {
    state,
    changed: new Map(),
    harvested: 0,
    evaluated: false,
  };
  if (!state.program.enabled) return unchanged;
  if (now - state.lastEvalAt < state.program.intervalSec * 1000) return unchanged;
  const buffer = { ...state.buffer };
  const changed = new Map<string, TileOverride>();
  let harvested = 0;
  for (const [key, ov] of neighbors) {
    if (!ov.crop || ov.ownerId !== state.ownerId) continue;
    if (ov.crop.readyAt > now) continue;
    const crop = cropById(ov.crop.cropId);
    if (!crop) continue;
    buffer[crop.produceId] = (buffer[crop.produceId] ?? 0) + crop.produceCount;
    harvested += crop.produceCount;
    changed.set(key, { ...ov, crop: null });
  }
  return {
    state: { ...state, buffer, lastEvalAt: now, updatedAt: now },
    changed,
    harvested,
    evaluated: true,
  };
}
