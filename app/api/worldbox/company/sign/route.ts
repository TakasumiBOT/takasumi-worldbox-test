import { NextResponse } from "next/server";
import { getRequestSession, sessionOwnerKey } from "@/lib/auth";
import { WORLD_COORD_LIMIT } from "@/lib/worldbox/world/mapgen";
import { isOverrideActive, isSignItem } from "@/lib/worldbox/world/tiles";
import { loadTileOverride } from "@/lib/worldbox/world/tiles-online";
import {
  deleteSignCompany,
  isCompanyEnabled,
  loadCompany,
  loadCompanyOf,
  loadLiveProducts,
  loadSignCompany,
} from "@/lib/worldbox/social/company-online";

export const runtime = "nodejs";

// WORLD BOX（Takasumi 版）の店舗看板（Phase 4 の空間化）。
// GET ?x&y: ワールドの看板タイルに登録された会社（店舗・受付）を返す。
// 登録の正は bot_kv（worldbox_company の "sign:<x>,<y>"）で、看板の
// 実在と設置者はタイル上書き（block.ownerId = 設置者のプレゼンス ID）
// で毎回照合する。看板が掘り返された／設置者が変わった登録は、ここで
// 落として掃除する。商品の内容テキストは含めない（購入時のみ開示、
// 会社ルートの product_buy と同じ規則）。購入も product_buy を使う。
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 409) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (!isCompanyEnabled()) return err("company_unavailable", 503);
  const url = new URL(request.url);
  const x = Number(url.searchParams.get("x"));
  const y = Number(url.searchParams.get("y"));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return err("invalid_request", 400);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (Math.abs(tx) > WORLD_COORD_LIMIT || Math.abs(ty) > WORLD_COORD_LIMIT) {
    return err("invalid_request", 400);
  }

  // 閲覧者自身の会社（看板の設置者が自社店舗として登録できるかの判定用）。
  const viewerKey = sessionOwnerKey(session);
  const viewerCompany = await loadCompanyOf(viewerKey);
  const viewerCompanyId = viewerCompany?.id ?? null;

  const sign = await loadSignCompany(tx, ty);
  if (!sign) return NextResponse.json({ sign: null, viewerCompanyId }, { headers: NO_STORE });

  // 看板の実在と設置者を照合する（外れていたら登録を落とす）。
  const ov = await loadTileOverride(tx, ty);
  if (
    !ov?.block ||
    !isOverrideActive(ov, Date.now()) ||
    !isSignItem(ov.block.itemId) ||
    ov.block.ownerId !== sign.ownerId
  ) {
    await deleteSignCompany(tx, ty);
    return NextResponse.json({ sign: null, viewerCompanyId }, { headers: NO_STORE });
  }

  const company = await loadCompany(sign.companyId);
  if (!company) {
    await deleteSignCompany(tx, ty);
    return NextResponse.json({ sign: null, viewerCompanyId }, { headers: NO_STORE });
  }

  const now = Date.now();
  const { products } = await loadLiveProducts(company, now);
  return NextResponse.json(
    {
      viewerCompanyId,
      sign: {
        companyId: company.id,
        name: company.name,
        description: company.description,
        assets: company.assets,
        salary: company.salary,
        memberCount: company.members.length,
        hq: company.hq,
        isMember: company.members.some((m) => m.ownerKey === viewerKey),
        isOwner: company.ownerKey === viewerKey,
        products: products.map((p) => ({
          id: p.id,
          companyId: p.companyId,
          creatorName: p.creatorName,
          name: p.name,
          description: p.description,
          price: p.price,
          createdAt: p.createdAt,
        })),
      },
    },
    { headers: NO_STORE },
  );
}
