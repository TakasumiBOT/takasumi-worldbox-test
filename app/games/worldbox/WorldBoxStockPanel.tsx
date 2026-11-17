"use client";
// WORLD BOX（Takasumi 版）の株式パネル（ロビー中央広場・銀行東隣の取引所）。
// 架空企業10社への投資専用で、プレイヤー会社とは無関係（会社パネルと
// 混ぜない）。株価・配当条件はサーバーが決定的ロジックから返す。
// ここは表示と売買の入力だけ。売買は取引所の前でのみサーバーが受ける。
import { useCallback, useEffect, useRef, useState } from "react";
import { createPollGuard, type PollGuard } from "@/lib/poll-guard";
import { onEconomyApplied } from "@/lib/worldbox/economy/economy-push";

type LoadState = "loading" | "ready" | "guest" | "unavailable";

interface MarketView {
  id: string;
  name: string;
  industry: string;
  price: number;
  prevPrice: number;
  change: number;
  dividendAmount: number;
  dividendRate: number;
  history: number[];
}

interface HoldingView {
  stockId: string;
  shares: number;
  price: number;
  value: number;
}

interface DividendView {
  date: string;
  stockId: string;
  shares: number;
  price: number;
  amount: number;
}

interface StockState {
  guest: boolean;
  serverNow: number;
  market: MarketView[];
  holdings: HoldingView[];
  holdingsValue: number;
  dividends: DividendView[];
  balance: number | null;
}

const ERROR_LABEL: Record<string, string> = {
  not_at_exchange: "取引所の前にいません",
  not_enough_coins: "お金が足りません",
  invalid_trade: "その取引はできません",
  economy_unavailable: "いま取引所を使えません",
  economy_failed: "取引できませんでした",
  guest_not_allowed: "ゲストはお金の機能を使えません",
  unauthorized: "ログインが必要です",
};

const wrap: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(430px, calc(100% - 20px))",
  maxHeight: "calc(100% - 24px)",
  overflowY: "auto",
  boxSizing: "border-box",
  padding: 16,
  borderRadius: 14,
  background: "rgba(12,14,22,0.94)",
  color: "#fff",
  zIndex: 6,
  boxShadow: "0 10px 32px rgba(0,0,0,0.5)",
};
const btn: React.CSSProperties = {
  minHeight: 40,
  padding: "6px 14px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  fontSize: 14,
  cursor: "pointer",
};
const chip: React.CSSProperties = {
  minHeight: 36,
  padding: "4px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  minHeight: 40,
  padding: "6px 10px",
  borderRadius: 9,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 14,
  width: 110,
  boxSizing: "border-box",
};

const yen = (n: number) => `${n.toLocaleString()}円`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;

/** 直近の価格推移の小さな折れ線（表示専用）。 */
function Sparkline({ history, up }: { history: number[]; up: boolean }) {
  if (history.length < 2) return null;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const span = Math.max(1, max - min);
  const points = history
    .map(
      (v, i) =>
        `${((i / (history.length - 1)) * 62 + 1).toFixed(1)},${(17 - ((v - min) / span) * 14).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width="64" height="20" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline points={points} fill="none" stroke={up ? "#4ade80" : "#f87171"} strokeWidth="1.5" />
    </svg>
  );
}

export default function WorldBoxStockPanel({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<LoadState>("loading");
  const [state, setState] = useState<StockState | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [count, setCount] = useState<number>(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const aliveRef = useRef(true);
  const guardRef = useRef<PollGuard>(createPollGuard());

  const refresh = useCallback(async () => {
    const ticket = guardRef.current.begin();
    if (ticket === null) return;
    try {
      const res = await fetch("/api/worldbox/stock", { headers: { Accept: "application/json" } });
      if (res.status === 401) {
        if (aliveRef.current) setLoad("guest");
        return;
      }
      if (!res.ok) {
        if (aliveRef.current) setLoad("unavailable");
        return;
      }
      const data = (await res.json()) as StockState;
      if (!aliveRef.current || !guardRef.current.isCurrent(ticket)) return;
      setState(data);
      setLoad(data.guest ? "guest" : "ready");
    } catch {
      if (aliveRef.current) setLoad("unavailable");
    } finally {
      guardRef.current.end(ticket);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    const off = onEconomyApplied(() => {
      void refresh();
    });
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
      off();
    };
  }, [refresh]);

  const trade = async (action: "buy" | "sell") => {
    if (!state || !selId || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action, stockId: selId, count }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        total?: number;
        net?: number;
        tax?: number;
      };
      if (!res.ok) {
        setMsg(ERROR_LABEL[data.error ?? ""] ?? "受け付けられませんでした");
        return;
      }
      setMsg(
        action === "buy"
          ? `買いました（${yen(data.total ?? 0)}）`
          : `売りました（税 ${yen(data.tax ?? 0)}、受取 ${yen(data.net ?? 0)}）`,
      );
      void refresh();
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const sel = state?.market.find((m) => m.id === selId) ?? null;
  const selHolding = state?.holdings.find((h) => h.stockId === selId) ?? null;
  const safeCount = Number.isInteger(count) && count > 0 ? count : 0;
  const buyTotal = sel ? sel.price * safeCount : 0;
  const sellGross = sel ? sel.price * safeCount : 0;
  const sellTax = Math.floor(sellGross * 0.1);

  return (
    <div style={wrap} role="dialog" aria-label="取引所">
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
      >
        <strong style={{ fontSize: 16 }}>取引所</strong>
        <button
          type="button"
          style={{ ...btn, minHeight: 36, padding: "4px 12px" }}
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.75, margin: "6px 0 0" }}>
        架空企業への投資です。プレイヤーの会社は上場しません。株価は1時間ごとに進み、売却には10%の税金がかかります。配当は毎日0時に、条件を満たす保有へ支払われます。
      </p>

      {load === "loading" && <p style={{ fontSize: 13, opacity: 0.8 }}>読み込み中…</p>}
      {load === "unavailable" && <p style={{ fontSize: 13 }}>いま取引所を使えません。</p>}
      {load === "guest" && (
        <p style={{ fontSize: 13, marginTop: 10 }}>
          ゲストはお金の機能を使えません。相場の閲覧だけできます。
        </p>
      )}

      {state && (
        <>
          {state.balance !== null && (
            <p style={{ fontSize: 13, margin: "10px 0 0" }}>
              所持金 {yen(state.balance)}
              {state.holdings.length > 0 && <> ／ 保有評価額 {yen(state.holdingsValue)}</>}
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {state.market.map((m) => {
              const held = state.holdings.find((h) => h.stockId === m.id);
              const selected = m.id === selId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelId(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: selected ? "1px solid #4ade80" : "1px solid rgba(255,255,255,0.15)",
                    background: selected ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14 }}>
                      {m.name} <span style={{ opacity: 0.6, fontSize: 11 }}>{m.id}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 11, opacity: 0.7 }}>
                      {m.industry} ／ 配当は{m.dividendAmount.toLocaleString()}株から
                      {held ? ` ／ 保有 ${held.shares.toLocaleString()}株` : ""}
                    </span>
                  </span>
                  <Sparkline history={m.history} up={m.change >= 0} />
                  <span style={{ textAlign: "right", flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: 14 }}>{yen(m.price)}</span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color:
                          m.change > 0
                            ? "#4ade80"
                            : m.change < 0
                              ? "#f87171"
                              : "rgba(255,255,255,0.6)",
                      }}
                    >
                      前時間 {signed(m.change)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {sel && load === "ready" && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ fontSize: 14 }}>
                {sel.name}（{sel.id}） {yen(sel.price)}
                {selHolding && (
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    {" "}
                    ／ 保有 {selHolding.shares.toLocaleString()}株（{yen(selHolding.value)}）
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={count}
                  onChange={(e) => setCount(Math.trunc(Number(e.target.value) || 0))}
                  style={input}
                  aria-label="株数"
                />
                <span style={{ fontSize: 13 }}>株</span>
                {[1, 10, 100, 1000].map((n) => (
                  <button key={n} type="button" style={chip} onClick={() => setCount(n)}>
                    {n}
                  </button>
                ))}
                {selHolding && (
                  <button type="button" style={chip} onClick={() => setCount(selHolding.shares)}>
                    全部
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={btn}
                  disabled={busy || safeCount <= 0}
                  onClick={() => void trade("buy")}
                >
                  買う（{yen(buyTotal)}）
                </button>
                <button
                  type="button"
                  style={btn}
                  disabled={busy || safeCount <= 0 || !selHolding || safeCount > selHolding.shares}
                  onClick={() => void trade("sell")}
                >
                  売る（受取 {yen(sellGross - sellTax)}）
                </button>
              </div>
              <p style={{ fontSize: 11, opacity: 0.7, margin: "8px 0 0" }}>
                売却税は売却額の10%（この条件では {yen(sellTax)}）で、国庫に入ります。
              </p>
            </div>
          )}

          {msg && (
            <p role="status" style={{ fontSize: 13, marginTop: 10 }}>
              {msg}
            </p>
          )}

          {state.dividends.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.85 }}>最近の配当</div>
              <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 12 }}>
                {state.dividends.slice(0, 8).map((d, i) => (
                  <li
                    key={`${d.date}-${d.stockId}-${i}`}
                    style={{ padding: "3px 0", opacity: 0.9 }}
                  >
                    {d.date} {state.market.find((m) => m.id === d.stockId)?.name ?? d.stockId}{" "}
                    {d.shares.toLocaleString()}株 → {yen(d.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
