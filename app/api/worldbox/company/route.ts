import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import { ECONOMY_AMOUNT_MAX } from "@/lib/worldbox/economy/economy-bridge";
import {
  canDissolve,
  foundCompany,
  isCompanyOwner,
  isProductExpired,
  joinCompany,
  makeCompanyId,
  makeInviteCode,
  makeProductId,
  planBonus,
  planProductCreate,
  planProductSale,
  removeMember,
  validateCompanyCapital,
  validateCompanyDescription,
  validateCompanyName,
  validateCompanySalary,
  validateProductInput,
  COMPANY_INVITE_TTL_MS,
  type Company,
  type CompanyMember,
  type CompanyProduct,
} from "@/lib/worldbox/social/company";
import {
  appendCompanyHistory,
  chargeUser,
  deleteCompanyAll,
  deleteInvite,
  deleteProduct,
  isCompanyEnabled,
  loadAllCompanies,
  loadCompany,
  loadCompanyHistory,
  loadCompanyOf,
  loadInvite,
  loadLiveProducts,
  loadProduct,
  payOutToUser,
  clearMemberIndex,
  storeCompany,
  storeInvite,
  storeProduct,
} from "@/lib/worldbox/social/company-online";

export const runtime = "nodejs";

// WORLD BOX（Takasumi 版）の会社システム。
// GET: 自分の会社（資産・メンバー・履歴・出品）と全会社の一覧・残高。
//   ?id=<会社ID> で他社の詳細（出品一覧。内容テキストは含めない）。
// POST: 会社の全操作（設立・招待・入社・脱退・解雇・設定・ボーナス・
//   商品の作成と購入・解散）。お金の個人残高との出入りは経済ブリッジ
//   のオプ経由だけ（company-online.ts）。会社所属は Discord ログイン
//   必須（ゲストはオプの入口でも guest_not_allowed で終端する）。

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const HISTORY_VIEW_LIMIT = 30;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

function err(error: string, status = 409) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function productView(product: CompanyProduct) {
  return {
    id: product.id,
    companyId: product.companyId,
    creatorName: product.creatorName,
    name: product.name,
    description: product.description,
    price: product.price,
    createdAt: product.createdAt,
  };
}

function companyView(
  company: Company,
  products: CompanyProduct[],
  history: { at: number; amount: number; reason: string }[],
  viewerKey: string,
) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    assets: company.assets,
    salary: company.salary,
    createdAt: company.createdAt,
    isOwner: company.ownerKey === viewerKey,
    isMember: company.members.some((m) => m.ownerKey === viewerKey),
    members: company.members.map((m) => ({
      ownerKey: m.ownerKey,
      name: m.name,
      joinedAt: m.joinedAt,
      owner: m.ownerKey === company.ownerKey,
    })),
    stats: company.stats,
    products: products.map(productView),
    history,
  };
}

function companySummary(company: Company) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    assets: company.assets,
    salary: company.salary,
    memberCount: company.members.length,
    productCount: company.productIds.length,
    createdAt: company.createdAt,
  };
}

/** 寿命切れ商品を会社の出品一覧から落とした最新状態を返す。 */
async function pruneExpiredProducts(company: Company, now: number): Promise<Company> {
  const live = await loadLiveProducts(company, now);
  if (live.expiredIds.length === 0) return company;
  const next: Company = {
    ...company,
    productIds: company.productIds.filter((id) => !live.expiredIds.includes(id)),
  };
  await storeCompany(next);
  return next;
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const ownerKey = sessionOwnerKey(session);
  if (session.provider === "guest") {
    return NextResponse.json(
      { guest: true, company: null, companies: [], balance: null, detail: null },
      { headers: NO_STORE },
    );
  }
  if (!isCompanyEnabled()) return err("company_unavailable", 503);
  const now = Date.now();
  const url = new URL(request.url);
  const detailId = url.searchParams.get("id");

  let detail = null;
  if (detailId) {
    const target = await loadCompany(detailId);
    if (target) {
      const pruned = await pruneExpiredProducts(target, now);
      const { products } = await loadLiveProducts(pruned, now);
      const history = (await loadCompanyHistory(pruned.id)).slice(0, HISTORY_VIEW_LIMIT);
      detail = companyView(pruned, products, history, ownerKey);
    }
  }

  const mine = await loadCompanyOf(ownerKey);
  let company = null;
  if (mine) {
    const pruned = await pruneExpiredProducts(mine, now);
    const { products } = await loadLiveProducts(pruned, now);
    const history = (await loadCompanyHistory(pruned.id)).slice(0, HISTORY_VIEW_LIMIT);
    company = companyView(pruned, products, history, ownerKey);
  }
  const companies = (await loadAllCompanies()).map(companySummary);
  const balance = await readUserBalance(session.id);
  return NextResponse.json(
    { guest: false, company, companies, balance, detail },
    { headers: NO_STORE },
  );
}

interface CompanyActor {
  ownerKey: string;
  discordId: string;
  name: string;
}

function memberStub(actor: CompanyActor, now: number): CompanyMember {
  return { ownerKey: actor.ownerKey, discordId: actor.discordId, name: actor.name, joinedAt: now };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (session.provider === "guest") return err("guest_not_allowed", 403);
  if (!isCompanyEnabled()) return err("company_unavailable", 503);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }
  const actor: CompanyActor = {
    ownerKey: sessionOwnerKey(session),
    discordId: session.id,
    name: session.username ?? "",
  };
  const now = Date.now();
  const action = body.action;

  if (action === "create") {
    return withUserLock(actor.ownerKey, async () => {
      const name = validateCompanyName(body.name);
      if (name === null) return err("invalid_name", 400);
      const description = validateCompanyDescription(body.description);
      if (description === null) return err("invalid_description", 400);
      const capital = validateCompanyCapital(body.capital);
      if (capital === null) return err("invalid_capital", 400);
      const salary = validateCompanySalary(body.salary);
      if (salary === null) return err("invalid_salary", 400);
      if (await loadCompanyOf(actor.ownerKey)) return err("already_in_company");
      const balance = await readUserBalance(actor.discordId);
      if (balance === null) return err("economy_unavailable", 503);
      if (balance < capital) return err("not_enough_coins");
      const charged = await chargeUser(actor.ownerKey, actor.discordId, capital, "company_capital");
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") {
        return err(
          charged.op?.error === "insufficient_funds" ? "not_enough_coins" : "economy_failed",
        );
      }
      let id = makeCompanyId();
      for (let i = 0; i < 5 && (await loadCompany(id)); i++) id = makeCompanyId();
      const founded = foundCompany(
        id,
        { name, description, capital, salary },
        memberStub(actor, now),
        now,
      );
      if (!(await storeCompany(founded.company))) return err("store_failed", 503);
      await appendCompanyHistory(id, founded.history);
      return NextResponse.json({ ok: true, companyId: id }, { headers: NO_STORE });
    });
  }

  if (action === "join") {
    return withUserLock(actor.ownerKey, async () => {
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      if (!code) return err("invalid_code", 400);
      const invite = await loadInvite(code, now);
      if (!invite) return err("invalid_code");
      const company = await loadCompany(invite.companyId);
      if (!company) {
        await deleteInvite(code);
        return err("invalid_code");
      }
      if (await loadCompanyOf(actor.ownerKey)) return err("already_in_company");
      return withUserLock(`company:${company.id}`, async () => {
        const fresh = await loadCompany(company.id);
        if (!fresh) return err("invalid_code");
        const joined = joinCompany(fresh, memberStub(actor, now));
        if ("error" in joined)
          return err(joined.error === "full" ? "company_full" : "already_in_company");
        if (!(await storeCompany(joined.company))) return err("store_failed", 503);
        await deleteInvite(code);
        return NextResponse.json({ ok: true, companyId: company.id }, { headers: NO_STORE });
      });
    });
  }

  // 以降は自分の会社に対する操作。
  const mine = await loadCompanyOf(actor.ownerKey);

  if (action === "leave") {
    if (!mine) return NextResponse.json({ ok: true }, { headers: NO_STORE });
    if (isCompanyOwner(mine, actor.ownerKey)) return err("owner_cannot_leave");
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh) return NextResponse.json({ ok: true }, { headers: NO_STORE });
      const next = removeMember(fresh, actor.ownerKey);
      if (!(await storeCompany(next))) return err("store_failed", 503);
      await clearMemberIndex(actor.ownerKey);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    });
  }

  if (action === "product_buy") {
    const productId = typeof body.productId === "string" ? body.productId : "";
    const product = await loadProduct(productId);
    if (!product) return err("product_not_found", 404);
    if (isProductExpired(product, now)) {
      await deleteProduct(productId);
      return err("product_expired");
    }
    const company = await loadCompany(product.companyId);
    if (!company) return err("product_not_found", 404);
    return withUserLock(`company:${company.id}`, async () => {
      const freshProduct = await loadProduct(productId);
      if (!freshProduct) return err("product_not_found", 404);
      const freshCompany = await loadCompany(company.id);
      if (!freshCompany || !freshCompany.productIds.includes(productId)) {
        return err("product_not_found", 404);
      }
      const balance = await readUserBalance(actor.discordId);
      if (balance === null) return err("economy_unavailable", 503);
      if (balance < freshProduct.price) return err("not_enough_coins");
      const charged = await chargeUser(
        actor.ownerKey,
        actor.discordId,
        freshProduct.price,
        "company_product_buy",
      );
      if (charged.state === "unavailable") return err("economy_unavailable", 503);
      if (charged.state !== "done") {
        return err(
          charged.op?.error === "insufficient_funds" ? "not_enough_coins" : "economy_failed",
        );
      }
      const sale = planProductSale(freshCompany, freshProduct, actor.discordId, Date.now());
      if (!(await storeCompany(sale.company))) return err("store_failed", 503);
      await appendCompanyHistory(freshCompany.id, sale.history);
      await deleteProduct(productId);
      return NextResponse.json(
        { ok: true, content: freshProduct.content, name: freshProduct.name },
        { headers: NO_STORE },
      );
    });
  }

  if (!mine) return err("not_in_company");

  if (action === "invite") {
    if (!isCompanyOwner(mine, actor.ownerKey)) return err("not_owner");
    const code = makeInviteCode();
    const invite = { code, companyId: mine.id, createdAt: now };
    if (!(await storeInvite(invite))) return err("store_failed", 503);
    return NextResponse.json(
      { ok: true, code, expiresAt: now + COMPANY_INVITE_TTL_MS },
      { headers: NO_STORE },
    );
  }

  if (action === "fire") {
    if (!isCompanyOwner(mine, actor.ownerKey)) return err("not_owner");
    const targetKey = typeof body.targetKey === "string" ? body.targetKey : "";
    if (!targetKey || targetKey === mine.ownerKey) return err("invalid_request", 400);
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh || !fresh.members.some((m) => m.ownerKey === targetKey)) {
        return err("not_member");
      }
      const next = removeMember(fresh, targetKey);
      if (!(await storeCompany(next))) return err("store_failed", 503);
      await clearMemberIndex(targetKey);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    });
  }

  if (action === "setting") {
    if (!isCompanyOwner(mine, actor.ownerKey)) return err("not_owner");
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh) return err("not_in_company");
      const next: Company = { ...fresh };
      if (body.name !== undefined) {
        const name = validateCompanyName(body.name);
        if (name === null) return err("invalid_name", 400);
        next.name = name;
      }
      if (body.description !== undefined) {
        const description = validateCompanyDescription(body.description);
        if (description === null) return err("invalid_description", 400);
        next.description = description;
      }
      if (body.salary !== undefined) {
        const salary = validateCompanySalary(body.salary);
        if (salary === null) return err("invalid_salary", 400);
        next.salary = salary;
      }
      if (!(await storeCompany(next))) return err("store_failed", 503);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    });
  }

  if (action === "bonus") {
    if (!isCompanyOwner(mine, actor.ownerKey)) return err("not_owner");
    const targetKey = typeof body.targetKey === "string" ? body.targetKey : "";
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh) return err("not_in_company");
      const plan = planBonus(fresh, targetKey, body.amount, Date.now());
      if ("error" in plan) {
        return err(
          plan.error === "cooldown"
            ? "bonus_cooldown"
            : plan.error === "not_member"
              ? "not_member"
              : "invalid_amount",
        );
      }
      if (!(await storeCompany(plan.company))) return err("store_failed", 503);
      await appendCompanyHistory(fresh.id, [plan.entry]);
      const paid = await payOutToUser(
        plan.target.ownerKey,
        plan.target.discordId,
        plan.net,
        "company_bonus",
      );
      if (paid.state !== "done") {
        // 払い出しが終端失敗したら台帳を巻き戻す（履歴の記録だけが残る）。
        await storeCompany(fresh);
        return err("economy_failed");
      }
      return NextResponse.json({ ok: true, net: plan.net }, { headers: NO_STORE });
    });
  }

  if (action === "product_create") {
    const input = validateProductInput({
      name: body.name,
      description: body.description,
      content: body.content,
      price: body.price,
    });
    if (!input) return err("invalid_product", 400);
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh) return err("not_in_company");
      const product: CompanyProduct = {
        id: makeProductId(),
        companyId: fresh.id,
        creatorKey: actor.ownerKey,
        creatorName: actor.name,
        ...input,
        createdAt: Date.now(),
      };
      const plan = planProductCreate(fresh, product, Date.now());
      if ("error" in plan) {
        return err(plan.error === "limit" ? "product_limit" : "tax_unaffordable");
      }
      if (!(await storeProduct(product))) return err("store_failed", 503);
      if (!(await storeCompany(plan.company))) return err("store_failed", 503);
      await appendCompanyHistory(fresh.id, [plan.entry]);
      return NextResponse.json({ ok: true, productId: product.id }, { headers: NO_STORE });
    });
  }

  if (action === "dissolve") {
    if (!canDissolve(mine, actor.ownerKey)) return err("cannot_dissolve");
    return withUserLock(`company:${mine.id}`, async () => {
      const fresh = await loadCompany(mine.id);
      if (!fresh || !canDissolve(fresh, actor.ownerKey)) return err("cannot_dissolve");
      // 残資産はオプ上限で分割して返還する。途中で終端失敗したら、
      // 返還済みの分だけ資産を減らして会社を残す（金を消さない）。
      let remaining = fresh.assets;
      while (remaining > 0) {
        const chunk = Math.min(remaining, ECONOMY_AMOUNT_MAX);
        const paid = await payOutToUser(actor.ownerKey, actor.discordId, chunk, "company_dissolve");
        if (paid.state !== "done") {
          if (remaining !== fresh.assets) {
            await storeCompany({ ...fresh, assets: remaining });
          }
          return err("economy_failed");
        }
        remaining -= paid.op?.appliedAmount ?? chunk;
        if ((paid.op?.appliedAmount ?? chunk) <= 0) break;
      }
      await deleteCompanyAll(fresh);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    });
  }

  return err("invalid_request", 400);
}
