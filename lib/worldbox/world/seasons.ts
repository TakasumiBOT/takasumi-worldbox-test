export type SeasonId = "spring" | "summer" | "autumn" | "winter";

export const SEASON_IDS: readonly SeasonId[] = ["spring", "summer", "autumn", "winter"];

export const SEASON_NAMES: Record<SeasonId, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

export const SEASON_LENGTH_MS = 7 * 24 * 3600 * 1000;

export function seasonIndexOf(now: number): number {
  return Math.floor(now / SEASON_LENGTH_MS) % SEASON_IDS.length;
}

export function seasonOf(now: number): SeasonId {
  return SEASON_IDS[seasonIndexOf(now)];
}

export function isSeasonId(raw: unknown): raw is SeasonId {
  return typeof raw === "string" && (SEASON_IDS as readonly string[]).includes(raw);
}

export function seasonDaysLeft(now: number): number {
  const elapsed = now % SEASON_LENGTH_MS;
  return Math.ceil((SEASON_LENGTH_MS - elapsed) / (24 * 3600 * 1000)) - 1;
}

export function seasonGrowthMult(cropSeason: SeasonId | null | undefined, now: number): number {
  if (!cropSeason) return 1;
  const cur = seasonIndexOf(now);
  const pref = SEASON_IDS.indexOf(cropSeason);
  if (pref < 0) return 1;
  const diff = (cur - pref + SEASON_IDS.length) % SEASON_IDS.length;
  if (diff === 0) return 0.7;
  if (diff === 2) return 1.4;
  return 1;
}
