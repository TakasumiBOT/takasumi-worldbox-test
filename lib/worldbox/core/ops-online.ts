import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import {
  appendJournal,
  parseJournal,
  parseReports,
  type ReportEntry,
  type TileJournalEntry,
} from "./ops";
import { dayKeyOf } from "./metrics";
import { withUserLock } from "./user-lock";

export const WORLDBOX_OPS_NAMESPACE = "worldbox_ops";
export const WORLDBOX_JOURNAL_NAMESPACE = "worldbox_tile_journal";

export function worldboxAdminIds(): Set<string> {
  const env = process.env.WORLDBOX_ADMIN_IDS;
  if (env)
    return new Set(
      env
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  return new Set();
}

export async function loadFrozen(): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    const raw = await kvGet(WORLDBOX_OPS_NAMESPACE, "state");
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return !!(data && typeof data === "object" && (data as { frozen?: unknown }).frozen === true);
  } catch {
    return false;
  }
}

export async function storeFrozen(frozen: boolean): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_OPS_NAMESPACE, "state", JSON.stringify({ frozen }));
    return true;
  } catch {
    return false;
  }
}

export async function appendTileJournal(entry: TileJournalEntry): Promise<void> {
  if (!isBotApiConfigured()) return;
  const date = dayKeyOf(entry.at);
  try {
    await withUserLock("ops:journal", async () => {
      const current = parseJournal(await kvGet(WORLDBOX_JOURNAL_NAMESPACE, date));
      await kvSet(WORLDBOX_JOURNAL_NAMESPACE, date, JSON.stringify(appendJournal(current, entry)));
    });
  } catch {
    /* ジャーナルはベストエフォート */
  }
}

export async function loadTileJournal(date: string): Promise<TileJournalEntry[]> {
  if (!isBotApiConfigured()) return [];
  try {
    return parseJournal(await kvGet(WORLDBOX_JOURNAL_NAMESPACE, date));
  } catch {
    return [];
  }
}

export async function loadReports(): Promise<ReportEntry[]> {
  if (!isBotApiConfigured()) return [];
  try {
    return parseReports(await kvGet(WORLDBOX_OPS_NAMESPACE, "reports"));
  } catch {
    return [];
  }
}

export async function appendReport(report: ReportEntry): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await withUserLock("ops:reports", async () => {
      const current = parseReports(await kvGet(WORLDBOX_OPS_NAMESPACE, "reports"));
      await kvSet(
        WORLDBOX_OPS_NAMESPACE,
        "reports",
        JSON.stringify([...current, report].slice(-200)),
      );
    });
    return true;
  } catch {
    return false;
  }
}
