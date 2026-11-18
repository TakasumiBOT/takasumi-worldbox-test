import { isBotApiConfigured, kvDelete, kvGet, kvList, kvSet } from "../../bot-api";
import { parseSave } from "../core/save";
import { loadWorldBoxSave } from "../core/save-online";
import { buildEconomyOp, type EconomyOp } from "../economy/economy-bridge";
import { loadMyPresence } from "../player/presence-online";
import {
  submitEconomyOp,
  waitForOpDone,
  type SubmitEconomyOpResult,
} from "../economy/economy-bridge-online";
import {
  appendHistory,
  isCompanyId,
  isInviteExpired,
  isProductExpired,
  isSalaryHour,
  isTaxHour,
  parseCompany,
  parseCompanyDuty,
  parseCompanySign,
  parseCompanyHistory,
  parseCompanyInvite,
  parseCompanyProduct,
  planCorporateTax,
  planSalaryRun,
  salaryRunKey,
  taxRunKey,
  taxableProfit,
  COMPANY_TAX_WINDOW_MS,
  type Company,
  type CompanyDuty,
  type CompanySign,
  type CompanyHistoryEntry,
  type CompanyInvite,
  type CompanyProduct,
} from "./company";

export const WORLDBOX_COMPANY_NAMESPACE = "worldbox_company";

function memberKey(ownerKey: string): string {
  return `member:${ownerKey}`;
}
function inviteKey(code: string): string {
  return `invite:${code}`;
}
function productKey(productId: string): string {
  return `product:${productId}`;
}
function historyKey(companyId: string): string {
  return `history:${companyId}`;
}
function dutyKey(ownerKey: string): string {
  return `duty:${ownerKey}`;
}
function signKey(x: number, y: number): string {
  return `sign:${x},${y}`;
}

async function kvGetString(namespace: string, key: string): Promise<string | null> {
  const raw = await kvGet(namespace, key);
  if (raw === null || raw === undefined) return null;
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

export function isCompanyEnabled(): boolean {
  return isBotApiConfigured();
}

export async function loadCompany(companyId: string): Promise<Company | null> {
  if (!isBotApiConfigured() || !isCompanyId(companyId)) return null;
  try {
    return parseCompany(await kvGetString(WORLDBOX_COMPANY_NAMESPACE, companyId));
  } catch {
    return null;
  }
}

export async function storeCompany(company: Company): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_COMPANY_NAMESPACE, company.id, JSON.stringify(company));
    for (const m of company.members) {
      await kvSet(WORLDBOX_COMPANY_NAMESPACE, memberKey(m.ownerKey), company.id);
    }
    return true;
  } catch {
    return false;
  }
}

export async function deleteCompanyAll(company: Company): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, company.id);
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, historyKey(company.id));
    for (const m of company.members) {
      await kvDelete(WORLDBOX_COMPANY_NAMESPACE, memberKey(m.ownerKey));
      await kvDelete(WORLDBOX_COMPANY_NAMESPACE, dutyKey(m.ownerKey));
    }
    for (const productId of company.productIds) {
      await kvDelete(WORLDBOX_COMPANY_NAMESPACE, productKey(productId));
    }
    const all = await kvList(WORLDBOX_COMPANY_NAMESPACE);
    for (const [key, raw] of all) {
      if (key.startsWith("invite:")) {
        const invite = parseCompanyInvite(raw);
        if (invite && invite.companyId === company.id) {
          await kvDelete(WORLDBOX_COMPANY_NAMESPACE, key);
        }
      } else if (key.startsWith("sign:")) {
        const sign = parseCompanySign(raw);
        if (sign && sign.companyId === company.id) {
          await kvDelete(WORLDBOX_COMPANY_NAMESPACE, key);
        }
      }
    }
  } catch {
    /* ベストエフォート */
  }
}

export async function clearMemberIndex(ownerKey: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, memberKey(ownerKey));
  } catch {
    /* ベストエフォート */
  }
}

export async function loadCompanyOf(ownerKey: string): Promise<Company | null> {
  if (!isBotApiConfigured()) return null;
  try {
    const id = await kvGetString(WORLDBOX_COMPANY_NAMESPACE, memberKey(ownerKey));
    if (!id) return null;
    const company = await loadCompany(id);
    if (!company || !company.members.some((m) => m.ownerKey === ownerKey)) {
      await clearMemberIndex(ownerKey);
      return null;
    }
    return company;
  } catch {
    return null;
  }
}

export async function loadAllCompanies(): Promise<Company[]> {
  if (!isBotApiConfigured()) return [];
  try {
    const all = await kvList(WORLDBOX_COMPANY_NAMESPACE);
    const out: Company[] = [];
    for (const [key, raw] of all) {
      if (!isCompanyId(key)) continue;
      const company = parseCompany(raw);
      if (company) out.push(company);
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadCompanyHistory(companyId: string): Promise<CompanyHistoryEntry[]> {
  if (!isBotApiConfigured()) return [];
  try {
    return parseCompanyHistory(
      await kvGetString(WORLDBOX_COMPANY_NAMESPACE, historyKey(companyId)),
    );
  } catch {
    return [];
  }
}

export async function appendCompanyHistory(
  companyId: string,
  entries: readonly CompanyHistoryEntry[],
): Promise<void> {
  if (!isBotApiConfigured() || entries.length === 0) return;
  try {
    const current = await loadCompanyHistory(companyId);
    await kvSet(
      WORLDBOX_COMPANY_NAMESPACE,
      historyKey(companyId),
      JSON.stringify(appendHistory(current, entries)),
    );
  } catch {
    /* ベストエフォート */
  }
}

export async function storeInvite(invite: CompanyInvite): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_COMPANY_NAMESPACE, inviteKey(invite.code), JSON.stringify(invite));
    return true;
  } catch {
    return false;
  }
}

export async function loadInvite(code: string, now: number): Promise<CompanyInvite | null> {
  if (!isBotApiConfigured() || !code) return null;
  try {
    const invite = parseCompanyInvite(
      await kvGetString(WORLDBOX_COMPANY_NAMESPACE, inviteKey(code)),
    );
    if (!invite) return null;
    if (isInviteExpired(invite, now)) {
      await deleteInvite(code);
      return null;
    }
    return invite;
  } catch {
    return null;
  }
}

export async function deleteInvite(code: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, inviteKey(code));
  } catch {
    /* ベストエフォート */
  }
}

export async function storeProduct(product: CompanyProduct): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_COMPANY_NAMESPACE, productKey(product.id), JSON.stringify(product));
    return true;
  } catch {
    return false;
  }
}

export async function loadProduct(productId: string): Promise<CompanyProduct | null> {
  if (!isBotApiConfigured() || !productId) return null;
  try {
    return parseCompanyProduct(
      await kvGetString(WORLDBOX_COMPANY_NAMESPACE, productKey(productId)),
    );
  } catch {
    return null;
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, productKey(productId));
  } catch {
    /* ベストエフォート */
  }
}

export async function loadLiveProducts(
  company: Company,
  now: number,
): Promise<{ products: CompanyProduct[]; expiredIds: string[] }> {
  const products: CompanyProduct[] = [];
  const expiredIds: string[] = [];
  for (const id of company.productIds) {
    const product = await loadProduct(id);
    if (!product) {
      expiredIds.push(id);
      continue;
    }
    if (isProductExpired(product, now)) {
      expiredIds.push(id);
      await deleteProduct(id);
      continue;
    }
    products.push(product);
  }
  return { products, expiredIds };
}

export type CompanyMoneyResult =
  | { state: "done"; op: EconomyOp }
  | { state: "failed" | "pending" | "unavailable"; op?: EconomyOp };

export async function chargeUser(
  ownerKey: string,
  discordId: string,
  amount: number,
  reason: string,
): Promise<CompanyMoneyResult> {
  const op = buildEconomyOp(
    { kind: "spend", userKey: ownerKey, discordId, amount, reason },
    crypto.randomUUID(),
    Date.now(),
  );
  if (!op) return { state: "failed" };
  const submitted: SubmitEconomyOpResult = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return { state: "unavailable" };
  if (submitted.state !== "pending") return { state: submitted.state, op: submitted.op };
  const waited = await waitForOpDone(ownerKey, op.id);
  if (!waited) return { state: "pending", op: submitted.op };
  return { state: waited.status === "done" ? "done" : waited.status, op: waited };
}

export async function payOutToUser(
  ownerKey: string,
  discordId: string,
  amount: number,
  reason: string,
): Promise<CompanyMoneyResult> {
  const op = buildEconomyOp(
    { kind: "earn", userKey: ownerKey, discordId, amount, reason },
    crypto.randomUUID(),
    Date.now(),
  );
  if (!op) return { state: "failed" };
  const submitted: SubmitEconomyOpResult = await submitEconomyOp(op);
  if (submitted.state === "unavailable") return { state: "unavailable" };
  if (submitted.state !== "pending") return { state: submitted.state, op: submitted.op };
  const waited = await waitForOpDone(ownerKey, op.id);
  if (!waited) return { state: "pending", op: submitted.op };
  return { state: waited.status === "done" ? "done" : waited.status, op: waited };
}

export async function loadActorPosition(
  ownerKey: string,
): Promise<{ space: string; tx: number; ty: number } | null> {
  const presence = await loadMyPresence(ownerKey);
  if (presence) {
    return { space: presence.space, tx: Math.floor(presence.x), ty: Math.floor(presence.y) };
  }
  const saved = parseSave(await loadWorldBoxSave(ownerKey));
  if (saved) return { space: saved.space, tx: Math.floor(saved.x), ty: Math.floor(saved.y) };
  return null;
}

export async function loadDuty(ownerKey: string): Promise<CompanyDuty | null> {
  if (!isBotApiConfigured()) return null;
  try {
    return parseCompanyDuty(await kvGetString(WORLDBOX_COMPANY_NAMESPACE, dutyKey(ownerKey)));
  } catch {
    return null;
  }
}

export async function storeDuty(ownerKey: string, duty: CompanyDuty): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_COMPANY_NAMESPACE, dutyKey(ownerKey), JSON.stringify(duty));
    return true;
  } catch {
    return false;
  }
}

export async function deleteDuty(ownerKey: string): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, dutyKey(ownerKey));
  } catch {
    /* ベストエフォート */
  }
}

export async function loadSignCompany(x: number, y: number): Promise<CompanySign | null> {
  if (!isBotApiConfigured()) return null;
  try {
    return parseCompanySign(await kvGetString(WORLDBOX_COMPANY_NAMESPACE, signKey(x, y)));
  } catch {
    return null;
  }
}

export async function storeSignCompany(x: number, y: number, sign: CompanySign): Promise<boolean> {
  if (!isBotApiConfigured()) return false;
  try {
    await kvSet(WORLDBOX_COMPANY_NAMESPACE, signKey(x, y), JSON.stringify(sign));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSignCompany(x: number, y: number): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, signKey(x, y));
  } catch {
    /* ベストエフォート */
  }
}

export async function loadHqList(
  space: string,
): Promise<{ id: string; name: string; x: number; y: number }[]> {
  const companies = await loadAllCompanies();
  const out: { id: string; name: string; x: number; y: number }[] = [];
  for (const company of companies) {
    if (company.hq && company.hq.space === space) {
      out.push({ id: company.id, name: company.name, x: company.hq.x, y: company.hq.y });
    }
  }
  return out;
}

export interface CompanyCronResult {
  companies: number;
  salariesPaid: number;
  salariesSkipped: number;
  taxesCollected: number;
  productsExpired: number;
  invitesExpired: number;
}

export async function runCompanyCron(now: number): Promise<CompanyCronResult> {
  const result: CompanyCronResult = {
    companies: 0,
    salariesPaid: 0,
    salariesSkipped: 0,
    taxesCollected: 0,
    productsExpired: 0,
    invitesExpired: 0,
  };
  if (!isBotApiConfigured()) return result;

  try {
    const all = await kvList(WORLDBOX_COMPANY_NAMESPACE);
    for (const [key, raw] of all) {
      if (!key.startsWith("invite:")) continue;
      const invite = parseCompanyInvite(raw);
      if (invite && isInviteExpired(invite, now)) {
        await kvDelete(WORLDBOX_COMPANY_NAMESPACE, key);
        result.invitesExpired += 1;
      }
    }
  } catch {
    /* ベストエフォート: 本処理は続ける */
  }

  const companies = await loadAllCompanies();
  result.companies = companies.length;
  const salaryKey = salaryRunKey(now);
  const taxKey = taxRunKey(now);
  const doSalary = isSalaryHour(now);
  const doTax = isTaxHour(now);

  for (const initial of companies) {
    let company = initial;
    const historyEntries: CompanyHistoryEntry[] = [];
    let dirty = false;

    const live = await loadLiveProducts(company, now);
    if (live.expiredIds.length > 0) {
      company = {
        ...company,
        productIds: company.productIds.filter((id) => !live.expiredIds.includes(id)),
      };
      result.productsExpired += live.expiredIds.length;
      dirty = true;
    }

    let payouts: { ownerKey: string; discordId: string; net: number }[] = [];
    if (doSalary && company.lastSalaryKey !== salaryKey) {
      const plan = planSalaryRun(company, now);
      company = { ...company, lastSalaryKey: salaryKey };
      dirty = true;
      if (plan.skipped) {
        result.salariesSkipped += 1;
      } else {
        company = { ...plan.company, lastSalaryKey: salaryKey };
        historyEntries.push(...plan.history);
        payouts = plan.payouts.map((p) => ({
          ownerKey: p.member.ownerKey,
          discordId: p.member.discordId,
          net: p.net,
        }));
        result.salariesPaid += 1;
      }
    }

    if (doTax && company.lastTaxKey !== taxKey) {
      const history = await loadCompanyHistory(company.id);
      const profit = taxableProfit(history, now - COMPANY_TAX_WINDOW_MS);
      const plan = planCorporateTax(company, profit, now);
      company = { ...company, lastTaxKey: taxKey };
      dirty = true;
      if (plan) {
        company = { ...plan.company, lastTaxKey: taxKey };
        historyEntries.push(plan.entry);
        result.taxesCollected += 1;
      }
    }

    if (dirty) await storeCompany(company);
    if (historyEntries.length > 0) await appendCompanyHistory(company.id, historyEntries);
    for (const payout of payouts) {
      if (payout.net > 0) {
        await payOutToUser(payout.ownerKey, payout.discordId, payout.net, "company_salary");
      }
    }
  }
  return result;
}
