import type { Nation, NationRole, NationsState } from "./nations";

export type NationVisibility = "open" | "private";

export type NationSettings = {
  taxRate: number;
  visibility: NationVisibility;
  ministers: string[];
  taxCollected: number;
  updatedAt: number;
};

export const TAX_RATE_DEFAULT = 0.05;
export const TAX_RATE_MAX = 0.1;

export function defaultNationSettings(): NationSettings {
  return {
    taxRate: TAX_RATE_DEFAULT,
    visibility: "open",
    ministers: [],
    taxCollected: 0,
    updatedAt: 0,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function normalizeTaxRate(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return TAX_RATE_DEFAULT;
  if (raw < 0 || raw > TAX_RATE_MAX) return TAX_RATE_DEFAULT;
  return Math.round(raw * 1000) / 1000;
}

export function parseNationSettings(raw: unknown): NationSettings {
  const out = defaultNationSettings();
  const v = asRecord(raw);
  if (!v) return out;
  out.taxRate = normalizeTaxRate(v.taxRate);
  out.visibility = v.visibility === "private" ? "private" : "open";
  if (Array.isArray(v.ministers)) {
    const seen = new Set<string>();
    for (const key of v.ministers) {
      if (typeof key !== "string" || key.length === 0 || key.length > 64 || seen.has(key)) continue;
      seen.add(key);
      out.ministers.push(key);
      if (out.ministers.length >= 200) break;
    }
  }
  if (typeof v.taxCollected === "number" && Number.isFinite(v.taxCollected) && v.taxCollected > 0) {
    out.taxCollected = Math.floor(v.taxCollected);
  }
  if (typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) && v.updatedAt > 0) {
    out.updatedAt = Math.floor(v.updatedAt);
  }
  return out;
}

export function taxRateOf(settings: NationSettings | null | undefined): number {
  return settings ? settings.taxRate : TAX_RATE_DEFAULT;
}

export function isPrivateNation(settings: NationSettings | null | undefined): boolean {
  return settings?.visibility === "private";
}

export function memberKeysOf(state: NationsState, guildId: string): Set<string> {
  const keys = new Set<string>();
  for (const [ownerKey, m] of Object.entries(state.members)) {
    if (m.nationId === guildId) keys.add(ownerKey);
  }
  return keys;
}

export function effectiveMinisters(
  settings: NationSettings | null | undefined,
  memberKeys: ReadonlySet<string>,
): string[] {
  if (!settings) return [];
  return settings.ministers.filter((key) => memberKeys.has(key));
}

export type ResolvedMemberRole = {
  role: NationRole;
  appointed: boolean;
  discordMinister: boolean;
};

export function resolveMemberRole(
  nation: Pick<Nation, "kingKey">,
  settings: NationSettings | null | undefined,
  ownerKey: string,
  storedRole: NationRole,
  memberKeys: ReadonlySet<string>,
): ResolvedMemberRole | null {
  if (!memberKeys.has(ownerKey)) return null;
  if (ownerKey === nation.kingKey)
    return { role: "king", appointed: false, discordMinister: false };
  const appointed = effectiveMinisters(settings, memberKeys).includes(ownerKey);
  const discordMinister = storedRole === "minister";
  if (appointed || discordMinister) return { role: "minister", appointed, discordMinister };
  return { role: "citizen", appointed: false, discordMinister: false };
}

export function isNationHiddenFrom(
  settings: NationSettings | null | undefined,
  nationId: string,
  viewerNationId: string | null | undefined,
): boolean {
  if (!isPrivateNation(settings)) return false;
  return viewerNationId !== nationId;
}
