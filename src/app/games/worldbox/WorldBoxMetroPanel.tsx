"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { PlayerProfile } from "@/lib/worldbox/player/profile";
import type { DailyMissionDef, MmoNewsItem } from "@/lib/worldbox/social/mmo-events";

const overlayStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(600px, calc(100vw - 24px))",
  maxHeight: "min(85svh, 680px)",
  overflowY: "auto",
  borderRadius: 14,
  padding: 16,
  background: "rgba(13, 19, 28, 0.96)",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  boxShadow: "0 20px 50px rgba(0,0,0,0.65)",
  color: "#f1f5f9",
  zIndex: 25,
  fontSize: 13,
};

interface MissionRow extends DailyMissionDef {
  progress: number;
  claimed: boolean;
}

export default function WorldBoxMetroPanel({
  onProfileChange,
  onStatusChange,
  onOpenPanel,
  onClose,
}: {
  onProfileChange?: (profile: PlayerProfile) => void;
  onStatusChange?: () => void;
  onOpenPanel: (
    panel: "jobs" | "engineering" | "prison" | "market" | "finance" | "company" | "economy",
  ) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"missions" | "news" | "guide">("missions");
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [news, setNews] = useState<MmoNewsItem[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/worldbox/mmo", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const d = (await res.json()) as { missions?: MissionRow[]; news?: MmoNewsItem[] };
      setMissions(d.missions ?? []);
      setNews(d.news ?? []);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const claim = async (missionId: string) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/mmo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim_quest", missionId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        profile?: PlayerProfile;
        error?: string;
      };
      if (!res.ok) {
        setMsg(`受取失敗: ${json.error ?? res.status}`);
        return;
      }
      if (json.profile && onProfileChange) onProfileChange(json.profile);
      await reload();
      if (onStatusChange) onStatusChange();
      setMsg("デイリー任務報酬を受け取りました！");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wb-panel" style={overlayStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          borderBottom: "1px solid rgba(148,163,184,0.2)",
          paddingBottom: 10,
        }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>📱 TAKASUMI METRO OS（総合ハブ）</strong>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            デイリー任務・リアルタイム経済ニュース・近代都市機能ショートカット
          </div>
        </div>
        <button type="button" className="wb-mmo-btn" onClick={onClose}>
          閉じる
        </button>
      </div>

      <div className="wb-mmo-tabs">
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "missions" ? "is-active" : ""}`}
          onClick={() => setTab("missions")}
        >
          🎯 デイリー任務
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "news" ? "is-active" : ""}`}
          onClick={() => setTab("news")}
        >
          📰 経済＆治安速報
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "guide" ? "is-active" : ""}`}
          onClick={() => setTab("guide")}
        >
          🌆 アプリ一覧・できること
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(16, 185, 129, 0.16)",
            border: "1px solid rgba(52, 211, 153, 0.4)",
            color: "#d1fae5",
            fontSize: 12,
          }}
        >
          {msg}
        </div>
      )}

      {tab === "missions" && (
        <div style={{ display: "grid", gap: 8 }}>
          {missions.map((m) => {
            const done = m.progress >= m.target;
            return (
              <div
                key={m.id}
                className="wb-mmo-card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>
                    {m.title}{" "}
                    <span className="wb-mmo-num" style={{ fontSize: 11, color: "#38bdf8" }}>
                      ({Math.min(m.progress, m.target)}/{m.target})
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1" }}>{m.desc}</div>
                  <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 2 }}>
                    報酬: ¥{m.rewardCoins.toLocaleString()}
                    {m.rewardItem ? ` + ボーナス素材×${m.rewardItem.count}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || m.claimed || !done}
                  className={`wb-mmo-btn ${m.claimed ? "" : done ? "wb-mmo-btn-primary" : ""}`}
                  onClick={() => void claim(m.id)}
                >
                  {m.claimed ? "受取済" : done ? "受け取る" : "進行中"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "news" && (
        <div style={{ display: "grid", gap: 6 }}>
          {news.map((n) => (
            <div key={n.id} className="wb-mmo-card" style={{ fontSize: 12 }}>
              <span
                style={{
                  fontWeight: 800,
                  marginRight: 8,
                  color:
                    n.kind === "prison" || n.kind === "crime"
                      ? "#f87171"
                      : n.kind === "machine"
                        ? "#22d3ee"
                        : "#fbbf24",
                }}
              >
                [{n.kind.toUpperCase()}]
              </span>
              {n.text}
            </div>
          ))}
        </div>
      )}

      {tab === "guide" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 8,
          }}
        >
          {[
            {
              key: "jobs" as const,
              title: "💼 仕事・キャリア",
              desc: "12職業シフト・資格試験・雇用保険・記者報道",
            },
            {
              key: "engineering" as const,
              title: "⚙️ 機械制作ラボ",
              desc: "CNC・自販機・防犯カメラ・カスタム機設計",
            },
            {
              key: "prison" as const,
              title: "⚖️ 警察・刑務所",
              desc: "強盗・警察逮捕・懲役作業・保釈・差し入れ・脱獄",
            },
            {
              key: "company" as const,
              title: "🏢 起業・会社経営",
              desc: "法人設立・株式IPO・社員雇用・工場生産",
            },
            {
              key: "market" as const,
              title: "📦 コモディティ市場",
              desc: "板取引オーダーブック・資源・農産物売買",
            },
            {
              key: "finance" as const,
              title: "📈 銀行・FX・予測市場",
              desc: "融資ローン・預金・為替FX・未来予測ベット",
            },
          ].map((card) => (
            <button
              key={card.key}
              type="button"
              className="wb-mmo-card"
              style={{ textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                onClose();
                onOpenPanel(card.key);
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13 }}>{card.title}</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 3 }}>{card.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
