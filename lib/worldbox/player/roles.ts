import type { PlayerProfile, AdventureRoleId } from "./profile";
import { isAdventureRoleId, ADVENTURE_ROLE_IDS } from "./profile";
export type { AdventureRoleId } from "./profile";
export { isAdventureRoleId, ADVENTURE_ROLE_IDS };
import type { SkillFxKind } from "../media/fx";

export type SkillId = "porter";

export type SkillDef = {
  id: SkillId;
  name: string;
  fx: SkillFxKind;
  minRank: number;
  cooldownMs: number;
  radius: number;
  power: number;
};

export const SKILLS: Record<SkillId, SkillDef> = {
  porter: {
    id: "porter",
    name: "ポーター設置",
    fx: "warp",
    minRank: 1,
    cooldownMs: 30_000,
    radius: 0,
    power: 0,
  },
};

export type AdventureRoleDef = {
  id: AdventureRoleId;
  name: string;
  symbol: string;
  passiveName: string;
  specialtyName: string;
  skills: readonly SkillId[];
};

export const ADVENTURE_ROLES: Record<AdventureRoleId, AdventureRoleDef> = {
  free: {
    id: "free",
    name: "フリーランス",
    symbol: "—",
    passiveName: "なし",
    specialtyName: "なし",
    skills: [],
  },
  blade: {
    id: "blade",
    name: "解体作業員",
    symbol: "解",
    passiveName: "なし",
    specialtyName: "なし",
    skills: [],
  },
  guard: {
    id: "guard",
    name: "警備員",
    symbol: "警",
    passiveName: "なし",
    specialtyName: "なし",
    skills: [],
  },
  scout: {
    id: "scout",
    name: "調査員",
    symbol: "調",
    passiveName: "移動時のスタミナ消費が少ない",
    specialtyName: "罠の察知",
    skills: [],
  },
  miner: {
    id: "miner",
    name: "採掘作業員",
    symbol: "採",
    passiveName: "鉱脈の追加ドロップ",
    specialtyName: "鉱脈探知",
    skills: [],
  },
  medic: {
    id: "medic",
    name: "医療スタッフ",
    symbol: "医",
    passiveName: "食事・薬の利用で熟練が上がる",
    specialtyName: "なし",
    skills: [],
  },
  teleporter: {
    id: "teleporter",
    name: "テレポーター",
    symbol: "ポ",
    passiveName: "ポーター設置",
    specialtyName: "ポーター設置",
    skills: ["porter"],
  },
};

export function roleById(id: unknown): AdventureRoleDef {
  return isAdventureRoleId(id) ? ADVENTURE_ROLES[id] : ADVENTURE_ROLES.free;
}

export const MASTERY_THRESHOLDS: readonly number[] = [0, 30, 80, 160, 300];
export const MASTERY_MAX_RANK = 5;

export function rankForXp(xp: number): number {
  let rank = 1;
  for (let i = 0; i < MASTERY_THRESHOLDS.length; i++) {
    if (xp >= MASTERY_THRESHOLDS[i]) rank = i + 1;
  }
  return Math.min(MASTERY_MAX_RANK, rank);
}

export function masteryRankOf(profile: PlayerProfile, role: AdventureRoleId): number {
  return rankForXp(profile.mastery[role]?.xp ?? 0);
}

export function addMasteryXp(
  profile: PlayerProfile,
  role: AdventureRoleId,
  amount: number,
): { profile: PlayerProfile; rankUp: boolean } {
  if (role === "free" || amount <= 0) return { profile, rankUp: false };
  const before = masteryRankOf(profile, role);
  const xp = (profile.mastery[role]?.xp ?? 0) + amount;
  const next: PlayerProfile = {
    ...profile,
    mastery: { ...profile.mastery, [role]: { xp } },
  };
  return { profile: next, rankUp: rankForXp(xp) > before };
}

export const MINER_BONUS_CHANCE = 0.3;
export const SCOUT_STAMINA_MULT = 0.8;

export function activeSkillFor(profile: PlayerProfile): SkillDef | null {
  const def = roleById(profile.role);
  const rank = masteryRankOf(profile, profile.role);
  let best: SkillDef | null = null;
  for (const id of def.skills) {
    const skill = SKILLS[id];
    if (id === "porter") continue;
    if (rank >= skill.minRank) best = skill;
  }
  return best;
}

export function skillCooldownLeft(profile: PlayerProfile, skillId: SkillId, now: number): number {
  const at = profile.skillAt[skillId] ?? 0;
  return Math.max(0, at + SKILLS[skillId].cooldownMs - now);
}

export const ROLE_CHANGE_COST = 100_000;
export const ROLE_CHANGE_REASON = "role_change";

export function roleChangeCost(profile: PlayerProfile, nextRole: AdventureRoleId): number {
  if (nextRole === profile.role) return 0;
  const picked = profile.rolePicked === true || profile.role !== "free";
  return picked ? ROLE_CHANGE_COST : 0;
}

export function applyRoleChange(
  profile: PlayerProfile,
  nextRole: AdventureRoleId,
): { profile: PlayerProfile; cost: number } {
  const cost = roleChangeCost(profile, nextRole);
  if (nextRole === profile.role) return { profile, cost: 0 };
  return { profile: { ...profile, role: nextRole, rolePicked: true }, cost };
}
