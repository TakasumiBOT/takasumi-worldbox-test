import { itemById, RECIPES } from "../economy/items";
import {
  applyLedger,
  type Company,
  type CompanyBuyOrder,
  type CompanyFactoryJob,
  type CompanyHistoryEntry,
} from "./company";

export const COMPANY_FACTORY_JOB_LIMIT = 8;
export const COMPANY_BUY_ORDER_LIMIT = 12;
export const COMPANY_INVENTORY_KIND_LIMIT = 120;
export const COMPANY_BATCH_MAX = 50;
export const COMPANY_BUY_ORDER_QTY_MAX = 500;
export const COMPANY_BUY_ORDER_PRICE_MAX = 1_000_000;

export interface CompanyRecipeDef {
  id: string;
  name: string;
  inputs: Record<string, number>;
  outputItemId: string;
  outputCount: number;
  operatingCost: number;
  durationMs: number;
  sector: "food" | "material" | "crafted" | "block" | "tool";
}

const INDUSTRIAL_RECIPES: readonly CompanyRecipeDef[] = [
  {
    id: "bulk_bread",
    name: "パン量産ライン",
    inputs: { wheat: 6 },
    outputItemId: "bread",
    outputCount: 5,
    operatingCost: 80,
    durationMs: 60_000,
    sector: "food",
  },
  {
    id: "bulk_bento",
    name: "幕の内弁当ライン",
    inputs: { meal: 2, wheat: 3, herb: 1 },
    outputItemId: "bento",
    outputCount: 3,
    operatingCost: 220,
    durationMs: 120_000,
    sector: "food",
  },
  {
    id: "smelt_iron",
    name: "製鉄炉（鉄インゴット量産）",
    inputs: { iron_ore: 4, charcoal: 2 },
    outputItemId: "iron_ingot",
    outputCount: 5,
    operatingCost: 300,
    durationMs: 120_000,
    sector: "material",
  },
  {
    id: "smelt_gold",
    name: "貴金属精錬（金インゴット）",
    inputs: { gold_ore: 3, charcoal: 2 },
    outputItemId: "gold_ingot",
    outputCount: 3,
    operatingCost: 650,
    durationMs: 180_000,
    sector: "material",
  },
  {
    id: "alloy_iron_block",
    name: "重工業（鉄ブロック製造）",
    inputs: { iron_ingot: 4 },
    outputItemId: "iron_block",
    outputCount: 2,
    operatingCost: 500,
    durationMs: 150_000,
    sector: "block",
  },
  {
    id: "alloy_gold_block",
    name: "資産鋳造（金ブロック製造）",
    inputs: { gold_ingot: 4 },
    outputItemId: "gold_block",
    outputCount: 2,
    operatingCost: 1_200,
    durationMs: 240_000,
    sector: "block",
  },
  {
    id: "mass_lumber",
    name: "製材プラント（板材量産）",
    inputs: { wood: 8 },
    outputItemId: "planks_block",
    outputCount: 6,
    operatingCost: 120,
    durationMs: 60_000,
    sector: "block",
  },
  {
    id: "mass_potion",
    name: "製薬ライン（ハーブドリンク量産）",
    inputs: { herb: 6, glass: 3 },
    outputItemId: "potion",
    outputCount: 4,
    operatingCost: 420,
    durationMs: 120_000,
    sector: "crafted",
  },
  {
    id: "mass_toolbox",
    name: "工具工場（ツールボックス量産）",
    inputs: { iron_ore: 5, wood: 3 },
    outputItemId: "toolbox",
    outputCount: 3,
    operatingCost: 380,
    durationMs: 120_000,
    sector: "crafted",
  },
  {
    id: "luxury_crown",
    name: "宝飾工房（クラウン製造）",
    inputs: { accessory: 2, mithril: 2, gold_ingot: 1 },
    outputItemId: "crown",
    outputCount: 2,
    operatingCost: 1_500,
    durationMs: 300_000,
    sector: "crafted",
  },
];

function sectorForItem(itemId: string): CompanyRecipeDef["sector"] {
  const item = itemById(itemId);
  if (!item) return "crafted";
  if (item.category === "food" || item.category === "crop") return "food";
  if (item.category === "material" || item.category === "seed") return "material";
  if (item.category === "block") return "block";
  if (item.category === "tool") return "tool";
  return "crafted";
}

const STANDARD_COMPANY_RECIPES: readonly CompanyRecipeDef[] = RECIPES.filter(
  (r) => itemById(r.output) !== null,
).map((r) => {
  const out = itemById(r.output);
  const price = out?.price ?? 200;
  return {
    id: `std_${r.id}`,
    name: out?.name ?? r.id,
    inputs: { ...r.inputs },
    outputItemId: r.output,
    outputCount: r.outputCount,
    operatingCost: Math.max(20, Math.floor(price * 0.12)),
    durationMs: 45_000,
    sector: sectorForItem(r.output),
  };
});

export const COMPANY_RECIPES: readonly CompanyRecipeDef[] = [
  ...INDUSTRIAL_RECIPES,
  ...STANDARD_COMPANY_RECIPES,
];

const COMPANY_RECIPE_MAP = new Map(COMPANY_RECIPES.map((r) => [r.id, r]));

export function companyRecipeById(recipeId: unknown): CompanyRecipeDef | null {
  return typeof recipeId === "string" ? (COMPANY_RECIPE_MAP.get(recipeId) ?? null) : null;
}

export function companyInventoryCount(company: Company, itemId: string): number {
  return Math.max(0, Math.floor(company.inventory[itemId] ?? 0));
}

export function addCompanyInventory(
  company: Company,
  itemId: string,
  count: number,
): Company | null {
  if (!Number.isInteger(count) || count <= 0 || !itemById(itemId)) return null;
  const current = companyInventoryCount(company, itemId);
  if (current === 0 && Object.keys(company.inventory).length >= COMPANY_INVENTORY_KIND_LIMIT) {
    return null;
  }
  return {
    ...company,
    inventory: { ...company.inventory, [itemId]: current + count },
  };
}

export function removeCompanyInventory(
  company: Company,
  itemId: string,
  count: number,
): Company | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  const current = companyInventoryCount(company, itemId);
  if (current < count) return null;
  const nextInv = { ...company.inventory };
  if (current === count) {
    delete nextInv[itemId];
  } else {
    nextInv[itemId] = current - count;
  }
  return { ...company, inventory: nextInv };
}

export function laborSpeedMultiplier(onDutyCount: number): number {
  const active = Math.max(0, Math.floor(onDutyCount));
  return Math.min(2.5, 1 + active * 0.2);
}

export type FactoryStartError =
  | "unknown_recipe"
  | "invalid_batches"
  | "job_limit"
  | "not_enough_materials"
  | "not_enough_assets";

export function planFactoryStart(
  company: Company,
  recipeId: unknown,
  batchesRaw: unknown,
  actorDiscordId: string,
  onDutyCount: number,
  now: number,
  jobId: string,
):
  | { company: Company; job: CompanyFactoryJob; entry: CompanyHistoryEntry }
  | { error: FactoryStartError } {
  const recipe = companyRecipeById(recipeId);
  if (!recipe) return { error: "unknown_recipe" };
  if (
    typeof batchesRaw !== "number" ||
    !Number.isInteger(batchesRaw) ||
    batchesRaw < 1 ||
    batchesRaw > COMPANY_BATCH_MAX
  ) {
    return { error: "invalid_batches" };
  }
  if (company.factoryJobs.length >= COMPANY_FACTORY_JOB_LIMIT) {
    return { error: "job_limit" };
  }
  const totalCost = recipe.operatingCost * batchesRaw;
  if (company.assets < totalCost) return { error: "not_enough_assets" };

  let current: Company = company;
  for (const [inputId, needPerBatch] of Object.entries(recipe.inputs)) {
    const removed = removeCompanyInventory(current, inputId, needPerBatch * batchesRaw);
    if (!removed) return { error: "not_enough_materials" };
    current = removed;
  }

  const step = applyLedger(
    current,
    -totalCost,
    `工場稼働経費（${recipe.name}×${batchesRaw}）`,
    actorDiscordId,
    now,
  );
  const speed = laborSpeedMultiplier(onDutyCount);
  const durationMs = Math.max(10_000, Math.round((recipe.durationMs * batchesRaw) / speed));
  const job: CompanyFactoryJob = {
    id: jobId,
    recipeId: recipe.id,
    outputItemId: recipe.outputItemId,
    outputQty: recipe.outputCount * batchesRaw,
    startedAt: now,
    readyAt: now + durationMs,
    cost: totalCost,
  };
  const nextCompany: Company = {
    ...step.company,
    factoryJobs: [...step.company.factoryJobs, job],
    financials: {
      ...step.company.financials,
      totalCost: step.company.financials.totalCost + totalCost,
    },
  };
  return { company: nextCompany, job, entry: step.entry };
}

export type FactoryCollectError = "job_not_found" | "job_not_ready" | "inventory_full";

export function planFactoryCollect(
  company: Company,
  jobId: unknown,
  now: number,
): { company: Company; job: CompanyFactoryJob } | { error: FactoryCollectError } {
  if (typeof jobId !== "string") return { error: "job_not_found" };
  const job = company.factoryJobs.find((j) => j.id === jobId);
  if (!job) return { error: "job_not_found" };
  if (now < job.readyAt) return { error: "job_not_ready" };
  const stocked = addCompanyInventory(company, job.outputItemId, job.outputQty);
  if (!stocked) return { error: "inventory_full" };
  return {
    company: {
      ...stocked,
      factoryJobs: stocked.factoryJobs.filter((j) => j.id !== jobId),
    },
    job,
  };
}

export type BuyOrderCreateError =
  | "unknown_item"
  | "invalid_price"
  | "invalid_qty"
  | "order_limit"
  | "not_enough_assets";

export function planBuyOrderCreate(
  company: Company,
  itemId: unknown,
  unitPriceRaw: unknown,
  targetQtyRaw: unknown,
  actorDiscordId: string,
  now: number,
  orderId: string,
):
  | { company: Company; order: CompanyBuyOrder; entry: CompanyHistoryEntry }
  | { error: BuyOrderCreateError } {
  const item = itemById(itemId);
  if (!item) return { error: "unknown_item" };
  if (
    typeof unitPriceRaw !== "number" ||
    !Number.isInteger(unitPriceRaw) ||
    unitPriceRaw < 1 ||
    unitPriceRaw > COMPANY_BUY_ORDER_PRICE_MAX
  ) {
    return { error: "invalid_price" };
  }
  if (
    typeof targetQtyRaw !== "number" ||
    !Number.isInteger(targetQtyRaw) ||
    targetQtyRaw < 1 ||
    targetQtyRaw > COMPANY_BUY_ORDER_QTY_MAX
  ) {
    return { error: "invalid_qty" };
  }
  if (company.buyOrders.length >= COMPANY_BUY_ORDER_LIMIT) return { error: "order_limit" };
  const totalCost = unitPriceRaw * targetQtyRaw;
  if (company.assets < totalCost) return { error: "not_enough_assets" };

  const step = applyLedger(
    company,
    -totalCost,
    `原材料買取枠確保（${item.name}×${targetQtyRaw}）`,
    actorDiscordId,
    now,
  );
  const order: CompanyBuyOrder = {
    id: orderId,
    itemId: item.id,
    unitPrice: unitPriceRaw,
    targetQty: targetQtyRaw,
    filledQty: 0,
    escrowed: totalCost,
    createdAt: now,
  };
  return {
    company: {
      ...step.company,
      buyOrders: [...step.company.buyOrders, order],
    },
    order,
    entry: step.entry,
  };
}

export type BuyOrderCancelError = "order_not_found";

export function planBuyOrderCancel(
  company: Company,
  orderId: unknown,
  actorDiscordId: string,
  now: number,
):
  | { company: Company; refund: number; entry: CompanyHistoryEntry | null }
  | { error: BuyOrderCancelError } {
  if (typeof orderId !== "string") return { error: "order_not_found" };
  const order = company.buyOrders.find((o) => o.id === orderId);
  if (!order) return { error: "order_not_found" };
  const remaining = Math.max(0, order.targetQty - order.filledQty);
  const refund = Math.min(order.escrowed, remaining * order.unitPrice);
  let next: Company = {
    ...company,
    buyOrders: company.buyOrders.filter((o) => o.id !== orderId),
  };
  let entry: CompanyHistoryEntry | null = null;
  if (refund > 0) {
    const item = itemById(order.itemId);
    const step = applyLedger(
      next,
      refund,
      `原材料買取枠返金（${item?.name ?? order.itemId}）`,
      actorDiscordId,
      now,
    );
    next = step.company;
    entry = step.entry;
  }
  return { company: next, refund, entry };
}

export type BuyOrderFillError =
  | "order_not_found"
  | "invalid_qty"
  | "not_enough_remaining"
  | "inventory_full";

export function planSellToBuyOrder(
  company: Company,
  orderId: unknown,
  qtyRaw: unknown,
):
  | { company: Company; order: CompanyBuyOrder; payout: number; qty: number }
  | { error: BuyOrderFillError } {
  if (typeof orderId !== "string") return { error: "order_not_found" };
  const order = company.buyOrders.find((o) => o.id === orderId);
  if (!order) return { error: "order_not_found" };
  if (typeof qtyRaw !== "number" || !Number.isInteger(qtyRaw) || qtyRaw < 1) {
    return { error: "invalid_qty" };
  }
  const remaining = order.targetQty - order.filledQty;
  if (qtyRaw > remaining) return { error: "not_enough_remaining" };
  const payout = qtyRaw * order.unitPrice;
  if (order.escrowed < payout) return { error: "not_enough_remaining" };

  const stocked = addCompanyInventory(company, order.itemId, qtyRaw);
  if (!stocked) return { error: "inventory_full" };

  const updatedOrder: CompanyBuyOrder = {
    ...order,
    filledQty: order.filledQty + qtyRaw,
    escrowed: order.escrowed - payout,
  };
  const nextOrders =
    updatedOrder.filledQty >= updatedOrder.targetQty
      ? stocked.buyOrders.filter((o) => o.id !== orderId)
      : stocked.buyOrders.map((o) => (o.id === orderId ? updatedOrder : o));

  return {
    company: {
      ...stocked,
      buyOrders: nextOrders,
      financials: {
        ...stocked.financials,
        totalCost: stocked.financials.totalCost + payout,
      },
    },
    order: updatedOrder,
    payout,
    qty: qtyRaw,
  };
}

export function applyCompanyMarketRevenue(
  company: Company,
  netProceeds: number,
  fee: number,
  itemId: string,
  qty: number,
  buyerId: string,
  now: number,
): { company: Company; entry: CompanyHistoryEntry } {
  const item = itemById(itemId);
  const step = applyLedger(
    company,
    netProceeds,
    `市場売却（${item?.name ?? itemId}×${qty}・手数料${fee}）`,
    buyerId,
    now,
  );
  return {
    company: {
      ...step.company,
      financials: {
        ...step.company.financials,
        totalRevenue: step.company.financials.totalRevenue + netProceeds + fee,
        totalCost: step.company.financials.totalCost + fee,
      },
    },
    entry: step.entry,
  };
}
