import { isBotApiConfigured, kvGet, kvSet } from "../../bot-api";
import { DEFAULT_PROFILE, parseProfile, serializeProfile, type PlayerProfile } from "./profile";

export const WORLDBOX_PROFILE_NAMESPACE = "worldbox_profiles";

export function isProfileEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadProfile(ownerKey: string): Promise<PlayerProfile> {
  if (!isBotApiConfigured()) return { ...DEFAULT_PROFILE };
  try {
    const raw = await kvGet(WORLDBOX_PROFILE_NAMESPACE, ownerKey);
    if (raw === null || raw === undefined) {
      const fresh: PlayerProfile = parseProfile(null);
      await kvSet(WORLDBOX_PROFILE_NAMESPACE, ownerKey, serializeProfile(fresh));
      return fresh;
    }
    return parseProfile(raw);
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export async function storeProfile(ownerKey: string, profile: PlayerProfile): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_PROFILE_NAMESPACE, ownerKey, serializeProfile(profile));
    return true;
  } catch {
    return false;
  }
}
