import { isBotApiConfigured, kvGet, kvList, kvSet } from "../../bot-api";
import { defaultNationSettings, parseNationSettings, type NationSettings } from "./nation-settings";
import { withUserLock } from "../core/user-lock";

export const WORLDBOX_NATION_SETTINGS_NAMESPACE = "worldbox_nation_settings";

export function isNationSettingsEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadNationSettings(guildId: string): Promise<NationSettings> {
  if (!isBotApiConfigured()) return defaultNationSettings();
  try {
    return parseNationSettings(await kvGet(WORLDBOX_NATION_SETTINGS_NAMESPACE, guildId));
  } catch {
    return defaultNationSettings();
  }
}

export async function loadNationSettingsMap(): Promise<Map<string, NationSettings>> {
  const out = new Map<string, NationSettings>();
  if (!isBotApiConfigured()) return out;
  try {
    const all = await kvList(WORLDBOX_NATION_SETTINGS_NAMESPACE);
    for (const [guildId, raw] of all) out.set(guildId, parseNationSettings(raw));
  } catch {
    // 読めなければ全て既定（= 公開・税率5%）として扱う
  }
  return out;
}

export async function storeNationSettings(
  guildId: string,
  settings: NationSettings,
): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_NATION_SETTINGS_NAMESPACE, guildId, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export async function updateNationSettings(
  guildId: string,
  fn: (current: NationSettings) => NationSettings | null,
): Promise<NationSettings | null> {
  return withUserLock(`nation-settings:${guildId}`, async () => {
    const current = await loadNationSettings(guildId);
    const next = fn(current);
    if (!next) return current;
    if (!(await storeNationSettings(guildId, next))) return null;
    return next;
  });
}
