"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { PlayerProfile } from "@/lib/worldbox/player/profile";
import type {
  CareerDef,
  CareerId,
  CertificationDef,
  JobProfile,
  JobTaskPrompt,
} from "@/lib/worldbox/social/jobs";
import { itemById } from "@/lib/worldbox/economy/items";

const overlayStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(620px, calc(100vw - 24px))",
  maxHeight: "min(86svh, 700px)",
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

interface JobsApiGetResponse {
  jobProfile: JobProfile;
  careers: CareerDef[];
  certifications: CertificationDef[];
  balance: number | null;
  hunger: number;
  hasUnemploymentCard: boolean;
  cooldownLeftMs: number;
  jailed: boolean;
}

export default function WorldBoxJobPanel({
  onProfileChange,
  onStatusChange,
  onClose,
}: {
  onProfileChange?: (profile: PlayerProfile) => void;
  onStatusChange?: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<JobsApiGetResponse | null>(null);
  const [tab, setTab] = useState<"shift" | "careers" | "certs" | "support">("shift");
  const [categoryFilter, setCategoryFilter] = useState<string>("すべて");
  const [task, setTask] = useState<JobTaskPrompt | null>(null);
  const [headline, setHeadline] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/worldbox/jobs", { headers: { Accept: "application/json" } });
      if (!res.ok) {
        setMsg("ジョブ情報を読み込めませんでした");
        return;
      }
      const d = (await res.json()) as JobsApiGetResponse;
      setData(d);
      setTask(d.jobProfile.activeTask);
    } catch {
      setMsg("通信エラーが発生しました");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const callAction = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const errCode = String(json.error ?? "");
        const map: Record<string, string> = {
          cooldown: "次のシフトまで少し待機してください",
          too_tired: "空腹です！コンビニや飲食でエネルギーを回復してください",
          in_prison: "収監中は刑務所の『懲役作業』のみ行えます",
          level_too_low: "キャリアLvが不足しています",
          certification_required: "必要な資格ライセンスを取得してください",
          insufficient_funds: "残高が不足しています",
          already_owned: "すでに取得済みの資格です",
          not_eligible: "対象条件を満たしていません（残高15,000円以下または雇用保険証が必要）",
        };
        setMsg(map[errCode] ?? `エラー: ${errCode || res.status}`);
        return null;
      }
      if (json.profile && onProfileChange) {
        onProfileChange(json.profile as PlayerProfile);
      }
      await reload();
      if (onStatusChange) onStatusChange();
      return json;
    } finally {
      setBusy(false);
    }
  };

  const handleStartTask = async () => {
    const res = await callAction({ action: "start_task" });
    if (res?.task) {
      setTask(res.task as JobTaskPrompt);
      setMsg("業務タスクを発行しました。正しい判断で報酬1.4倍！");
    }
  };

  const handleSubmitShift = async (choiceIndex?: number) => {
    const res = await callAction({
      action: "submit_shift",
      ...(typeof choiceIndex === "number" ? { choiceIndex } : {}),
    });
    if (!res) return;
    setTask(null);
    const payout = res.payout as { net?: number; tax?: number; bonusPct?: number } | undefined;
    const drops = (res.drops as string[] | undefined) ?? [];
    const dropLabel =
      drops.length > 0
        ? ` / 支給品: ${drops.map((id) => itemById(id)?.name ?? id).join(", ")}`
        : "";
    const tag =
      res.taskCorrect === true
        ? "【大成功 1.4x】"
        : res.taskCorrect === false
          ? "【ミス減額】"
          : "【シフト完了】";
    const promo = res.leveledUp ? " ★昇格しました！" : "";
    const warn = res.wantedNotice ? " ⚠ 捜査機関に怪しまれ手配度★+1！" : "";
    setMsg(
      `${tag} 手取 +¥${(payout?.net ?? 0).toLocaleString()}（納税 ¥${(payout?.tax ?? 0).toLocaleString()}）${dropLabel}${promo}${warn}`,
    );
  };

  const jobProfile = data?.jobProfile;
  const activeCareer =
    data?.careers.find((c) => c.id === jobProfile?.currentCareer) ?? data?.careers[0];
  const categories = ["すべて", "街の商業", "産業・技術", "公共・治安", "金融・情報"];

  return (
    <div className="wb-panel" style={overlayStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
          borderBottom: "1px solid rgba(148,163,184,0.2)",
          paddingBottom: 10,
        }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>💼 メトロ仕事・キャリアセンター</strong>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            12職種の近代ワーク・資格取得・信用スコア・社会保障ネット
          </div>
        </div>
        <button type="button" className="wb-mmo-btn" onClick={onClose}>
          閉じる
        </button>
      </div>

      {data && jobProfile && activeCareer && (
        <div
          className="wb-mmo-card"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>現職・ランク</div>
            <div style={{ fontWeight: 800, color: "#34d399" }}>
              {activeCareer.badge} {activeCareer.name}
            </div>
            <div className="wb-mmo-num" style={{ fontSize: 11, color: "#cbd5e1" }}>
              Lv.{jobProfile.level}（XP {jobProfile.xp}）
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>所持残高 / 体力</div>
            <div className="wb-mmo-num" style={{ fontWeight: 800, color: "#fbbf24" }}>
              {data.balance !== null ? `¥${data.balance.toLocaleString()}` : "¥---"}
            </div>
            <div className="wb-mmo-num" style={{ fontSize: 11, color: "#cbd5e1" }}>
              満腹度 {Math.round(data.hunger)}/100
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>メトロ信用スコア</div>
            <div
              className="wb-mmo-num"
              style={{
                fontWeight: 800,
                color: jobProfile.creditScore >= 650 ? "#38bdf8" : "#f87171",
              }}
            >
              {jobProfile.creditScore} / 900
            </div>
            <div className="wb-mmo-num" style={{ fontSize: 11, color: "#94a3b8" }}>
              納税累計 ¥{jobProfile.totalTaxPaid.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {data?.jailed && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: 10,
            borderRadius: 8,
            background: "rgba(185,28,28,0.28)",
            border: "1px solid rgba(248,113,113,0.45)",
            fontSize: 12,
          }}
        >
          ⚠
          現在収監中のため通常シフトは停止されています。「警察・刑務所」パネルの懲役作業を行ってください。
        </div>
      )}

      <div className="wb-mmo-tabs">
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "shift" ? "is-active" : ""}`}
          onClick={() => setTab("shift")}
        >
          業務シフト
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "careers" ? "is-active" : ""}`}
          onClick={() => setTab("careers")}
        >
          転職・職種一覧 ({data?.careers.length ?? 0})
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "certs" ? "is-active" : ""}`}
          onClick={() => setTab("certs")}
        >
          資格試験 ({jobProfile?.certifications.length ?? 0}/{data?.certifications.length ?? 5})
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "support" ? "is-active" : ""}`}
          onClick={() => setTab("support")}
        >
          雇用保険・実績
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(6, 182, 212, 0.14)",
            border: "1px solid rgba(34, 211, 238, 0.35)",
            color: "#cffafe",
            fontSize: 12,
          }}
        >
          {msg}
        </div>
      )}

      {tab === "shift" && activeCareer && jobProfile && (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="wb-mmo-card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {activeCareer.badge} {activeCareer.name}
                </div>
                <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>
                  {activeCareer.desc}
                </div>
                <div style={{ fontSize: 11, color: "#34d399", marginTop: 4 }}>
                  特典: {activeCareer.perkLabel}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#fbbf24" }}>
                  基本給 ¥{activeCareer.basePay.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  消費満腹 -{activeCareer.hungerCost}
                </div>
              </div>
            </div>

            {task ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(15, 23, 42, 0.75)",
                  border: "1px solid rgba(56, 189, 248, 0.35)",
                }}
              >
                <div style={{ fontWeight: 700, color: "#38bdf8", marginBottom: 6 }}>
                  📋 集中タスクチャレンジ（正答で報酬 1.4 倍！）
                </div>
                <div style={{ marginBottom: 8 }}>{task.prompt}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {task.choices.map((choice, idx) => (
                    <button
                      key={choice}
                      type="button"
                      disabled={busy || data?.jailed}
                      className="wb-mmo-btn"
                      style={{ textAlign: "left" }}
                      onClick={() => void handleSubmitShift(idx)}
                    >
                      {idx + 1}. {choice}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  disabled={busy || data?.jailed}
                  className="wb-mmo-btn wb-mmo-btn-cyan"
                  onClick={() => void handleStartTask()}
                >
                  集中タスクを受注する（1.4倍報酬）
                </button>
                <button
                  type="button"
                  disabled={busy || data?.jailed}
                  className="wb-mmo-btn wb-mmo-btn-primary"
                  onClick={() => void handleSubmitShift()}
                >
                  通常シフトを実行する
                </button>
              </div>
            )}
          </div>

          {jobProfile.currentCareer === "journalist" && (
            <div className="wb-mmo-card">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                📰 記者特権：メトロ号外ニュース発行
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  maxLength={80}
                  placeholder="街のみんなへ速報ヘッドラインを発信..."
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.3)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !headline.trim()}
                  className="wb-mmo-btn wb-mmo-btn-amber"
                  onClick={() => {
                    void callAction({ action: "publish_news", headline }).then((r) => {
                      if (r) {
                        setHeadline("");
                        setMsg("メトロ全土のティッカーに号外ニュースを配信しました！");
                      }
                    });
                  }}
                >
                  配信
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "careers" && data && jobProfile && (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`wb-mmo-tab ${categoryFilter === cat ? "is-active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {data.careers
              .filter((c) => categoryFilter === "すべて" || c.category === categoryFilter)
              .map((career) => {
                const isCurrent = career.id === jobProfile.currentCareer;
                const lockedLevel = jobProfile.level < career.minLevelReq;
                const lockedCert =
                  career.certRequired && !jobProfile.certifications.includes(career.certRequired);
                return (
                  <div
                    key={career.id}
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
                        {career.badge} {career.name}{" "}
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>({career.category})</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 2 }}>
                        {career.desc}
                      </div>
                      <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 3 }}>
                        基本給 ¥{career.basePay.toLocaleString()} / 必要Lv.{career.minLevelReq}
                        {career.certRequired ? ` / 要資格` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || isCurrent || lockedLevel || Boolean(lockedCert)}
                      className={`wb-mmo-btn ${isCurrent ? "wb-mmo-btn-primary" : "wb-mmo-btn-cyan"}`}
                      onClick={() =>
                        void callAction({ action: "switch_career", careerId: career.id })
                      }
                    >
                      {isCurrent
                        ? "在職中"
                        : lockedLevel
                          ? `要Lv.${career.minLevelReq}`
                          : lockedCert
                            ? "要資格"
                            : "転職する"}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {tab === "certs" && data && jobProfile && (
        <div style={{ display: "grid", gap: 8 }}>
          {data.certifications.map((cert) => {
            const owned = jobProfile.certifications.includes(cert.id);
            return (
              <div
                key={cert.id}
                className="wb-mmo-card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800 }}>{cert.name}</div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1" }}>{cert.desc}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    受験条件: Lv.{cert.minLevel} 以上 / 検定料 ¥{cert.cost.toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || owned || jobProfile.level < cert.minLevel}
                  className={`wb-mmo-btn ${owned ? "wb-mmo-btn-primary" : "wb-mmo-btn-amber"}`}
                  onClick={() => void callAction({ action: "buy_certification", certId: cert.id })}
                >
                  {owned ? "取得済み" : `受験する ¥${cert.cost.toLocaleString()}`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "support" && data && jobProfile && (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="wb-mmo-card">
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              💳 雇用保険・セーフティネット給付
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 8 }}>
              残高
              15,000円以下、または「雇用保険証」を所持している市民は10分ごとに支援給付金を受給できます（雇用保険証ありで1.5倍の900円）。
            </div>
            <button
              type="button"
              disabled={busy}
              className="wb-mmo-btn wb-mmo-btn-primary"
              onClick={() => {
                void callAction({ action: "claim_unemployment" }).then((r) => {
                  if (r)
                    setMsg(
                      `雇用保険給付金 +¥${Number(r.amount ?? 0).toLocaleString()} を受給しました！`,
                    );
                });
              }}
            >
              雇用保険を申請する ({data.hasUnemploymentCard ? "保険証ボーナス1.5x" : "通常"})
            </button>
          </div>
          <div className="wb-mmo-card">
            <div style={{ fontWeight: 800, marginBottom: 4 }}>📊 キャリア統計</div>
            <div style={{ fontSize: 12, color: "#cbd5e1", display: "grid", gap: 3 }}>
              <div>完了シフト総数: {jobProfile.shiftsCompleted} 回</div>
              <div>連続出勤日数: {jobProfile.streakDays} 日</div>
              <div>累計給与収入: ¥{jobProfile.totalEarned.toLocaleString()}</div>
              <div>累計納付所得税: ¥{jobProfile.totalTaxPaid.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
