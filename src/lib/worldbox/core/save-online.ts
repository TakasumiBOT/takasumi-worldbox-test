import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";

export const WORLDBOX_SAVE_NAMESPACE = "worldbox_save";

export const MAX_SAVE_JSON_LENGTH = 262_144;

export function isOnlineSaveEnabled(): boolean {
  return isBotApiConfigured();
}

export function worldboxSaveKey(ownerKey: string): string {
  return ownerKey;
}

export async function loadWorldBoxSave(ownerKey: string): Promise<string | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const raw = await kvGet(WORLDBOX_SAVE_NAMESPACE, worldboxSaveKey(ownerKey));
    return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_SAVE_JSON_LENGTH
      ? raw
      : null;
  } catch {
    return null;
  }
}

export async function storeWorldBoxSave(ownerKey: string, saveJson: string): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  if (
    typeof saveJson !== "string" ||
    saveJson.length === 0 ||
    saveJson.length > MAX_SAVE_JSON_LENGTH
  )
    return false;
  try {
    await kvSet(WORLDBOX_SAVE_NAMESPACE, worldboxSaveKey(ownerKey), saveJson);
    return true;
  } catch {
    return false;
  }
}
