import {
  STEAL_ACTOR_COOLDOWN_SECONDS,
  STEAL_BALANCE_RATE,
  STEAL_FINE_AMOUNT,
  STEAL_MAX_AMOUNT,
  STEAL_SUCCESS_RATE,
  STEAL_TARGET_COOLDOWN_SECONDS,
  STEAL_TARGET_MIN_COINS,
  THIEF_MASK_BONUS,
  WORK_HUNGER_COST,
  WORK_REWARD_COINS,
  RECIPES,
  itemById,
  recipeById,
  sellPrice,
  type ItemDef,
  type Recipe,
} from "./items";
import { HUNGER_MAX, addItem, countItem, removeItem, type PlayerProfile } from "../player/profile";
import { consumeEffect } from "../player/vitals";

export type EconomyError =
  | "unknown_item"
  | "unknown_recipe"
  | "not_enough_coins"
  | "not_enough_items"
  | "hunger_full"
  | "too_tired"
  | "invalid_count"
  | "invalid_request"
  | "steal_cooldown"
  | "target_protected"
  | "target_recently_stolen"
  | "self_target";

export type CoinMovement =
  | { kind: "spend"; amount: number; reason: string }
  | { kind: "earn"; amount: number; reason: string };

export type Transition<T extends object = object> =
  | ({ ok: true; profile: PlayerProfile; coin?: CoinMovement } & T)
  | { ok: false; error: EconomyError };

function clampCount(v: unknown): number | null {
  if (v === undefined) return 1;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n >= 1 && n <= 99 ? n : null;
}

export function buyItem(
  profile: PlayerProfile,
  itemId: unknown,
  countRaw: unknown,
  balance: number,
  unitPrice?: number,
): Transition {
  const item = itemById(itemId);
  if (!item) return { ok: false, error: "unknown_item" };
  const count = clampCount(countRaw);
  if (count === null) return { ok: false, error: "invalid_count" };
  const price =
    typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice > 0
      ? Math.floor(unitPrice)
      : item.price;
  const cost = price * count;
  if (balance < cost) return { ok: false, error: "not_enough_coins" };
  return {
    ok: true,
    profile: addItem(profile, item.id, count),
    coin: { kind: "spend", amount: cost, reason: "shop_buy" },
  };
}

export function sellItem(profile: PlayerProfile, itemId: unknown, countRaw?: unknown): Transition {
  const item = itemById(itemId);
  if (!item) return { ok: false, error: "unknown_item" };
  const count = clampCount(countRaw);
  if (count === null) return { ok: false, error: "invalid_count" };
  const removed = removeItem(profile, item.id, count);
  if (!removed) return { ok: false, error: "not_enough_items" };
  const bonus =
    (removed.items["accessory"] ?? 0) > 0 || (profile.items["accessory"] ?? 0) > 0 ? 1.1 : 1;
  return {
    ok: true,
    profile: removed,
    coin: {
      kind: "earn",
      amount: Math.floor(sellPrice(item) * count * bonus),
      reason: "shop_sale",
    },
  };
}

export function eatItem(
  profile: PlayerProfile,
  itemId: unknown,
  now: number = Date.now(),
): Transition<{ item: ItemDef }> {
  const item = itemById(itemId);
  if (!item || (!item.hunger && !item.buff)) return { ok: false, error: "unknown_item" };
  if (item.hunger && profile.hunger >= HUNGER_MAX) {
    return { ok: false, error: "hunger_full" };
  }
  const removed = removeItem(profile, item.id, 1);
  if (!removed) return { ok: false, error: "not_enough_items" };
  const effected = consumeEffect(removed, item.id, now);
  if (!effected) return { ok: false, error: "unknown_item" };
  const withContainer = item.containerReturn
    ? addItem(effected.profile, item.containerReturn, 1)
    : effected.profile;
  return { ok: true, item, profile: withContainer };
}

export function doWork(profile: PlayerProfile): Transition {
  if (profile.hunger < WORK_HUNGER_COST) return { ok: false, error: "too_tired" };
  return {
    ok: true,
    profile: { ...profile, hunger: profile.hunger - WORK_HUNGER_COST },
    coin: { kind: "earn", amount: WORK_REWARD_COINS, reason: "work" },
  };
}

export function craftItem(
  profile: PlayerProfile,
  recipeId: unknown,
  rng: () => number = Math.random,
): Transition<{ recipe: Recipe; rare: ItemDef | null }> {
  const recipe = recipeById(recipeId);
  if (!recipe) return { ok: false, error: "unknown_recipe" };
  let next = profile;
  for (const [inputId, need] of Object.entries(recipe.inputs)) {
    const removed = removeItem(next, inputId, need);
    if (!removed) return { ok: false, error: "not_enough_items" };
    next = removed;
  }
  next = addItem(next, recipe.output, recipe.outputCount);
  let rare: ItemDef | null = null;
  if (recipe.rareItem && recipe.rareChance && rng() < recipe.rareChance) {
    rare = itemById(recipe.rareItem);
    if (rare) next = addItem(next, rare.id, 1);
  }
  return { ok: true, recipe, rare, profile: next };
}

export type CraftHint = "exact" | "near" | "far";

export const CRAFT_FAILURE_ITEM_ID = "mystery_lump";
export const CRAFT_MAX_KINDS = 4;
export const CRAFT_MAX_PER_KIND = 6;

export function craftFromInputs(
  profile: PlayerProfile,
  inputsRaw: unknown,
  rng: () => number = Math.random,
): Transition<{
  recipe: Recipe | null;
  resultId: string;
  rare: ItemDef | null;
  hint: CraftHint;
  matched: boolean;
}> {
  if (!inputsRaw || typeof inputsRaw !== "object" || Array.isArray(inputsRaw)) {
    return { ok: false, error: "invalid_request" };
  }
  const entries = Object.entries(inputsRaw as Record<string, unknown>);
  if (entries.length < 1 || entries.length > CRAFT_MAX_KINDS) {
    return { ok: false, error: "invalid_request" };
  }
  const inputs: Record<string, number> = {};
  for (const [id, countRaw] of entries) {
    if (!itemById(id)) return { ok: false, error: "unknown_item" };
    if (
      typeof countRaw !== "number" ||
      !Number.isInteger(countRaw) ||
      countRaw < 1 ||
      countRaw > CRAFT_MAX_PER_KIND
    ) {
      return { ok: false, error: "invalid_request" };
    }
    inputs[id] = countRaw;
  }
  const matched = RECIPES.find((recipe) => {
    const keys = Object.keys(recipe.inputs);
    return keys.length === entries.length && keys.every((k) => inputs[k] === recipe.inputs[k]);
  });
  if (matched) {
    const result = craftItem(profile, matched.id, rng);
    if (!result.ok) return result;
    return {
      ok: true,
      profile: result.profile,
      recipe: matched,
      resultId: matched.output,
      rare: result.rare,
      hint: "exact",
      matched: true,
    };
  }
  for (const [id, need] of Object.entries(inputs)) {
    if (countItem(profile, id) < need) return { ok: false, error: "not_enough_items" };
  }
  let next = profile;
  for (const [id, need] of Object.entries(inputs)) {
    const removed = removeItem(next, id, need);
    if (!removed) return { ok: false, error: "not_enough_items" };
    next = removed;
  }
  next = addItem(next, CRAFT_FAILURE_ITEM_ID, 1);
  const inputKinds = new Set(Object.keys(inputs));
  const near = RECIPES.some((recipe) => {
    const keys = Object.keys(recipe.inputs);
    const shared = keys.filter((k) => inputKinds.has(k)).length;
    return shared > keys.length / 2;
  });
  return {
    ok: true,
    profile: next,
    recipe: null,
    resultId: CRAFT_FAILURE_ITEM_ID,
    rare: null,
    hint: near ? "near" : "far",
    matched: false,
  };
}

export type StealOutcome =
  | {
      ok: true;
      success: boolean;
      amount: number;
      actor: PlayerProfile;
      target: PlayerProfile;
      coin?: CoinMovement;
    }
  | { ok: false; error: EconomyError };

export interface StealBalances {
  actorCoins: number;
  targetCoins: number;
}

export function resolveSteal(
  actor: PlayerProfile,
  target: PlayerProfile,
  now: number,
  rng: () => number = Math.random,
  balances: StealBalances = { actorCoins: 0, targetCoins: 0 },
): StealOutcome {
  if (now - actor.stealActorAt < STEAL_ACTOR_COOLDOWN_SECONDS * 1000) {
    return { ok: false, error: "steal_cooldown" };
  }
  if (balances.targetCoins < STEAL_TARGET_MIN_COINS || countItem(target, "guard_charm") > 0) {
    return { ok: false, error: "target_protected" };
  }
  if (now - target.stealTargetAt < STEAL_TARGET_COOLDOWN_SECONDS * 1000) {
    return { ok: false, error: "target_recently_stolen" };
  }
  const rate = STEAL_SUCCESS_RATE + (countItem(actor, "thief_mask") > 0 ? THIEF_MASK_BONUS : 0);
  const stampedActor = { ...actor, stealActorAt: now };
  const stampedTarget = { ...target, stealTargetAt: now };
  if (rng() < rate) {
    const amount = Math.max(
      1,
      Math.min(STEAL_MAX_AMOUNT, Math.floor(balances.targetCoins * STEAL_BALANCE_RATE)),
    );
    return { ok: true, success: true, amount, actor: stampedActor, target: stampedTarget };
  }
  const fine = Math.min(STEAL_FINE_AMOUNT, balances.actorCoins);
  return {
    ok: true,
    success: false,
    amount: fine,
    actor: stampedActor,
    target: stampedTarget,
    ...(fine > 0
      ? { coin: { kind: "spend", amount: fine, reason: "steal_fine" } as CoinMovement }
      : {}),
  };
}
