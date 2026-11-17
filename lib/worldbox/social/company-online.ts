// WORLD BOX（Takasumi 版）会社システムの保存と送金（サーバー専用）。
// 保存先は bot_kv（名前空間 "worldbox_company"):
//   キー = 会社 ID（10文字）        → Company 本体
//   キー = "member:<ownerKey>"     → 会社 ID（所属索引。1人1社の担保）
//   キー = "invite:<コード>"       → CompanyInvite（使い切り・1時間）
//   キー = "product:<商品ID>"      → CompanyProduct 本体
//   キー = "history:<会社ID>"      → CompanyHistoryEntry[]（新しい順）
// 個人残高との金の出入りは経済ブリッジのオプ経由だけ:
//   個人 → 会社（資本金・商品購入）: spend オプ（国庫へ払い込み）
//   会社 → 個人（給料・ボーナス・解散返還）: earn オプ（国庫から払い出し）
// 会社資産は台帳上の数字で、オプの適用と対で増減させる。ゲストは
// submitEconomyOp の入口で guest_not_allowed として終端するため、
// 会社経由でもゲストへ金が渡ることはない（所属自体も Discord 必須）。
import { isBotApiConfigured, kvDelete, kvGet, kvList, kvSet } from "../../bot-api";
import { buildEconomyOp, type EconomyOp } from "../economy/economy-bridge";
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

/** 会社の全レコード（本体・所属索引・招待・商品・履歴）を消す。解散用。 */
export async function deleteCompanyAll(company: Company): Promise<void> {
  if (!isBotApiConfigured()) return;
  try {
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, company.id);
    await kvDelete(WORLDBOX_COMPANY_NAMESPACE, historyKey(company.id));
    for (const m of company.members) {
      await kvDelete(WORLDBOX_COMPANY_NAMESPACE, memberKey(m.ownerKey));
    }
    for (const productId of company.productIds) {
      await kvDelete(WORLDBOX_COMPANY_NAMESPACE, productKey(productId));
    }
    const all = await kvList(WORLDBOX_COMPANY_NAMESPACE);
    for (const [key, raw] of all) {
      if (!key.startsWith("invite:")) continue;
      const invite = parseCompanyInvite(raw);
      if (invite && invite.companyId === company.id) {
        await kvDelete(WORLDBOX_COMPANY_NAMESPACE, key);
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

/** 自分が所属する会社（索引→本体）。索引が腐っていたら掃除する。 */
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

/** 全会社（Cron と会社一覧用）。 */
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

/** 履歴へ追記して保存する。失敗しても台帳の適用は覆さない（表示が正）。 */
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

/** 招待コードを引く。失効していたら消して null（読み取り時の失効）。 */
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

/**
 * 会社の出品中商品（寿命切れは読み取り時に落とす）。
 * 戻り値の expired は呼び出し側が会社の productIds から除いて保存する。
 */
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

// ---- 経済ブリッジへの送金ヘルパー ----

export type CompanyMoneyResult =
  | { state: "done"; op: EconomyOp }
  | { state: "failed" | "pending" | "unavailable"; op?: EconomyOp };

/** 個人 → 国庫の支払い（資本金・商品購入）。終端まで待って結果を返す。 */
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

/** 国庫 → 個人の払い出し（給料・ボーナス・解散返還）。 */
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

// ---- Cron（給料・法人税・失効掃除） ----

export interface CompanyCronResult {
  companies: number;
  salariesPaid: number;
  salariesSkipped: number;
  taxesCollected: number;
  productsExpired: number;
  invitesExpired: number;
}

/**
 * 会社 Cron の1回分（Vercel Cron が毎時呼ぶ）。
 * - 給料: JST 8〜20時台に、その時間のキーが未処理の会社へ支給する。
 *   資産不足の会社は全員スキップ（v3 仕様）。冪等キーは結果によらず
 *   立てる（同じ時間帯の二重支給を防ぐ。翌時は新しいキーになる）。
 * - 法人税: JST 3時間ごとの時間帯に、直近3時間の利益へ累進課税する。
 * - 失効掃除: 期限切れの招待コードと商品を消し、商品は会社の
 *   出品一覧からも落とす。
 */
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

  // 失効した招待コードの掃除（名前空間を1回だけ走査する）。
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

    // 寿命切れ商品の掃除。
    const live = await loadLiveProducts(company, now);
    if (live.expiredIds.length > 0) {
      company = {
        ...company,
        productIds: company.productIds.filter((id) => !live.expiredIds.includes(id)),
      };
      result.productsExpired += live.expiredIds.length;
      dirty = true;
    }

    // 給料（台帳を先に確定させてから earn オプで払い出す）。
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

    // 法人税（直近3時間の利益。資本金の追加は利益に数えない）。
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
