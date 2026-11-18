"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ITEMS, itemById, type ItemCategory } from "@/lib/worldbox/economy/items";
import { onEconomyApplied } from "@/lib/worldbox/economy/economy-push";
import { ItemIcon } from "./ItemSlotGrid";

type MarketTab = "book" | "buy_orders" | "macro";

interface BookLevel {
  price: number;
  qty: number;
  count: number;
}

interface OrderView {
  id: string;
  side: "buy" | "sell";
  actorType: "player" | "company";
  itemId: string;
  itemName: string;
  price: number;
  qty: number;
  remaining: number;
  createdAt: number;
}

interface CompanyBuyOrderView {
  companyId: string;
  companyName: string;
  orderId: string;
  itemId: string;
  itemName: string;
  unitPrice: number;
  remaining: number;
  createdAt: number;
}

interface MarketTradeView {
  id: string;
  itemId: string;
  itemName: string;
  price: number;
  qty: number;
  total: number;
  fee: number;
  at: number;
}

interface SectorMacro {
  priceRatio: number;
  volumeWbc: number;
}

interface MarketSnapshot {
  guest: boolean;
  serverNow: number;
  balance: number | null;
  playerItems: Record<string, number>;
  company: {
    id: string;
    name: string;
    assets: number;
    inventory: Record<string, number>;
  } | null;
  focusItemId: string;
  focusBook: {
    bids: BookLevel[];
    asks: BookLevel[];
    bestBid: number | null;
    bestAsk: number | null;
  };
  focusStats: {
    lastPrice: number;
    vwap: number;
    volume24hQty: number;
    volume24hWbc: number;
    highPrice: number;
    lowPrice: number;
  } | null;
  summaryByItem: Record<
    string,
    { bids: number; asks: number; bestBid: number | null; bestAsk: number | null }
  >;
  recentTrades: MarketTradeView[];
  myOrders: OrderView[];
  companyBuyOrders: CompanyBuyOrderView[];
  macro: {
    overallPriceRatio: number;
    totalVolumeWbc: number;
    sectors: Record<string, SectorMacro>;
  };
  feeTreasury: number;
}

const CAT_LABELS: { id: "all" | ItemCategory; label: string }[] = [
  { id: "all", label: "全て" },
  { id: "material", label: "資材" },
  { id: "food", label: "食料" },
  { id: "crop", label: "農産" },
  { id: "crafted", label: "加工品" },
  { id: "tool", label: "道具" },
  { id: "block", label: "建材" },
  { id: "special", label: "希少" },
  { id: "furniture", label: "家具" },
  { id: "seed", label: "種" },
];

const ERROR_LABEL: Record<string, string> = {
  unauthorized: "ログインが必要です",
  guest_not_allowed: "ゲストは取引できません",
  market_unavailable: "現在商品取引所を利用できません",
  not_enough_coins: "所持金が不足しています",
  not_enough_assets: "会社資産が不足しています",
  not_enough_items: "在庫が不足しています",
  not_in_company: "会社に所属していません",
  too_many_orders: "未約定の注文数が上限（80件）に達しています",
  self_match: "自分の注文とは約定できません",
  invalid_price: "価格は1〜1,000,000円の整数で入力してください",
  invalid_qty: "数量は1〜999の整数で入力してください",
  order_not_found: "注文が見つかりません",
  forbidden: "権限がありません",
  store_failed: "保存に失敗しました",
};

const panel: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(640px, calc(100% - 20px))",
  maxHeight: "calc(100% - 20px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
  padding: 14,
  borderRadius: 14,
  zIndex: 6,
  textAlign: "left",
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(10,12,18,0.95)",
  color: "#f2f2f2",
  boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
};

const btn: React.CSSProperties = {
  minHeight: 36,
  padding: "4px 12px",
  borderRadius: 9,
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.08)",
  color: "inherit",
  fontSize: 13,
  touchAction: "manipulation",
};

const input: React.CSSProperties = {
  minHeight: 36,
  padding: "4px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(0,0,0,0.4)",
  color: "#fff",
  boxSizing: "border-box",
};

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function WorldBoxMarketPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tab, setTab] = useState<MarketTab>("book");
  const [cat, setCat] = useState<"all" | ItemCategory>("all");
  const [itemId, setItemId] = useState<string>("wheat");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [asCompany, setAsCompany] = useState(false);
  const [priceStr, setPriceStr] = useState("60");
  const [qtyStr, setQtyStr] = useState("10");
  const [sellQtys, setSellQtys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const aliveRef = useRef(true);

  const refresh = useCallback(async (focus: string) => {
    try {
      const res = await fetch(`/api/worldbox/market?itemId=${encodeURIComponent(focus)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as MarketSnapshot;
      if (!aliveRef.current) return;
      setData(json);
      setLoadFailed(false);
    } catch {
      if (aliveRef.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh(itemId);
    const timer = window.setInterval(() => {
      void refresh(itemId);
    }, 5000);
    const off = onEconomyApplied(() => {
      void refresh(itemId);
    });
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      off();
    };
  }, [itemId, refresh]);

  const selectItem = (id: string) => {
    setItemId(id);
    const item = itemById(id);
    const summary = data?.summaryByItem[id];
    const suggested = summary?.bestAsk ?? summary?.bestBid ?? item?.price ?? 50;
    setPriceStr(String(Math.max(1, suggested)));
  };

  const act = async (
    payload: Record<string, unknown>,
    describe: (res: Record<string, unknown>) => string,
  ) => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/market", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as MarketSnapshot & {
        ok?: boolean;
        error?: string;
        tradesCount?: number;
        payout?: number;
      };
      if (!res.ok) {
        setMsg(ERROR_LABEL[json.error ?? ""] ?? `操作に失敗しました (${json.error ?? res.status})`);
        return;
      }
      setData(json);
      setMsg(describe(json as unknown as Record<string, unknown>));
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  if (loadFailed) {
    return (
      <div
        style={panel}
        className="wb-panel"
        data-wb-se="self"
        role="dialog"
        aria-label="商品取引所"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>中央商品取引所（板取引）</strong>
          <span style={{ flex: 1 }} />
          <button type="button" style={btn} onClick={onClose}>
            閉じる
          </button>
        </div>
        <p>商品取引所の読み込みに失敗しました。</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        style={panel}
        className="wb-panel"
        data-wb-se="self"
        role="dialog"
        aria-label="商品取引所"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>中央商品取引所（板取引）</strong>
          <span style={{ flex: 1 }} />
          <button type="button" style={btn} onClick={onClose}>
            閉じる
          </button>
        </div>
        <p>読み込み中…</p>
      </div>
    );
  }

  const focusItem = itemById(data.focusItemId) ?? ITEMS[0];
  const filteredItems = ITEMS.filter((it) => cat === "all" || it.category === cat).slice(0, 60);
  const myPersonalQty = data.playerItems[focusItem.id] ?? 0;
  const myCompanyQty = data.company?.inventory[focusItem.id] ?? 0;
  const heldQty = asCompany ? myCompanyQty : myPersonalQty;
  const priceNum = Math.trunc(Number(priceStr) || 0);
  const qtyNum = Math.trunc(Number(qtyStr) || 0);

  return (
    <div style={panel} className="wb-panel" data-wb-se="self" role="dialog" aria-label="商品取引所">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>中央商品取引所</strong>
        {data.balance !== null && <span style={{ fontSize: 13 }}>個人 {yen(data.balance)}</span>}
        {data.company && (
          <span style={{ fontSize: 13, color: "#93c5fd" }}>
            ／ {data.company.name} {yen(data.company.assets)}
          </span>
        )}
        <span style={{ fontSize: 12, opacity: 0.75 }}>
          物価指数 {data.macro.overallPriceRatio.toFixed(2)}x
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={onClose}>
          閉じる
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {(
          [
            ["book", "板取引 (Order Book)"],
            ["buy_orders", `企業買取 (${data.companyBuyOrders.length})`],
            ["macro", "マクロ指数・約定"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            style={{
              ...btn,
              ...(tab === t
                ? { background: "rgba(255,210,62,0.18)", borderColor: "rgba(255,210,62,0.55)" }
                : {}),
            }}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && (
        <p
          role="status"
          style={{
            margin: "8px 0 0",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.08)",
            fontSize: 13,
          }}
        >
          {msg}
        </p>
      )}

      {tab === "book" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
            {CAT_LABELS.map((c) => (
              <button
                key={c.id}
                type="button"
                style={{
                  ...btn,
                  minHeight: 28,
                  padding: "2px 8px",
                  fontSize: 12,
                  ...(cat === c.id
                    ? { borderColor: "#60a5fa", background: "rgba(96,165,250,0.2)" }
                    : {}),
                }}
                onClick={() => setCat(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 6,
              borderBottom: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            {filteredItems.map((it) => {
              const s = data.summaryByItem[it.id];
              const pOwned = data.playerItems[it.id] ?? 0;
              const cOwned = data.company?.inventory[it.id] ?? 0;
              const active = it.id === focusItem.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => selectItem(it.id)}
                  style={{
                    ...btn,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderColor: active ? "#ffd23e" : "rgba(255,255,255,0.16)",
                    background: active ? "rgba(255,210,62,0.14)" : "rgba(255,255,255,0.04)",
                  }}
                >
                  <ItemIcon id={it.id} size={20} />
                  <span style={{ textAlign: "left" }}>
                    <span style={{ display: "block", fontSize: 12 }}>{it.name}</span>
                    <span style={{ display: "block", fontSize: 10, opacity: 0.7 }}>
                      {s?.bestAsk
                        ? `売${s.bestAsk}`
                        : s?.bestBid
                          ? `買${s.bestBid}`
                          : `基${it.price}`}
                      {pOwned + cOwned > 0 ? ` ・所持${pOwned + cOwned}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
              marginTop: 10,
            }}
          >
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <ItemIcon id={focusItem.id} size={24} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{focusItem.name} の板情報</div>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>
                    基準 {yen(focusItem.price)}
                    {data.focusStats
                      ? ` ／ 終値 ${yen(data.focusStats.lastPrice)} ・ VWAP ${yen(data.focusStats.vwap)}`
                      : ""}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>売り板 (Ask)</div>
              {data.focusBook.asks.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.5, padding: "4px 0" }}>売り注文なし</div>
              ) : (
                [...data.focusBook.asks]
                  .slice(0, 5)
                  .reverse()
                  .map((lvl) => (
                    <button
                      key={`ask-${lvl.price}`}
                      type="button"
                      onClick={() => {
                        setSide("buy");
                        setPriceStr(String(lvl.price));
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "3px 6px",
                        border: "none",
                        background: "rgba(248,113,113,0.12)",
                        color: "#fca5a5",
                        fontSize: 12,
                        marginBottom: 2,
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      <span>{yen(lvl.price)}</span>
                      <span>
                        {lvl.qty}個 ({lvl.count}件)
                      </span>
                    </button>
                  ))
              )}

              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  padding: "4px 0",
                  borderTop: "1px dashed rgba(255,255,255,0.15)",
                  borderBottom: "1px dashed rgba(255,255,255,0.15)",
                  margin: "4px 0",
                }}
              >
                スプレッド:{" "}
                {data.focusBook.bestAsk && data.focusBook.bestBid
                  ? yen(data.focusBook.bestAsk - data.focusBook.bestBid)
                  : "—"}
              </div>

              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>買い板 (Bid)</div>
              {data.focusBook.bids.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.5, padding: "4px 0" }}>買い注文なし</div>
              ) : (
                data.focusBook.bids.slice(0, 5).map((lvl) => (
                  <button
                    key={`bid-${lvl.price}`}
                    type="button"
                    onClick={() => {
                      setSide("sell");
                      setPriceStr(String(lvl.price));
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "3px 6px",
                      border: "none",
                      background: "rgba(74,222,128,0.12)",
                      color: "#86efac",
                      fontSize: 12,
                      marginBottom: 2,
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <span>{yen(lvl.price)}</span>
                    <span>
                      {lvl.qty}個 ({lvl.count}件)
                    </span>
                  </button>
                ))
              )}
            </div>

            {!data.guest && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>新規指値注文</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <button
                    type="button"
                    style={{
                      ...btn,
                      flex: 1,
                      background: side === "buy" ? "rgba(74,222,128,0.22)" : undefined,
                      borderColor: side === "buy" ? "#4ade80" : undefined,
                    }}
                    onClick={() => setSide("buy")}
                  >
                    買う (Bid)
                  </button>
                  <button
                    type="button"
                    style={{
                      ...btn,
                      flex: 1,
                      background: side === "sell" ? "rgba(248,113,113,0.22)" : undefined,
                      borderColor: side === "sell" ? "#f87171" : undefined,
                    }}
                    onClick={() => setSide("sell")}
                  >
                    売る (Ask)
                  </button>
                </div>

                {data.company && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <button
                      type="button"
                      style={{
                        ...btn,
                        flex: 1,
                        minHeight: 30,
                        fontSize: 12,
                        borderColor: !asCompany ? "#ffd23e" : undefined,
                      }}
                      onClick={() => setAsCompany(false)}
                    >
                      個人口座（在庫 {myPersonalQty}）
                    </button>
                    <button
                      type="button"
                      style={{
                        ...btn,
                        flex: 1,
                        minHeight: 30,
                        fontSize: 12,
                        borderColor: asCompany ? "#60a5fa" : undefined,
                      }}
                      onClick={() => setAsCompany(true)}
                    >
                      会社倉庫（在庫 {myCompanyQty}）
                    </button>
                  </div>
                )}

                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontSize: 12 }}>
                    単価（円）
                    <input
                      style={{ ...input, width: "100%", marginTop: 2 }}
                      inputMode="numeric"
                      value={priceStr}
                      onChange={(e) => setPriceStr(e.target.value)}
                    />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    数量（{side === "sell" ? `最大所持 ${heldQty}` : "1〜999"}）
                    <input
                      style={{ ...input, width: "100%", marginTop: 2 }}
                      inputMode="numeric"
                      value={qtyStr}
                      onChange={(e) => setQtyStr(e.target.value)}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {[1, 5, 10, 50].map((n) => (
                      <button
                        key={n}
                        type="button"
                        style={{ ...btn, minHeight: 28, padding: "2px 8px", fontSize: 12 }}
                        onClick={() => setQtyStr(String(n))}
                      >
                        {n}個
                      </button>
                    ))}
                    {side === "sell" && heldQty > 0 && (
                      <button
                        type="button"
                        style={{ ...btn, minHeight: 28, padding: "2px 8px", fontSize: 12 }}
                        onClick={() => setQtyStr(String(Math.min(999, heldQty)))}
                      >
                        全在庫
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    概算額: {yen(Math.max(0, priceNum * qtyNum))}（約定時手数料 3%は売り手負担）
                  </div>
                  <button
                    type="button"
                    style={{
                      ...btn,
                      background:
                        side === "buy" ? "rgba(74,222,128,0.28)" : "rgba(248,113,113,0.28)",
                      borderColor: side === "buy" ? "#4ade80" : "#f87171",
                      fontWeight: 700,
                    }}
                    disabled={busy || priceNum < 1 || qtyNum < 1}
                    onClick={() =>
                      void act(
                        {
                          action: "place_order",
                          side,
                          asCompany,
                          itemId: focusItem.id,
                          price: priceNum,
                          qty: qtyNum,
                        },
                        (res) => {
                          const tc = Number(res.tradesCount ?? 0);
                          return tc > 0
                            ? `${focusItem.name}の注文を発注し、${tc}件即時約定しました`
                            : `${focusItem.name}の指値注文を板に登録しました`;
                        },
                      )
                    }
                  >
                    {asCompany ? "会社名義で" : ""}
                    {side === "buy" ? "買い注文を出す" : "売り注文を出す"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!data.guest && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                自分の未約定注文 ({data.myOrders.length})
              </div>
              {data.myOrders.length === 0 ? (
                <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>未約定の注文はありません。</p>
              ) : (
                data.myOrders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 0",
                      borderTop: "1px solid rgba(255,255,255,0.1)",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        color: o.side === "buy" ? "#86efac" : "#fca5a5",
                        fontWeight: 700,
                      }}
                    >
                      {o.side === "buy" ? "買" : "売"}
                    </span>
                    <span>
                      {o.actorType === "company" ? "[会社] " : ""}
                      {o.itemName}
                    </span>
                    <span>
                      {yen(o.price)} × 残{o.remaining}/{o.qty}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      style={{ ...btn, minHeight: 28, padding: "2px 10px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          { action: "cancel_order", orderId: o.id },
                          () => `${o.itemName}の注文を取り消しました`,
                        )
                      }
                    >
                      取消
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {tab === "buy_orders" && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, opacity: 0.8, margin: "0 0 8px" }}>
            各企業が原料調達のために出している常時買取オファーです。手持ち素材をそのまま即金化できます。
          </p>
          {data.companyBuyOrders.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>現在アクティブな企業買取募集はありません。</p>
          ) : (
            data.companyBuyOrders.map((o) => {
              const held = data.playerItems[o.itemId] ?? 0;
              const q = Math.trunc(
                Number(sellQtys[o.orderId] ?? String(Math.min(held, o.remaining) || 1)),
              );
              return (
                <div
                  key={`${o.companyId}-${o.orderId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    padding: "8px 0",
                    borderTop: "1px solid rgba(255,255,255,0.12)",
                    fontSize: 13,
                  }}
                >
                  <ItemIcon id={o.itemId} size={22} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div>
                      <strong>{o.companyName}</strong> が <strong>{o.itemName}</strong> を買取中
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      買取単価 {yen(o.unitPrice)} ／ 残り募集 {o.remaining}個（手持ち {held}個）
                    </div>
                  </div>
                  {!data.guest && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        style={{ ...input, width: 68 }}
                        inputMode="numeric"
                        value={sellQtys[o.orderId] ?? String(Math.min(held, o.remaining) || 1)}
                        onChange={(e) =>
                          setSellQtys((prev) => ({ ...prev, [o.orderId]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        style={btn}
                        disabled={busy || held < 1 || q < 1 || q > Math.min(held, o.remaining)}
                        onClick={() =>
                          void act(
                            {
                              action: "sell_to_company",
                              companyId: o.companyId,
                              orderId: o.orderId,
                              qty: q,
                            },
                            (res) =>
                              `${o.companyName}へ${o.itemName}を売却し、${yen(Number(res.payout ?? 0))}を受け取りました`,
                          )
                        }
                      >
                        即売
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "macro" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            セクター別物価指数（株式ファンダメンタル・FXレート連動）
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 6,
              marginBottom: 12,
            }}
          >
            {Object.entries(data.macro.sectors).map(([sector, sec]) => (
              <div
                key={sector}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700 }}>{sector}</div>
                <div
                  style={{
                    color:
                      sec.priceRatio > 1.02
                        ? "#4ade80"
                        : sec.priceRatio < 0.98
                          ? "#f87171"
                          : "#e5e7eb",
                  }}
                >
                  指数 {(sec.priceRatio * 100).toFixed(1)}
                </div>
                <div style={{ opacity: 0.7 }}>出来高 {yen(sec.volumeWbc)}</div>
              </div>
            ))}
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            直近約定履歴（総取引手数料プール {yen(data.feeTreasury)}）
          </div>
          {data.recentTrades.length === 0 ? (
            <p style={{ fontSize: 12, opacity: 0.65 }}>まだ約定履歴がありません。</p>
          ) : (
            data.recentTrades.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 0",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  fontSize: 12,
                }}
              >
                <span style={{ opacity: 0.7 }}>{new Date(t.at).toLocaleTimeString()}</span>
                <span>{t.itemName}</span>
                <span>
                  {yen(t.price)} × {t.qty}
                </span>
                <span style={{ flex: 1 }} />
                <span>{yen(t.total)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
