export const COMPANY_NAME_MIN = 4;
export const COMPANY_NAME_MAX = 20;
export const COMPANY_DESCRIPTION_MIN = 5;
export const COMPANY_DESCRIPTION_MAX = 100;
export const COMPANY_CAPITAL_MIN = 100_000;
export const COMPANY_CAPITAL_MAX = 1_000_000;
export const COMPANY_ESTABLISH_TAX_RATE = 0.2;
export const COMPANY_MEMBER_LIMIT = 15;
export const COMPANY_SALARY_MIN = 1_000;
export const COMPANY_SALARY_MAX = 100_000;
export const COMPANY_OWNER_SALARY_MULTIPLIER = 1.15;
export const COMPANY_INCOME_TAX_RATE = 0.15;
export const COMPANY_SALARY_HOUR_START = 8;
export const COMPANY_SALARY_HOUR_END = 20;
export const COMPANY_INVITE_CODE_LENGTH = 10;
export const COMPANY_INVITE_TTL_MS = 3_600_000;
export const COMPANY_PRODUCT_NAME_MAX = 20;
export const COMPANY_PRODUCT_DESCRIPTION_MAX = 50;
export const COMPANY_PRODUCT_CONTENT_MAX = 500;
export const COMPANY_PRODUCT_PRICE_MIN = 100;
export const COMPANY_PRODUCT_PRICE_MAX = 999_999;
export const COMPANY_PRODUCT_CREATE_TAX_RATE = 0.05;
export const COMPANY_PRODUCT_SALE_TAX_RATE = 0.1;
export const COMPANY_DISSOLVE_TAX_RATE = 0.2;
export const COMPANY_PRODUCT_LIMIT = 15;
export const COMPANY_PRODUCT_TTL_MS = 7 * 24 * 3_600_000;
export const COMPANY_BONUS_MIN = 100;
export const COMPANY_BONUS_MAX = 150_000;
export const COMPANY_BONUS_ASSETS_DIVISOR = 10;
export const COMPANY_BONUS_COOLDOWN_MS = 82_800_000;
export const COMPANY_SALARY_CHANGE_COOLDOWN_MS = 24 * 3_600_000;
export const COMPANY_TAX_WINDOW_MS = 3 * 3_600_000;
export const COMPANY_HISTORY_LIMIT = 200;
export const COMPANY_CAPITAL_REASON = "会社の資本金の追加";
export const COMPANY_ESTABLISH_TAX_REASON = "会社設立税の支払い";
export const COMPANY_HQ_RADIUS = 3;
export const COMPANY_WORK_REWARD = 500;
export const COMPANY_WORK_COOLDOWN_MS = 5 * 60_000;
export const COMPANY_DUTY_TTL_MS = 24 * 3_600_000;

export const COMPANY_TAX_BRACKETS: readonly (readonly [number, number])[] = [
  [5_000, 0],
  [10_000, 0.12],
  [30_000, 0.15],
  [50_000, 0.18],
  [80_000, 0.22],
  [100_000, 0.25],
  [200_000, 0.3],
  [300_000, 0.4],
  [400_000, 0.5],
  [500_000, 0.6],
  [Number.POSITIVE_INFINITY, 0.7],
];

export interface CompanyMember {
  ownerKey: string;
  discordId: string;
  name: string;
  joinedAt: number;
}

export interface CompanyStats {
  totalEarn: number;
  totalUse: number;
  totalTax: number;
}

export interface CompanyHq {
  space: string;
  x: number;
  y: number;
}

export interface CompanyDuty {
  companyId: string;
  since: number;
  lastWorkAt: number;
}

export interface CompanySign {
  companyId: string;
  ownerId: string;
}

export interface CompanyFactoryJob {
  id: string;
  recipeId: string;
  outputItemId: string;
  outputQty: number;
  startedAt: number;
  readyAt: number;
  cost: number;
}

export interface CompanyBuyOrder {
  id: string;
  itemId: string;
  unitPrice: number;
  targetQty: number;
  filledQty: number;
  escrowed: number;
  createdAt: number;
}

export interface CompanyIpoInfo {
  ticker: string;
  issuedShares: number;
  publicShares: number;
  ipoPrice: number;
  listedAt: number;
  totalDividendsPaid: number;
}

export interface CompanyFinancials {
  totalRevenue: number;
  totalCost: number;
  totalDividendsPaid: number;
}

export interface Company {
  id: string;
  name: string;
  description: string;
  ownerKey: string;
  assets: number;
  salary: number;
  createdAt: number;
  members: CompanyMember[];
  productIds: string[];
  stats: CompanyStats;
  lastBonusAt: Record<string, number>;
  lastSalaryChangedAt: number;
  lastSalaryKey: string;
  lastTaxKey: string;
  hq: CompanyHq | null;
  inventory: Record<string, number>;
  factoryJobs: CompanyFactoryJob[];
  buyOrders: CompanyBuyOrder[];
  ipo: CompanyIpoInfo | null;
  financials: CompanyFinancials;
}

export interface CompanyHistoryEntry {
  at: number;
  userId: string;
  amount: number;
  reason: string;
}

export interface CompanyProduct {
  id: string;
  companyId: string;
  creatorKey: string;
  creatorName: string;
  name: string;
  description: string;
  content: string;
  price: number;
  createdAt: number;
}

export interface CompanyInvite {
  code: string;
  companyId: string;
  createdAt: number;
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(length: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ID_CHARS[Math.min(ID_CHARS.length - 1, Math.floor(rand() * ID_CHARS.length))];
  }
  return out;
}

export function makeCompanyId(rand: () => number = Math.random): string {
  return randomString(10, rand);
}

export function makeInviteCode(rand: () => number = Math.random): string {
  return randomString(COMPANY_INVITE_CODE_LENGTH, rand);
}

export function makeProductId(rand: () => number = Math.random): string {
  return randomString(8, rand);
}

export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateCompanyName(value: unknown): string | null {
  const name = trimmed(value);
  return name.length >= COMPANY_NAME_MIN && name.length <= COMPANY_NAME_MAX ? name : null;
}

export function validateCompanyDescription(value: unknown): string | null {
  const text = trimmed(value);
  return text.length >= COMPANY_DESCRIPTION_MIN && text.length <= COMPANY_DESCRIPTION_MAX
    ? text
    : null;
}

export function validateCompanyCapital(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= COMPANY_CAPITAL_MIN && value <= COMPANY_CAPITAL_MAX ? value : null;
}

export function validateCompanySalary(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= COMPANY_SALARY_MIN && value <= COMPANY_SALARY_MAX ? value : null;
}

export function validateProductInput(value: {
  name?: unknown;
  description?: unknown;
  content?: unknown;
  price?: unknown;
}): { name: string; description: string; content: string; price: number } | null {
  const name = trimmed(value.name);
  const description = trimmed(value.description);
  const content = trimmed(value.content);
  if (name.length < 1 || name.length > COMPANY_PRODUCT_NAME_MAX) return null;
  if (description.length < 1 || description.length > COMPANY_PRODUCT_DESCRIPTION_MAX) return null;
  if (content.length < 1 || content.length > COMPANY_PRODUCT_CONTENT_MAX) return null;
  if (typeof value.price !== "number" || !Number.isInteger(value.price)) return null;
  if (value.price < COMPANY_PRODUCT_PRICE_MIN || value.price > COMPANY_PRODUCT_PRICE_MAX)
    return null;
  return { name, description, content, price: value.price };
}

function taxOf(amount: number, rate: number): number {
  return Math.floor(amount * rate);
}

export function establishmentTax(capital: number): number {
  return taxOf(capital, COMPANY_ESTABLISH_TAX_RATE);
}

export function incomeTax(amount: number): number {
  return taxOf(amount, COMPANY_INCOME_TAX_RATE);
}

export function productCreateTax(price: number): number {
  return taxOf(price, COMPANY_PRODUCT_CREATE_TAX_RATE);
}

export function productSaleTax(price: number): number {
  return taxOf(price, COMPANY_PRODUCT_SALE_TAX_RATE);
}

export function salaryGrossFor(company: Company, member: CompanyMember): number {
  if (member.ownerKey === company.ownerKey) {
    return Math.floor(company.salary * COMPANY_OWNER_SALARY_MULTIPLIER);
  }
  return company.salary;
}

export function corporateTaxFor(profit: number): number {
  if (!Number.isFinite(profit) || profit <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const [limit, rate] of COMPANY_TAX_BRACKETS) {
    if (profit <= lower) break;
    const band = Math.min(profit, limit) - lower;
    tax += band * rate;
    lower = limit;
  }
  return Math.floor(tax);
}

export function isCompanyOwner(company: Company, ownerKey: string): boolean {
  return company.ownerKey === ownerKey;
}

export function isCompanyMember(company: Company, ownerKey: string): boolean {
  return company.members.some((m) => m.ownerKey === ownerKey);
}

export function memberOf(company: Company, ownerKey: string): CompanyMember | null {
  return company.members.find((m) => m.ownerKey === ownerKey) ?? null;
}

export function applyLedger(
  company: Company,
  amount: number,
  reason: string,
  userId: string,
  now: number,
): { company: Company; entry: CompanyHistoryEntry } {
  const stats: CompanyStats = { ...company.stats };
  if (amount > 0) stats.totalEarn += amount;
  if (amount < 0) {
    stats.totalUse += -amount;
    if (reason.includes("税")) stats.totalTax += -amount;
  }
  const entry: CompanyHistoryEntry = { at: now, userId, amount, reason };
  return {
    company: { ...company, assets: company.assets + amount, stats },
    entry,
  };
}

export function appendHistory(
  history: readonly CompanyHistoryEntry[],
  entries: readonly CompanyHistoryEntry[],
): CompanyHistoryEntry[] {
  return [...entries, ...history].slice(0, COMPANY_HISTORY_LIMIT);
}

export function foundCompany(
  id: string,
  input: { name: string; description: string; capital: number; salary: number },
  owner: CompanyMember,
  now: number,
): { company: Company; history: CompanyHistoryEntry[] } {
  const base: Company = {
    id,
    name: input.name,
    description: input.description,
    ownerKey: owner.ownerKey,
    assets: 0,
    salary: input.salary,
    createdAt: now,
    members: [owner],
    productIds: [],
    stats: { totalEarn: 0, totalUse: 0, totalTax: 0 },
    lastBonusAt: {},
    lastSalaryChangedAt: 0,
    lastSalaryKey: "",
    lastTaxKey: "",
    hq: null,
    inventory: {},
    factoryJobs: [],
    buyOrders: [],
    ipo: null,
    financials: { totalRevenue: 0, totalCost: 0, totalDividendsPaid: 0 },
  };
  const history: CompanyHistoryEntry[] = [];
  let step = applyLedger(base, input.capital, COMPANY_CAPITAL_REASON, owner.discordId, now);
  history.push(step.entry);
  step = applyLedger(
    step.company,
    -establishmentTax(input.capital),
    COMPANY_ESTABLISH_TAX_REASON,
    owner.discordId,
    now,
  );
  history.push(step.entry);
  return { company: step.company, history };
}

export type JoinCompanyError = "full" | "already_member";

export function joinCompany(
  company: Company,
  member: CompanyMember,
): { company: Company } | { error: JoinCompanyError } {
  if (isCompanyMember(company, member.ownerKey)) return { error: "already_member" };
  if (company.members.length >= COMPANY_MEMBER_LIMIT) return { error: "full" };
  return { company: { ...company, members: [...company.members, member] } };
}

export function removeMember(company: Company, ownerKey: string): Company {
  if (ownerKey === company.ownerKey) return company;
  return {
    ...company,
    members: company.members.filter((m) => m.ownerKey !== ownerKey),
    lastBonusAt: Object.fromEntries(
      Object.entries(company.lastBonusAt).filter(([key]) => key !== ownerKey),
    ),
  };
}

export function canDissolve(company: Company, ownerKey: string): boolean {
  return isCompanyOwner(company, ownerKey) && company.members.length === 1;
}

export function canChangeSalary(company: Company, now: number): boolean {
  return (
    !company.lastSalaryChangedAt ||
    now - company.lastSalaryChangedAt >= COMPANY_SALARY_CHANGE_COOLDOWN_MS
  );
}

export function dissolutionPayout(assets: number): { payout: number; tax: number } {
  if (!Number.isFinite(assets) || assets <= 0) return { payout: 0, tax: 0 };
  const safe = Math.floor(assets);
  const tax = taxOf(safe, COMPANY_DISSOLVE_TAX_RATE);
  return { payout: safe - tax, tax };
}

export function isInviteExpired(invite: CompanyInvite, now: number): boolean {
  return now - invite.createdAt >= COMPANY_INVITE_TTL_MS;
}

export function isProductExpired(product: CompanyProduct, now: number): boolean {
  return now - product.createdAt >= COMPANY_PRODUCT_TTL_MS;
}

export function planSalaryRun(
  company: Company,
  now: number,
):
  | { skipped: true }
  | {
      skipped: false;
      company: Company;
      history: CompanyHistoryEntry[];
      payouts: { member: CompanyMember; gross: number; net: number }[];
    } {
  const payouts = company.members.map((member) => {
    const gross = salaryGrossFor(company, member);
    return { member, gross, net: gross - incomeTax(gross) };
  });
  const total = payouts.reduce((sum, p) => sum + p.gross, 0);
  if (company.assets < total) return { skipped: true };
  let current = company;
  const history: CompanyHistoryEntry[] = [];
  for (const p of payouts) {
    const step = applyLedger(current, -p.gross, "給料の支払い", p.member.discordId, now);
    current = step.company;
    history.push(step.entry);
  }
  return { skipped: false, company: current, history, payouts };
}

export function taxableProfit(
  history: readonly CompanyHistoryEntry[],
  windowStart: number,
): number {
  let profit = 0;
  for (const entry of history) {
    if (entry.at < windowStart) continue;
    if (entry.reason === COMPANY_CAPITAL_REASON) continue;
    if (entry.reason === COMPANY_ESTABLISH_TAX_REASON) continue;
    if (entry.reason.includes("法人税")) continue;
    if (entry.reason.includes("IPO公募")) continue;
    if (entry.reason.includes("株主配当")) continue;
    profit += entry.amount;
  }
  return Math.max(0, profit);
}

export function planCorporateTax(
  company: Company,
  profit: number,
  now: number,
): { company: Company; entry: CompanyHistoryEntry; tax: number } | null {
  const tax = corporateTaxFor(profit);
  if (tax <= 0 || company.assets < tax) return null;
  const step = applyLedger(company, -tax, `${profit}コインにかかる法人税の支払い`, "", now);
  return { company: step.company, entry: step.entry, tax };
}

export type BonusError = "invalid_amount" | "cooldown" | "not_member";

export function planBonus(
  company: Company,
  targetKey: string,
  amount: unknown,
  now: number,
):
  | {
      company: Company;
      entry: CompanyHistoryEntry;
      target: CompanyMember;
      gross: number;
      net: number;
    }
  | { error: BonusError } {
  const target = memberOf(company, targetKey);
  if (!target) return { error: "not_member" };
  if (typeof amount !== "number" || !Number.isInteger(amount)) return { error: "invalid_amount" };
  const cap = Math.min(
    COMPANY_BONUS_MAX,
    Math.floor(company.assets / COMPANY_BONUS_ASSETS_DIVISOR),
  );
  if (amount < COMPANY_BONUS_MIN || amount > cap) return { error: "invalid_amount" };
  const last = company.lastBonusAt[targetKey] ?? 0;
  if (now - last < COMPANY_BONUS_COOLDOWN_MS) return { error: "cooldown" };
  const step = applyLedger(
    company,
    -amount,
    `（${target.name}）へのボーナスの支払い`,
    target.discordId,
    now,
  );
  const next: Company = {
    ...step.company,
    lastBonusAt: { ...step.company.lastBonusAt, [targetKey]: now },
  };
  return {
    company: next,
    entry: step.entry,
    target,
    gross: amount,
    net: amount - incomeTax(amount),
  };
}

export type ProductCreateError = "limit" | "tax_unaffordable";

export function planProductCreate(
  company: Company,
  product: CompanyProduct,
  now: number,
): { company: Company; entry: CompanyHistoryEntry } | { error: ProductCreateError } {
  if (company.productIds.length >= COMPANY_PRODUCT_LIMIT) return { error: "limit" };
  const tax = productCreateTax(product.price);
  if (company.assets < tax) return { error: "tax_unaffordable" };
  const creatorId = memberOf(company, product.creatorKey)?.discordId ?? "";
  const step = applyLedger(company, -tax, "商品作成税", creatorId, now);
  const withProduct: Company = {
    ...step.company,
    productIds: [...step.company.productIds, product.id],
  };
  return { company: withProduct, entry: step.entry };
}

export function planProductSale(
  company: Company,
  product: CompanyProduct,
  buyerDiscordId: string,
  now: number,
): { company: Company; history: CompanyHistoryEntry[] } {
  const history: CompanyHistoryEntry[] = [];
  let step = applyLedger(
    company,
    product.price,
    `商品（${product.name}）の売却`,
    buyerDiscordId,
    now,
  );
  history.push(step.entry);
  step = applyLedger(step.company, -productSaleTax(product.price), "商品売却税", "", now);
  history.push(step.entry);
  const next: Company = {
    ...step.company,
    productIds: step.company.productIds.filter((id) => id !== product.id),
  };
  return { company: next, history };
}

export function workRewardFor(_company?: Company): number {
  return COMPANY_WORK_REWARD;
}

export function isNearHq(hq: CompanyHq | null, space: string, x: number, y: number): boolean {
  if (!hq || hq.space !== space) return false;
  return Math.max(Math.abs(x - hq.x), Math.abs(y - hq.y)) <= COMPANY_HQ_RADIUS;
}

export function isDutyActive(
  duty: CompanyDuty | null,
  companyId: string,
  now: number,
): duty is CompanyDuty {
  if (!duty || duty.companyId !== companyId) return false;
  return now - duty.since < COMPANY_DUTY_TTL_MS;
}

export type WorkError = "cooldown";

export function planWork(
  company: Company,
  member: CompanyMember,
  duty: CompanyDuty,
  now: number,
):
  | { company: Company; entry: CompanyHistoryEntry; duty: CompanyDuty; reward: number }
  | { error: WorkError; nextWorkAt: number } {
  if (duty.lastWorkAt > 0 && now - duty.lastWorkAt < COMPANY_WORK_COOLDOWN_MS) {
    return { error: "cooldown", nextWorkAt: duty.lastWorkAt + COMPANY_WORK_COOLDOWN_MS };
  }
  const reward = workRewardFor(company);
  const step = applyLedger(company, reward, `勤務報酬（${member.name}）`, member.discordId, now);
  return {
    company: step.company,
    entry: step.entry,
    duty: { ...duty, lastWorkAt: now },
    reward,
  };
}

const JST_OFFSET_MS = 9 * 3_600_000;

function jstParts(now: number): { date: string; hour: number } {
  const jst = new Date(now + JST_OFFSET_MS);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, hour: jst.getUTCHours() };
}

export function isSalaryHour(now: number): boolean {
  const { hour } = jstParts(now);
  return hour >= COMPANY_SALARY_HOUR_START && hour <= COMPANY_SALARY_HOUR_END;
}

export function salaryRunKey(now: number): string {
  const { date, hour } = jstParts(now);
  return `${date}T${String(hour).padStart(2, "0")}`;
}

export function isTaxHour(now: number): boolean {
  return jstParts(now).hour % 3 === 0;
}

export function taxRunKey(now: number): string {
  const { date, hour } = jstParts(now);
  const start = hour - (hour % 3);
  return `${date}T${String(start).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function parseCompany(raw: unknown): Company | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (!isCompanyId(data.id)) return null;
  if (typeof data.name !== "string" || typeof data.ownerKey !== "string") return null;
  if (!Array.isArray(data.members) || data.members.length === 0) return null;
  const members: CompanyMember[] = [];
  for (const m of data.members) {
    const mm = asRecord(m);
    if (!mm || typeof mm.ownerKey !== "string" || typeof mm.discordId !== "string") return null;
    members.push({
      ownerKey: mm.ownerKey,
      discordId: mm.discordId,
      name: typeof mm.name === "string" ? mm.name.slice(0, 40) : "",
      joinedAt: asInt(mm.joinedAt),
    });
  }
  if (!members.some((m) => m.ownerKey === data.ownerKey)) return null;
  const statsRaw = asRecord(data.stats);
  const lastBonusAt: Record<string, number> = {};
  const bonusRaw = asRecord(data.lastBonusAt);
  if (bonusRaw) {
    for (const [key, value] of Object.entries(bonusRaw)) {
      if (typeof value === "number" && Number.isFinite(value)) lastBonusAt[key] = Math.trunc(value);
    }
  }
  const inventory: Record<string, number> = {};
  const invRaw = asRecord(data.inventory);
  if (invRaw) {
    for (const [itemId, qty] of Object.entries(invRaw)) {
      if (typeof qty === "number" && Number.isFinite(qty) && Math.floor(qty) > 0) {
        inventory[itemId] = Math.floor(qty);
      }
    }
  }
  const factoryJobs: CompanyFactoryJob[] = [];
  if (Array.isArray(data.factoryJobs)) {
    for (const rawJob of data.factoryJobs.slice(0, 20)) {
      const j = asRecord(rawJob);
      if (!j) continue;
      if (
        typeof j.id !== "string" ||
        typeof j.recipeId !== "string" ||
        typeof j.outputItemId !== "string"
      ) {
        continue;
      }
      const outputQty = Math.max(1, asInt(j.outputQty));
      factoryJobs.push({
        id: j.id.slice(0, 40),
        recipeId: j.recipeId.slice(0, 40),
        outputItemId: j.outputItemId.slice(0, 40),
        outputQty,
        startedAt: Math.max(0, asInt(j.startedAt)),
        readyAt: Math.max(0, asInt(j.readyAt)),
        cost: Math.max(0, asInt(j.cost)),
      });
    }
  }
  const buyOrders: CompanyBuyOrder[] = [];
  if (Array.isArray(data.buyOrders)) {
    for (const rawOrder of data.buyOrders.slice(0, 20)) {
      const o = asRecord(rawOrder);
      if (!o || typeof o.id !== "string" || typeof o.itemId !== "string") continue;
      const unitPrice = Math.max(1, asInt(o.unitPrice));
      const targetQty = Math.max(1, asInt(o.targetQty));
      const filledQty = Math.max(0, Math.min(targetQty, asInt(o.filledQty)));
      buyOrders.push({
        id: o.id.slice(0, 40),
        itemId: o.itemId.slice(0, 40),
        unitPrice,
        targetQty,
        filledQty,
        escrowed: Math.max(0, asInt(o.escrowed)),
        createdAt: Math.max(0, asInt(o.createdAt)),
      });
    }
  }
  const ipoRaw = asRecord(data.ipo);
  let ipo: CompanyIpoInfo | null = null;
  if (
    ipoRaw &&
    typeof ipoRaw.ticker === "string" &&
    /^[A-Z0-9]{2,8}$/.test(ipoRaw.ticker) &&
    asInt(ipoRaw.issuedShares) > 0
  ) {
    ipo = {
      ticker: ipoRaw.ticker,
      issuedShares: Math.max(1, asInt(ipoRaw.issuedShares)),
      publicShares: Math.max(0, asInt(ipoRaw.publicShares)),
      ipoPrice: Math.max(1, asInt(ipoRaw.ipoPrice, 1)),
      listedAt: Math.max(0, asInt(ipoRaw.listedAt)),
      totalDividendsPaid: Math.max(0, asInt(ipoRaw.totalDividendsPaid)),
    };
  }
  const finRaw = asRecord(data.financials);
  const financials: CompanyFinancials = {
    totalRevenue: Math.max(0, asInt(finRaw?.totalRevenue)),
    totalCost: Math.max(0, asInt(finRaw?.totalCost)),
    totalDividendsPaid: Math.max(0, asInt(finRaw?.totalDividendsPaid)),
  };
  return {
    id: data.id,
    name: data.name.slice(0, COMPANY_NAME_MAX),
    description:
      typeof data.description === "string"
        ? data.description.slice(0, COMPANY_DESCRIPTION_MAX)
        : "",
    ownerKey: data.ownerKey,
    assets: Math.max(0, asInt(data.assets)),
    salary: asInt(data.salary, COMPANY_SALARY_MIN),
    createdAt: asInt(data.createdAt),
    members: members.slice(0, COMPANY_MEMBER_LIMIT),
    productIds: Array.isArray(data.productIds)
      ? data.productIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, COMPANY_PRODUCT_LIMIT)
      : [],
    stats: {
      totalEarn: asInt(statsRaw?.totalEarn),
      totalUse: asInt(statsRaw?.totalUse),
      totalTax: asInt(statsRaw?.totalTax),
    },
    lastBonusAt,
    lastSalaryChangedAt: Math.max(0, asInt(data.lastSalaryChangedAt)),
    lastSalaryKey: typeof data.lastSalaryKey === "string" ? data.lastSalaryKey : "",
    lastTaxKey: typeof data.lastTaxKey === "string" ? data.lastTaxKey : "",
    hq: parseCompanyHq(data.hq),
    inventory,
    factoryJobs,
    buyOrders,
    ipo,
    financials,
  };
}

export function parseCompanyHq(raw: unknown): CompanyHq | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (typeof data.space !== "string" || data.space.length === 0 || data.space.length > 32) {
    return null;
  }
  const x = asInt(data.x, Number.NaN);
  const y = asInt(data.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) return null;
  return { space: data.space, x, y };
}

export function parseCompanyDuty(raw: unknown): CompanyDuty | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (!isCompanyId(data.companyId)) return null;
  return {
    companyId: data.companyId,
    since: asInt(data.since),
    lastWorkAt: asInt(data.lastWorkAt),
  };
}

export function parseCompanySign(raw: unknown): CompanySign | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (!isCompanyId(data.companyId)) return null;
  if (typeof data.ownerId !== "string" || data.ownerId.length === 0) return null;
  return { companyId: data.companyId, ownerId: data.ownerId };
}

export function parseCompanyProduct(raw: unknown): CompanyProduct | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (typeof data.id !== "string" || !isCompanyId(data.companyId)) return null;
  if (typeof data.creatorKey !== "string" || typeof data.name !== "string") return null;
  const price = asInt(data.price);
  if (price < COMPANY_PRODUCT_PRICE_MIN) return null;
  return {
    id: data.id,
    companyId: data.companyId,
    creatorKey: data.creatorKey,
    creatorName: typeof data.creatorName === "string" ? data.creatorName.slice(0, 40) : "",
    name: data.name.slice(0, COMPANY_PRODUCT_NAME_MAX),
    description:
      typeof data.description === "string"
        ? data.description.slice(0, COMPANY_PRODUCT_DESCRIPTION_MAX)
        : "",
    content:
      typeof data.content === "string" ? data.content.slice(0, COMPANY_PRODUCT_CONTENT_MAX) : "",
    price,
    createdAt: asInt(data.createdAt),
  };
}

export function parseCompanyInvite(raw: unknown): CompanyInvite | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (typeof data.code !== "string" || !isCompanyId(data.companyId)) return null;
  return { code: data.code, companyId: data.companyId, createdAt: asInt(data.createdAt) };
}

export function parseCompanyHistory(raw: unknown): CompanyHistoryEntry[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: CompanyHistoryEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.reason !== "string") continue;
    out.push({
      at: asInt(record.at),
      userId: typeof record.userId === "string" ? record.userId : "",
      amount: asInt(record.amount),
      reason: record.reason.slice(0, 80),
    });
  }
  return out.slice(0, COMPANY_HISTORY_LIMIT);
}
