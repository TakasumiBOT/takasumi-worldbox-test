import { isBotApiConfigured, kvDelete, kvGet, kvSet } from "../../bot-api";
import { parseMachineState, type MachineState } from "./machines";
import { tileKey } from "../world/tiles";

export const WORLDBOX_MACHINES_NAMESPACE = "worldbox_machines";

export function isMachinesEnabled(): boolean {
  return isBotApiConfigured();
}

export function machineKey(x: number, y: number): string {
  return `world|${tileKey(x, y)}`;
}

export async function loadMachine(x: number, y: number): Promise<MachineState | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const stored = await kvGet(WORLDBOX_MACHINES_NAMESPACE, machineKey(x, y));
    if (stored !== null) return parseMachineState(stored);
    return parseMachineState(await kvGet(WORLDBOX_MACHINES_NAMESPACE, tileKey(x, y)));
  } catch {
    return null;
  }
}

export async function storeMachine(x: number, y: number, state: MachineState): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_MACHINES_NAMESPACE, machineKey(x, y), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export async function deleteMachine(x: number, y: number): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_MACHINES_NAMESPACE, machineKey(x, y));
    await kvDelete(WORLDBOX_MACHINES_NAMESPACE, tileKey(x, y));
  } catch {
    /* noop */
  }
}
