import { NextResponse } from "next/server";
import { getRequestSession, publicOrigin, sessionOwnerKey } from "@/lib/auth";
import { withUserLock } from "@/lib/worldbox/core/user-lock";
import { readUserBalance } from "@/lib/worldbox/economy/economy-bridge-online";
import {
  STOCKS,
  planStockBuy,
  stockById,
  stockHoldingsValue,
  stockPrice,
  stockPriceHistory,
  stockPrevPrice,
  type StockAccount,
} from "@/lib/worldbox/economy/stock";
import {
  buyShares,
  isStockEnabled,
  loadStockAccount,
  sellShares,
} from "@/lib/worldbox/economy/stock-online";
import { loadMyLobbyStation } from "@/lib/worldbox/world/station-online";

export const runtime = "nodejs";

// WORLD BOX（Takasumi 版）の株式（ロビー中央広場の取引所）。
// 架空企業10社の株を売買する投資システムで、プレイヤー会社とは
// 無関係（会社パネルとは別パネル・別ルート）。株価は stock.ts の
// 決定的系列を時刻で引く（保存しない）。売買は取引所ステーション
// （station "stock"）の前にいるときだけ。お金は経済ブリッジ経由
// のみ: 購入 = spend（対価は国庫へ）、売却 = earn（売却税10%控除後）。
// 配当は日次 Cron（internal/stock-cron）が earn で払い出す。
// GET: { guest, serverNow, market, holdings, holdingsValue, dividends, balance }
// POST: { action: "buy" | "sell", stockId, count }

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function err(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === publicOrigin(request);
}

/** 銘柄一覧の表示形（現在価格・前時間比・直近の推移）。 */
function marketView(now: number) {
  return STOCKS.map((def) => {
    const price = stockPrice(def, now);
    const prevPrice = stockPrevPrice(def, now);
    return {
      id: def.id,
      name: def.name,
      industry: def.industry,
      price,
      prevPrice,
      change: price - prevPrice,
      dividendAmount: def.dividendAmount,
      dividendRate: def.dividendRate,
      history: stockPriceHistory(def, now, 48),
    };
  });
}

/** 自分の保有の表示形（評価額つき）。 */
function holdingsView(account: StockAccount, now: number) {
  return STOCKS.filter((def) => (account.holdings[def.id] ?? 0) > 0).map((def) => {
    const shares = account.holdings[def.id];
    const price = stockPrice(def, now);
    return { stockId: def.id, shares, price, value: shares * price };
  });
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  const now = Date.now();
  const market = marketView(now);
  if (session.provider === "guest") {
    return NextResponse.json(
      {
        guest: true,
        serverNow: now,
        market,
        holdings: [],
        holdingsValue: 0,
        dividends: [],
        balance: null,
      },
      { headers: NO_STORE },
    );
  }
  if (!isStockEnabled()) return err("economy_unavailable", 503);
  const ownerKey = sessionOwnerKey(session);
  const account = await loadStockAccount(ownerKey);
  const balance = await readUserBalance(session.id);
  return NextResponse.json(
    {
      guest: false,
      serverNow: now,
      market,
      holdings: holdingsView(account, now),
      holdingsValue: stockHoldingsValue(account.holdings, now),
      dividends: account.dividends,
      balance,
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return err("forbidden", 403);
  const session = getRequestSession(request);
  if (!session) return err("unauthorized", 401);
  if (session.provider === "guest") return err("guest_not_allowed", 403);
  if (!isStockEnabled()) return err("economy_unavailable", 503);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_request", 400);
  }
  const action = body.action;
  if (action !== "buy" && action !== "sell") return err("invalid_action", 400);
  const def = stockById(body.stockId);
  if (!def) return err("invalid_trade", 400);
  const ownerKey = sessionOwnerKey(session);
  const discordId = session.id;

  return withUserLock(ownerKey, async () => {
    // 売買は取引所の前でのみ（競馬の馬券カウンターと同じ場所検証）。
    const station = await loadMyLobbyStation(ownerKey);
    if (station !== "stock") return err("not_at_exchange", 409);
    const now = Date.now();

    if (action === "buy") {
      const plan = planStockBuy(def, body.count, now);
      if (!plan) return err("invalid_trade", 400);
      const balance = await readUserBalance(discordId);
      if (balance === null) return err("economy_unavailable", 503);
      if (balance < plan.total) return err("not_enough_coins");
      const result = await buyShares(ownerKey, discordId, def.id, plan.count, now);
      if (result.state === "invalid") return err("invalid_trade", 400);
      if (result.state === "unavailable") return err("economy_unavailable", 503);
      if (result.state !== "done") {
        return err(result.error === "insufficient_funds" ? "not_enough_coins" : "economy_failed");
      }
      const after = await readUserBalance(discordId);
      return NextResponse.json(
        {
          ok: true,
          kind: "buy",
          stockId: def.id,
          count: plan.count,
          price: result.price,
          total: result.total,
          balance: after,
          holdings: result.account ? holdingsView(result.account, now) : [],
          holdingsValue: result.account ? stockHoldingsValue(result.account.holdings, now) : 0,
        },
        { headers: NO_STORE },
      );
    }

    const result = await sellShares(ownerKey, discordId, def.id, body.count, now);
    if (result.state === "invalid") return err("invalid_trade", 400);
    if (result.state === "unavailable") return err("economy_unavailable", 503);
    if (result.state !== "done") return err("economy_failed");
    const after = await readUserBalance(discordId);
    return NextResponse.json(
      {
        ok: true,
        kind: "sell",
        stockId: def.id,
        price: result.price,
        gross: result.gross,
        tax: result.tax,
        net: result.net,
        balance: after,
        holdings: result.account ? holdingsView(result.account, now) : [],
        holdingsValue: result.account ? stockHoldingsValue(result.account.holdings, now) : 0,
      },
      { headers: NO_STORE },
    );
  });
}
