import { isBotApiConfigured, kvDelete, kvGet, kvList, kvSet } from "../../bot-api";
import {
  PRESENCE_FRESH_MS,
  isFreshPresence,
  parsePresenceEntry,
  presenceIdFor,
  tabVerdict,
  type Heartbeat,
  type PresenceEntry,
} from "./presence";

export const WORLDBOX_PRESENCE_NAMESPACE = "worldbox_presence";

export function isPresenceEnabled(): boolean {
  return isBotApiConfigured();
}

export async function putPresence(
  ownerKey: string,
  heartbeat: Heartbeat,
  ts: number,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_PRESENCE_NAMESPACE, ownerKey, JSON.stringify({ ...heartbeat, ts }));
    return true;
  } catch {
    return false;
  }
}

export async function putPresenceTabGuarded(
  ownerKey: string,
  heartbeat: Heartbeat,
  ts: number,
): Promise<"stored" | "rejected" | "failed"> {
  if (!isBotApiConfigured()) return "failed";
  try {
    const raw = await kvGet(WORLDBOX_PRESENCE_NAMESPACE, ownerKey);
    const stored = raw === null ? null : parsePresenceEntry(presenceIdFor(ownerKey), raw);
    if (tabVerdict(stored, heartbeat, ts) === "reject") return "rejected";
    await kvSet(WORLDBOX_PRESENCE_NAMESPACE, ownerKey, JSON.stringify({ ...heartbeat, ts }));
    return "stored";
  } catch {
    return "failed";
  }
}

export async function removePresence(ownerKey: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_PRESENCE_NAMESPACE, ownerKey);
  } catch {
    // 消えなくても鮮度切れで自然に消える
  }
}

export async function findPresenceOwnerKey(presenceId: string): Promise<string | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const rows = await kvList(WORLDBOX_PRESENCE_NAMESPACE);
    for (const [key, raw] of rows) {
      if (presenceIdFor(key) !== presenceId) continue;
      const entry = parsePresenceEntry(presenceId, raw);
      if (entry && Date.now() - entry.ts <= PRESENCE_FRESH_MS) return key;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadStoredPresence(ownerKey: string): Promise<PresenceEntry | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_PRESENCE_NAMESPACE, ownerKey);
    if (raw === null) return null;
    return parsePresenceEntry(presenceIdFor(ownerKey), raw);
  } catch {
    return null;
  }
}

export async function loadMyPresence(ownerKey: string): Promise<PresenceEntry | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_PRESENCE_NAMESPACE, ownerKey);
    if (raw === null) return null;
    const entry = parsePresenceEntry(presenceIdFor(ownerKey), raw);
    if (!entry || !isFreshPresence(entry, Date.now())) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function listPresence(): Promise<PresenceEntry[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const rows = await kvList(WORLDBOX_PRESENCE_NAMESPACE);
    const entries: PresenceEntry[] = [];
    for (const [key, raw] of rows) {
      const entry = parsePresenceEntry(presenceIdFor(key), raw);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export async function listPresenceWithOwners(): Promise<
  { ownerKey: string; entry: PresenceEntry }[]
> {
  if (!isBotApiConfigured()) return [];
  try {
    const rows = await kvList(WORLDBOX_PRESENCE_NAMESPACE);
    const now = Date.now();
    const out: { ownerKey: string; entry: PresenceEntry }[] = [];
    for (const [key, raw] of rows) {
      const entry = parsePresenceEntry(presenceIdFor(key), raw);
      if (entry && isFreshPresence(entry, now)) out.push({ ownerKey: key, entry });
    }
    return out;
  } catch {
    return [];
  }
}
