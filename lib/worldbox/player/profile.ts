export type AdventureRoleId =
  | "free"
  | "blade"
  | "guard"
  | "scout"
  | "miner"
  | "medic"
  | "teleporter";
export const ADVENTURE_ROLE_IDS: readonly AdventureRoleId[] = [
  "free",
  "blade",
  "guard",
  "scout",
  "miner",
  "medic",
  "teleporter",
];

export function isAdventureRoleId(v: unknown): v is AdventureRoleId {
  return typeof v === "string" && (ADVENTURE_ROLE_IDS as readonly string[]).includes(v);
}
import { ITEMS, itemById, type ItemDef, type ToolKind } from "../economy/items";

export const HUNGER_MAX = 100;

export type StatusKind = "warm" | "alert";
export type StatusEffect = { kind: StatusKind; until: number };
export const STARTING_COINS = 100;

export const HOTBAR_SLOTS = 5;
export const STORAGE_SLOTS = 10;
export const STACK_MAX = 99;

export type ItemSlot = { id: string; count: number } | null;

export type PlayerProfile = {
  coins: number;
  hunger: number;
  status: StatusEffect[];
  vitalAt: number;
  vitalX?: number;
  vitalY?: number;
  vitalSpace?: string;
  items: Record<string, number>;
  hotbar: ItemSlot[];
  storage: ItemSlot[];
  stealActorAt: number;
  stealTargetAt: number;
  role: AdventureRoleId;
  rolePicked: boolean;
  mastery: Partial<Record<AdventureRoleId, { xp: number }>>;
  skillAt: Record<string, number>;
  tentTier: number;
  enhance: Record<string, number>;
  toolHp: Record<string, number>;
  discoveredRecipes?: string[];
  pendingTeleport: { space: string; x: number; y: number } | null;
};

function emptySlots(size: number): ItemSlot[] {
  return Array.from({ length: size }, () => null);
}

export const DEFAULT_PROFILE: PlayerProfile = {
  role: "free",
  rolePicked: false,
  mastery: {},
  skillAt: {},
  pendingTeleport: null,
  tentTier: 0,
  enhance: {},
  toolHp: {},
  discoveredRecipes: [],
  coins: STARTING_COINS,
  hunger: HUNGER_MAX,
  status: [],
  vitalAt: 0,
  items: {},
  hotbar: emptySlots(HOTBAR_SLOTS),
  storage: emptySlots(STORAGE_SLOTS),
  stealActorAt: 0,
  stealTargetAt: 0,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clampVital(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.round(Math.max(min, Math.min(max, v)) * 1000) / 1000;
}

function parseItems(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const items: Record<string, number> = {};
  for (const [id, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!itemById(id)) continue;
    const n = clampInt(count, 0, 9999, 0);
    if (n > 0) items[id] = n;
  }
  return items;
}

function parseSlot(raw: unknown): ItemSlot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as { id?: unknown; count?: unknown };
  if (!itemById(v.id)) return null;
  const n = clampInt(v.count, 1, STACK_MAX, 0);
  return n > 0 ? { id: v.id as string, count: n } : null;
}

function parseSlots(raw: unknown, size: number): ItemSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const out = emptySlots(size);
  for (let i = 0; i < Math.min(size, raw.length); i++) out[i] = parseSlot(raw[i]);
  return out;
}

function slotTotal(slots: readonly ItemSlot[], itemId: string): number {
  let n = 0;
  for (const s of slots) if (s && s.id === itemId) n += s.count;
  return n;
}

function pourIntoSlots(
  totals: Record<string, number>,
  hotbar: ItemSlot[],
  storage: ItemSlot[],
): void {
  const all = [...hotbar, ...storage];
  for (const id of Object.keys(totals)) {
    let remaining = totals[id] - (slotTotal(hotbar, id) + slotTotal(storage, id));
    for (const slot of all) {
      if (remaining <= 0) break;
      if (slot && slot.id === id && slot.count < STACK_MAX) {
        const add = Math.min(STACK_MAX - slot.count, remaining);
        slot.count += add;
        remaining -= add;
      }
    }
    for (let i = 0; i < all.length; i++) {
      if (remaining <= 0) break;
      if (all[i] === null) {
        const put = Math.min(STACK_MAX, remaining);
        all[i] = { id, count: put };
        remaining -= put;
      }
    }
    for (let i = 0; i < hotbar.length; i++) hotbar[i] = all[i];
    for (let i = 0; i < storage.length; i++) storage[i] = all[hotbar.length + i];
  }
}

type InvView = { hotbar: ItemSlot[]; storage: ItemSlot[]; items: Record<string, number> };

function invOf(profile: PlayerProfile): InvView {
  const items = parseItems(profile.items);
  let hotbar = parseSlots(profile.hotbar, HOTBAR_SLOTS);
  let storage = parseSlots(profile.storage, STORAGE_SLOTS);
  if (hotbar === null || storage === null) {
    hotbar = emptySlots(HOTBAR_SLOTS);
    storage = emptySlots(STORAGE_SLOTS);
    pourIntoSlots(items, hotbar, storage);
  }
  for (const slot of [...hotbar, ...storage]) {
    if (!slot) continue;
    const slotted = slotTotal(hotbar, slot.id) + slotTotal(storage, slot.id);
    if ((items[slot.id] ?? 0) < slotted) items[slot.id] = slotted;
  }
  return { hotbar, storage, items };
}

export function parseProfile(raw: unknown): PlayerProfile {
  let data: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        ...DEFAULT_PROFILE,
        items: {},
        hotbar: emptySlots(HOTBAR_SLOTS),
        storage: emptySlots(STORAGE_SLOTS),
        status: [],
        mastery: {},
        skillAt: {},
      };
    }
  } else if (raw && typeof raw === "object") {
    data = raw as Record<string, unknown>;
  }
  if (!data) {
    return {
      ...DEFAULT_PROFILE,
      items: {},
      hotbar: emptySlots(HOTBAR_SLOTS),
      storage: emptySlots(STORAGE_SLOTS),
      status: [],
      mastery: {},
      skillAt: {},
    };
  }
  const inv = invOf({
    coins: 0,
    hunger: 0,
    status: [],
    vitalAt: 0,
    stealActorAt: 0,
    stealTargetAt: 0,
    role: "free",
    rolePicked: false,
    mastery: {},
    skillAt: {},
    pendingTeleport: null,
    tentTier: 0,
    enhance: {},
    toolHp: {},
    items: data.items as Record<string, number>,
    hotbar: data.hotbar as ItemSlot[],
    storage: data.storage as ItemSlot[],
  });
  const role: AdventureRoleId = isAdventureRoleId(data.role) ? data.role : "free";
  return {
    coins: clampInt(data.coins, 0, Number.MAX_SAFE_INTEGER, DEFAULT_PROFILE.coins),
    hunger: clampVital(data.hunger, 0, HUNGER_MAX, DEFAULT_PROFILE.hunger),
    status: parseStatus(data.status),
    vitalAt: clampInt(data.vitalAt, 0, Number.MAX_SAFE_INTEGER, 0),
    vitalX: parseVitalCoord(data.vitalX),
    vitalY: parseVitalCoord(data.vitalY),
    vitalSpace: parseVitalSpace(data.vitalSpace),
    items: inv.items,
    hotbar: inv.hotbar,
    storage: inv.storage,
    stealActorAt: clampInt(data.stealActorAt, 0, Number.MAX_SAFE_INTEGER, 0),
    stealTargetAt: clampInt(data.stealTargetAt, 0, Number.MAX_SAFE_INTEGER, 0),
    role,
    rolePicked: data.rolePicked === true || role !== "free",
    mastery: parseMastery(data.mastery),
    skillAt: parseSkillAt(data.skillAt),
    pendingTeleport: parsePendingTeleport(data.pendingTeleport),
    tentTier: clampInt(data.tentTier, 0, 2, 0),
    enhance: parseEnhance(data.enhance),
    toolHp: parseToolHp(data.toolHp),
    discoveredRecipes: parseDiscoveredRecipes(data.discoveredRecipes),
  };
}

function parseMastery(raw: unknown): Partial<Record<AdventureRoleId, { xp: number }>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<AdventureRoleId, { xp: number }>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAdventureRoleId(k)) continue;
    const xp = (v as { xp?: unknown } | null)?.xp;
    if (typeof xp === "number" && Number.isFinite(xp) && xp > 0) out[k] = { xp: Math.floor(xp) };
  }
  return out;
}

function parseSkillAt(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

function parsePendingTeleport(raw: unknown): { space: string; x: number; y: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as { space?: unknown; x?: unknown; y?: unknown };
  if (typeof v.space !== "string" || typeof v.x !== "number" || typeof v.y !== "number")
    return null;
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  return { space: v.space.slice(0, 64), x: v.x, y: v.y };
}

export function parseDiscoveredRecipes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || v.length === 0) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= 500) break;
  }
  return out;
}

export function parseEnhance(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [itemId, level] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof level !== "number" || !Number.isFinite(level)) continue;
    const lv = Math.floor(level);
    if (lv <= 0) continue;
    out[itemId] = Math.min(ENHANCE_MAX_LEVEL, lv);
  }
  return out;
}

export function parseToolHp(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [itemId, hp] of Object.entries(raw as Record<string, unknown>)) {
    const def = itemById(itemId);
    if (!def?.tool || !def.durability) continue;
    if (typeof hp !== "number" || !Number.isFinite(hp)) continue;
    const v = Math.floor(hp);
    if (v <= 0 || v >= def.durability) continue;
    out[itemId] = v;
  }
  return out;
}

export const ENHANCE_MAX_LEVEL = 3;
export const ENHANCE_BASE_COST = 150;
export const ENHANCE_MATERIALS: Record<number, { itemId: string; count: number }> = {
  1: { itemId: "wood", count: 2 },
  2: { itemId: "stone", count: 2 },
  3: { itemId: "iron_ingot", count: 1 },
  4: { itemId: "mithril", count: 1 },
};

function parseStatus(raw: unknown): StatusEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: StatusEffect[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const e = v as { kind?: unknown; until?: unknown };
    if (e.kind !== "warm" && e.kind !== "alert") continue;
    if (typeof e.until !== "number" || !Number.isFinite(e.until) || e.until <= 0) continue;
    out.push({ kind: e.kind, until: Math.floor(e.until) });
  }
  return out.slice(0, 4);
}

function parseVitalCoord(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.max(-1_000_000, Math.min(1_000_000, v));
}

function parseVitalSpace(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v.slice(0, 64);
}

export function serializeProfile(profile: PlayerProfile): string {
  const inv = invOf(profile);
  return JSON.stringify({
    coins: clampInt(profile.coins, 0, Number.MAX_SAFE_INTEGER, 0),
    hunger: clampVital(profile.hunger, 0, HUNGER_MAX, 0),
    status: parseStatus(profile.status),
    vitalAt: clampInt(profile.vitalAt, 0, Number.MAX_SAFE_INTEGER, 0),
    ...(typeof profile.vitalX === "number" &&
    typeof profile.vitalY === "number" &&
    typeof profile.vitalSpace === "string"
      ? {
          vitalX: parseVitalCoord(profile.vitalX),
          vitalY: parseVitalCoord(profile.vitalY),
          vitalSpace: profile.vitalSpace.slice(0, 64),
        }
      : {}),
    items: inv.items,
    hotbar: inv.hotbar,
    storage: inv.storage,
    stealActorAt: clampInt(profile.stealActorAt, 0, Number.MAX_SAFE_INTEGER, 0),
    stealTargetAt: clampInt(profile.stealTargetAt, 0, Number.MAX_SAFE_INTEGER, 0),
    role: isAdventureRoleId(profile.role) ? profile.role : "free",
    rolePicked:
      profile.rolePicked === true || (isAdventureRoleId(profile.role) && profile.role !== "free"),
    mastery: parseMastery(profile.mastery),
    skillAt: parseSkillAt(profile.skillAt),
    pendingTeleport: parsePendingTeleport(profile.pendingTeleport),
    tentTier: clampInt(profile.tentTier, 0, 2, 0),
    enhance: parseEnhance(profile.enhance),
    toolHp: parseToolHp(profile.toolHp),
    discoveredRecipes: parseDiscoveredRecipes(profile.discoveredRecipes),
  });
}

export function countItem(profile: PlayerProfile, itemId: string): number {
  const inv = invOf(profile);
  const slotted = slotTotal(inv.hotbar, itemId) + slotTotal(inv.storage, itemId);
  return Math.max(inv.items[itemId] ?? 0, slotted);
}

export function overflowCount(profile: PlayerProfile, itemId: string): number {
  const inv = invOf(profile);
  const slotted = slotTotal(inv.hotbar, itemId) + slotTotal(inv.storage, itemId);
  return Math.max(0, (inv.items[itemId] ?? 0) - slotted);
}

function withInv(profile: PlayerProfile, inv: InvView): PlayerProfile {
  return { ...profile, items: inv.items, hotbar: inv.hotbar, storage: inv.storage };
}

export function addItem(profile: PlayerProfile, itemId: string, count: number): PlayerProfile {
  if (count < 0) {
    const removed = removeItem(profile, itemId, -count);
    if (removed) return removed;
    const inv = invOf(profile);
    const total = countItem(profile, itemId);
    const next = {
      ...inv,
      hotbar: inv.hotbar.map((s) => (s && s.id === itemId ? null : s)),
      storage: inv.storage.map((s) => (s && s.id === itemId ? null : s)),
    };
    const items = { ...next.items };
    if (total + count > 0) items[itemId] = total + count;
    else delete items[itemId];
    return withInv(profile, { ...next, items });
  }
  if (count === 0 || !itemById(itemId)) return profile;
  const inv = invOf(profile);
  const hotbar = inv.hotbar.map((s) => (s ? { ...s } : null));
  const storage = inv.storage.map((s) => (s ? { ...s } : null));
  let remaining = count;
  for (const slots of [hotbar, storage]) {
    for (const slot of slots) {
      if (remaining <= 0) break;
      if (slot && slot.id === itemId && slot.count < STACK_MAX) {
        const add = Math.min(STACK_MAX - slot.count, remaining);
        slot.count += add;
        remaining -= add;
      }
    }
  }
  for (const slots of [hotbar, storage]) {
    for (let i = 0; i < slots.length; i++) {
      if (remaining <= 0) break;
      if (slots[i] === null) {
        const put = Math.min(STACK_MAX, remaining);
        slots[i] = { id: itemId, count: put };
        remaining -= put;
      }
    }
  }
  const items = { ...inv.items };
  items[itemId] = countItem(profile, itemId) + count;
  return withInv(profile, { hotbar, storage, items });
}

export function removeItem(
  profile: PlayerProfile,
  itemId: string,
  count: number,
): PlayerProfile | null {
  if (count <= 0) return profile;
  if (countItem(profile, itemId) < count) return null;
  const inv = invOf(profile);
  const hotbar = inv.hotbar.map((s) => (s ? { ...s } : null));
  const storage = inv.storage.map((s) => (s ? { ...s } : null));
  let remaining = count;
  for (const slots of [hotbar, storage]) {
    for (let i = 0; i < slots.length; i++) {
      if (remaining <= 0) break;
      const slot = slots[i];
      if (slot && slot.id === itemId) {
        const take = Math.min(slot.count, remaining);
        slot.count -= take;
        remaining -= take;
        if (slot.count <= 0) slots[i] = null;
      }
    }
  }
  const items = { ...inv.items };
  const next = countItem(profile, itemId) - count;
  if (next > 0) items[itemId] = next;
  else delete items[itemId];
  return withInv(profile, { hotbar, storage, items });
}

export function bestToolItem(profile: PlayerProfile, kind: ToolKind): ItemDef | null {
  let best: ItemDef | null = null;
  let bestEff = -1;
  for (const def of ITEMS) {
    if (def.tool !== kind || countItem(profile, def.id) <= 0) continue;
    const eff = (def.tier ?? 0) + (profile.enhance?.[def.id] ?? 0);
    if (
      eff > bestEff ||
      (eff === bestEff &&
        best !== null &&
        ((def.tier ?? 0) > (best.tier ?? 0) ||
          ((def.tier ?? 0) === (best.tier ?? 0) && (def.durability ?? 0) > (best.durability ?? 0))))
    ) {
      best = def;
      bestEff = eff;
    }
  }
  return best;
}

export function toolHpOf(profile: PlayerProfile, itemId: string): number {
  const def = itemById(itemId);
  if (!def?.tool || !def.durability) return 0;
  if (countItem(profile, itemId) <= 0) return 0;
  return profile.toolHp?.[itemId] ?? def.durability;
}

export function toolDurabilityFraction(profile: PlayerProfile, itemId: string): number | null {
  const def = itemById(itemId);
  if (!def?.tool || !def.durability) return null;
  if (countItem(profile, itemId) <= 0) return null;
  return toolHpOf(profile, itemId) / def.durability;
}

export type WearResult = {
  profile: PlayerProfile;
  brokeItemId: string | null;
};

export function wearTool(profile: PlayerProfile, kind: ToolKind, amount = 1): WearResult {
  const def = bestToolItem(profile, kind);
  if (!def || !def.durability || amount <= 0) return { profile, brokeItemId: null };
  const left = toolHpOf(profile, def.id) - amount;
  if (left > 0) {
    return {
      profile: { ...profile, toolHp: { ...(profile.toolHp ?? {}), [def.id]: left } },
      brokeItemId: null,
    };
  }
  const removed = removeItem(profile, def.id, 1);
  if (!removed) return { profile, brokeItemId: null };
  const toolHp = { ...(removed.toolHp ?? {}) };
  delete toolHp[def.id];
  return { profile: { ...removed, toolHp }, brokeItemId: def.id };
}

export function swapSlots(
  profile: PlayerProfile,
  hotbarIndex: unknown,
  storageIndex: unknown,
): PlayerProfile | null {
  if (typeof hotbarIndex !== "number" || typeof storageIndex !== "number") return null;
  const hi = Math.floor(hotbarIndex);
  const si = Math.floor(storageIndex);
  if (hi < 0 || hi >= HOTBAR_SLOTS || si < 0 || si >= STORAGE_SLOTS) return null;
  const inv = invOf(profile);
  const hotbar = [...inv.hotbar];
  const storage = [...inv.storage];
  const tmp = hotbar[hi];
  hotbar[hi] = storage[si];
  storage[si] = tmp;
  return withInv(profile, { hotbar, storage, items: inv.items });
}

export type SlotZone = "hotbar" | "storage";
export type SlotRef = { zone: SlotZone; index: number };

function parseSlotRef(raw: unknown): SlotRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as { zone?: unknown; index?: unknown };
  if (v.zone !== "hotbar" && v.zone !== "storage") return null;
  if (typeof v.index !== "number" || !Number.isFinite(v.index)) return null;
  const index = Math.floor(v.index);
  const max = v.zone === "hotbar" ? HOTBAR_SLOTS : STORAGE_SLOTS;
  if (index < 0 || index >= max) return null;
  return { zone: v.zone, index };
}

export function moveSlot(
  profile: PlayerProfile,
  fromRaw: unknown,
  toRaw: unknown,
): PlayerProfile | null {
  const from = parseSlotRef(fromRaw);
  const to = parseSlotRef(toRaw);
  if (!from || !to) return null;
  if (from.zone === to.zone && from.index === to.index) return profile;
  const inv = invOf(profile);
  const hotbar = [...inv.hotbar];
  const storage = [...inv.storage];
  const arr = (zone: SlotZone) => (zone === "hotbar" ? hotbar : storage);
  const src = arr(from.zone)[from.index];
  if (!src) return profile;
  const dst = arr(to.zone)[to.index];
  if (!dst) {
    arr(to.zone)[to.index] = src;
    arr(from.zone)[from.index] = null;
  } else if (dst.id === src.id) {
    const moved = Math.min(STACK_MAX - dst.count, src.count);
    if (moved <= 0) return profile;
    arr(to.zone)[to.index] = { id: dst.id, count: dst.count + moved };
    const rest = src.count - moved;
    arr(from.zone)[from.index] = rest > 0 ? { id: src.id, count: rest } : null;
  } else {
    arr(to.zone)[to.index] = src;
    arr(from.zone)[from.index] = dst;
  }
  return withInv(profile, { hotbar, storage, items: inv.items });
}
