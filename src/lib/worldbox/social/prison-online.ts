import { isBotApiConfigured, kvGet, kvList, kvSet } from "../../bot-api";
import {
  defaultPrisonRecord,
  isActivelyJailed,
  parsePrisonRecord,
  type PrisonRecord,
} from "./prison";

export const WORLDBOX_PRISON_NAMESPACE = "worldbox_prison";

export function isPrisonEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadPrisonRecord(
  ownerKey: string,
  fallbackName = "市民",
): Promise<PrisonRecord> {
  if (!isBotApiConfigured()) return defaultPrisonRecord(ownerKey, fallbackName);
  try {
    const raw = await kvGet(WORLDBOX_PRISON_NAMESPACE, `rec:${ownerKey}`);
    return parsePrisonRecord(raw, ownerKey, fallbackName);
  } catch {
    return defaultPrisonRecord(ownerKey, fallbackName);
  }
}

export async function storePrisonRecord(record: PrisonRecord): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_PRISON_NAMESPACE, `rec:${record.ownerKey}`, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export async function listAllPrisonRecords(): Promise<PrisonRecord[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const rows = await kvList(WORLDBOX_PRISON_NAMESPACE);
    const out: PrisonRecord[] = [];
    for (const [key, raw] of rows) {
      if (!key.startsWith("rec:")) continue;
      const ownerKey = key.slice(4);
      out.push(parsePrisonRecord(raw, ownerKey));
    }
    return out;
  } catch {
    return [];
  }
}

export async function listActivePrisonSummary(now: number): Promise<{
  inmates: PrisonRecord[];
  wanted: PrisonRecord[];
}> {
  const all = await listAllPrisonRecords();
  const inmates = all
    .filter((r) => isActivelyJailed(r, now))
    .sort((a, b) => a.releaseAt - b.releaseAt);
  const wanted = all
    .filter((r) => !isActivelyJailed(r, now) && r.wantedLevel > 0)
    .sort((a, b) => b.wantedLevel - a.wantedLevel || b.bounty - a.bounty);
  return { inmates, wanted };
}
