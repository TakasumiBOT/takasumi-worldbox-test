"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { PlayerProfile } from "@/lib/worldbox/player/profile";
import { itemById } from "@/lib/worldbox/economy/items";
import type {
  CrimeDef,
  NpcSuspect,
  PrisonLaborDef,
  PrisonRecord,
} from "@/lib/worldbox/social/prison";

const overlayStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(650px, calc(100vw - 24px))",
  maxHeight: "min(86svh, 710px)",
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

interface PrisonApiGetResponse {
  self: PrisonRecord & { jailed: boolean; remainingMs: number; bailCost: number };
  inmates: {
    ownerKey: string;
    presenceId: string;
    name: string;
    inmateNumber: string;
    cellId: string;
    remainingMs: number;
    bailCost: number;
    charges: { label: string }[];
    careLogs: { fromName: string; message: string }[];
  }[];
  wanted: {
    ownerKey: string;
    presenceId: string;
    name: string;
    wantedLevel: number;
    bounty: number;
  }[];
  npcSuspects: NpcSuspect[];
  crimes: CrimeDef[];
  laborTasks: PrisonLaborDef[];
  balance: number | null;
  isPolice: boolean;
  isLawyer: boolean;
}

function fmtSec(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}分${String(rem).padStart(2, "0")}秒`;
}

export default function WorldBoxPrisonPanel({
  currentSpace,
  profile,
  onForceMove,
  onProfileChange,
  onStatusChange,
  onClose,
}: {
  currentSpace: string;
  profile: PlayerProfile | null;
  onForceMove?: (move: { space: string; x: number; y: number }) => void;
  onProfileChange?: (profile: PlayerProfile) => void;
  onStatusChange?: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<PrisonApiGetResponse | null>(null);
  const [tab, setTab] = useState<"status" | "crime" | "police" | "inmates">("status");
  const [nowMs, setNowMs] = useState(Date.now());
  const [careTarget, setCareTarget] = useState("");
  const [careItemId, setCareItemId] = useState("bread");
  const [careMsg, setCareMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/worldbox/prison", { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const d = (await res.json()) as PrisonApiGetResponse;
      setData(d);
      if (d.inmates.length > 0 && !careTarget) {
        setCareTarget(d.inmates[0].ownerKey);
      }
    } catch {
      /* noop */
    }
  }, [careTarget]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const postAction = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/prison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const errCode = String(json.error ?? "");
        const errMap: Record<string, string> = {
          cooldown: "行動のクールタイム中です",
          still_jailed: "刑期が残っているため出所できません",
          insufficient_funds: "所持金が不足しています",
          not_enough_items: "差し入れ対象のアイテムを所持していません",
          in_prison: "収監中は実行できません",
          target_offline: "対象プレイヤーがオフラインです",
          not_wanted: "対象は現在指名手配中ではありません",
          sentence_not_finished: "まだ釈放時刻に達していません",
        };
        setMsg(errMap[errCode] ?? `エラー: ${errCode || res.status}`);
        return null;
      }
      if (json.profile && onProfileChange) {
        onProfileChange(json.profile as PlayerProfile);
      }
      if (json.forceMove && onForceMove) {
        onForceMove(json.forceMove as { space: string; x: number; y: number });
      }
      await reload();
      if (onStatusChange) onStatusChange();
      return json;
    } finally {
      setBusy(false);
    }
  };

  const self = data?.self;
  const remainingLiveMs = self?.jailed ? Math.max(0, self.releaseAt - nowMs) : 0;
  const inventoryFoodAndTools = profile
    ? Object.entries(profile.items)
        .filter(([, cnt]) => cnt > 0)
        .map(([id, cnt]) => ({ id, cnt, def: itemById(id) }))
        .filter((x) => x.def !== null)
    : [];

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
          <strong style={{ fontSize: 16 }}>⚖️ メトロ治安局・タカスミ中央刑務所</strong>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            指名手配・逮捕・懲役労役・保釈弁護・差し入れ・脱獄シミュレーション
          </div>
        </div>
        <button type="button" className="wb-mmo-btn" onClick={onClose}>
          閉じる
        </button>
      </div>

      {self && (
        <div
          className="wb-mmo-card"
          style={{
            marginBottom: 10,
            borderColor: self.jailed
              ? "rgba(248,113,113,0.55)"
              : self.wantedLevel > 0
                ? "rgba(251,191,36,0.5)"
                : "rgba(52,211,153,0.35)",
          }}
        >
          <div
            style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {self.jailed
                  ? `🔒 収監中 — 囚人番号 ${self.inmateNumber}（房 ${self.cellId}）`
                  : self.wantedLevel > 0
                    ? `🚨 指名手配中 ${"★".repeat(self.wantedLevel)}`
                    : "🛡 善良市民（手配なし）"}
              </div>
              <div style={{ fontSize: 11.5, color: "#cbd5e1", marginTop: 2 }}>
                {self.jailed
                  ? `残刑期: ${fmtSec(remainingLiveMs)} / 保釈金: ¥${self.bailCost.toLocaleString()}${data?.isLawyer ? "（弁護士割引適用）" : ""}`
                  : self.wantedLevel > 0
                    ? `懸賞金 ¥${self.bounty.toLocaleString()} が懸けられています！`
                    : `逮捕実績 ${self.arrestsCount}件 / 所持金 ${data?.balance !== null ? `¥${data?.balance.toLocaleString()}` : "---"}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {currentSpace !== "prison" && !self.jailed && (
                <button
                  type="button"
                  disabled={busy}
                  className="wb-mmo-btn wb-mmo-btn-cyan"
                  onClick={() => void postAction({ action: "visit_prison" })}
                >
                  刑務所を視察・面会する
                </button>
              )}
              {currentSpace === "prison" && !self.jailed && (
                <button
                  type="button"
                  disabled={busy}
                  className="wb-mmo-btn wb-mmo-btn-primary"
                  onClick={() => void postAction({ action: "leave_prison" })}
                >
                  刑務所から出る
                </button>
              )}
              {self.jailed && remainingLiveMs <= 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className="wb-mmo-btn wb-mmo-btn-primary"
                  onClick={() => void postAction({ action: "claim_release" })}
                >
                  釈放手続きをしてロビーへ戻る
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="wb-mmo-tabs">
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "status" ? "is-active" : ""}`}
          onClick={() => setTab("status")}
        >
          {self?.jailed ? "収監・懲役・脱獄" : "施設案内・出所"}
        </button>
        <button
          type="button"
          className={`wb-mmo-tab is-warn ${tab === "crime" ? "is-active" : ""}`}
          onClick={() => setTab("crime")}
        >
          闇犯罪・ハイスト
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "police" ? "is-active" : ""}`}
          onClick={() => setTab("police")}
        >
          警察・指名手配 ({(data?.wanted.length ?? 0) + (data?.npcSuspects.length ?? 0)})
        </button>
        <button
          type="button"
          className={`wb-mmo-tab ${tab === "inmates" ? "is-active" : ""}`}
          onClick={() => setTab("inmates")}
        >
          囚人名簿・面会 ({data?.inmates.length ?? 0})
        </button>
      </div>

      {msg && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(245, 158, 11, 0.15)",
            border: "1px solid rgba(251, 191, 36, 0.4)",
            color: "#fef3c7",
            fontSize: 12,
          }}
        >
          {msg}
        </div>
      )}

      {tab === "status" && data && self && (
        <div style={{ display: "grid", gap: 10 }}>
          {self.jailed ? (
            <>
              <div className="wb-mmo-card">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>⚒ 懲役作業（減刑＋労働報酬）</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {data.laborTasks.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                          {t.desc}（減刑 -{t.reduceSec}秒 / +¥{t.wage}）
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        className="wb-mmo-btn wb-mmo-btn-primary"
                        onClick={() => {
                          void postAction({ action: "prison_labor", taskId: t.id }).then((r) => {
                            if (r) {
                              setMsg(
                                r.released
                                  ? "刑期を全うして出所しました！"
                                  : `作業完了！ +¥${Number(r.wage ?? 0)} / 刑期 -${Number(r.reducedSec ?? 0)}秒`,
                              );
                            }
                          });
                        }}
                      >
                        作業する
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                <div className="wb-mmo-card">
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>💳 保釈金の支払い</div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1", marginBottom: 8 }}>
                    残刑期に応じた保釈金を支払って即座に出所できます。
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="wb-mmo-btn wb-mmo-btn-amber"
                    onClick={() => {
                      void postAction({ action: "pay_bail" }).then((r) => {
                        if (r) setMsg("保釈金を受理しました！自由の身へ釈放されます。");
                      });
                    }}
                  >
                    保釈金を払う (¥{self.bailCost.toLocaleString()})
                  </button>
                </div>

                <div className="wb-mmo-card">
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>🕳 地下ダクト脱獄</div>
                  <div style={{ fontSize: 11.5, color: "#cbd5e1", marginBottom: 8 }}>
                    ピッキングツール所持で高確率脱獄！失敗すると+45秒の懲罰延長。
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="wb-mmo-btn wb-mmo-btn-danger"
                    onClick={() => {
                      void postAction({ action: "jailbreak" }).then((r) => {
                        if (!r) return;
                        setMsg(
                          r.escaped
                            ? "脱獄に成功し郊外へ逃亡しました！（指名手配度上昇）"
                            : "看守に発見され独房へ戻されました（刑期 +45秒）",
                        );
                      });
                    }}
                  >
                    脱獄を試みる
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="wb-mmo-card">
              <div style={{ fontWeight: 800, marginBottom: 6 }}>🏛 タカスミ中央矯正施設 案内</div>
              <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
                ・プレイヤーが犯罪に失敗するか、警察/市民に逮捕されると自動的にこの刑務所の独房（A-101〜B-202）へ収監されます。
                <br />
                ・一般市民や警察職は「刑務所を視察・面会する」からいつでも入館し、囚人にアイテムを差し入れたり保釈を肩代わりできます。
                <br />
                ・自分の所有地に「AI防犯カメラ」を設置すると、半径3マスの領域を守り泥棒を撃退・通報できます。
              </div>
            </div>
          )}

          {self.careLogs.length > 0 && (
            <div className="wb-mmo-card">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>📦 差し入れ受取履歴</div>
              {self.careLogs.map((c, idx) => (
                <div key={idx} style={{ fontSize: 11.5, color: "#cbd5e1" }}>
                  ・{c.fromName} より: {c.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "crime" && data && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: "#fca5a5" }}>
            ⚠
            犯罪が成功すると大金を得ますが指名手配★と信用スコア低下が付きます。防犯カメラ圏内や失敗時は即刑務所送りになります。
          </div>
          {data.crimes.map((crime) => (
            <div
              key={crime.id}
              className="wb-mmo-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: "#fecaca" }}>{crime.name}</div>
                <div style={{ fontSize: 11.5, color: "#cbd5e1" }}>{crime.desc}</div>
                <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 2 }}>
                  期待報酬 ¥{crime.minReward.toLocaleString()}〜¥{crime.maxReward.toLocaleString()}{" "}
                  / 成功率 {Math.round(crime.baseSuccess * 100)}% / 手配+{crime.wantedHeat}★
                </div>
              </div>
              <button
                type="button"
                disabled={busy || Boolean(self?.jailed)}
                className="wb-mmo-btn wb-mmo-btn-danger"
                onClick={() => {
                  void postAction({ action: "commit_crime", crimeId: crime.id }).then((r) => {
                    if (!r) return;
                    if (r.success) {
                      setMsg(
                        `犯行成功！ +¥${Number(r.reward ?? 0).toLocaleString()} 奪取しました（手配度上昇中）`,
                      );
                    } else {
                      setMsg(
                        r.blockedByCamera
                          ? "防犯カメラが犯罪を捉えました！即座に刑務所へ収監されました。"
                          : "現場で取り押さえられ刑務所へ送致されました！",
                      );
                    }
                  });
                }}
              >
                決行
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "police" && data && (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="wb-mmo-card">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              🚨 指名手配プレイヤー {data.isPolice ? "（警察職ボーナス 1.25x+ 適用中）" : ""}
            </div>
            {data.wanted.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                現在指名手配中のオンラインプレイヤーはいません。
              </div>
            ) : (
              data.wanted.map((w) => (
                <div
                  key={w.ownerKey}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <div>
                    <strong>{w.name}</strong>{" "}
                    <span style={{ color: "#f87171" }}>{"★".repeat(w.wantedLevel)}</span>
                    <div style={{ fontSize: 11, color: "#fbbf24" }}>
                      懸賞金 ¥{w.bounty.toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || Boolean(self?.jailed)}
                    className="wb-mmo-btn wb-mmo-btn-cyan"
                    onClick={() => {
                      void postAction({
                        action: "arrest_player",
                        targetPresenceId: w.presenceId,
                      }).then((r) => {
                        if (r) {
                          setMsg(
                            `${String(r.arrestedName ?? "手配犯")}を逮捕！懸賞金 +¥${Number(r.reward ?? 0).toLocaleString()}`,
                          );
                        }
                      });
                    }}
                  >
                    逮捕する
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="wb-mmo-card">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              📜 メトロ警察・時限手配容疑者（NPC追捕依頼）
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {data.npcSuspects.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {s.name} <span style={{ color: "#f87171" }}>{"★".repeat(s.wantedLevel)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {s.crime} / 目撃地点: {s.district}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || Boolean(self?.jailed)}
                    className="wb-mmo-btn wb-mmo-btn-primary"
                    onClick={() => {
                      void postAction({ action: "arrest_npc", suspectId: s.id }).then((r) => {
                        if (r)
                          setMsg(
                            `${s.name} を確保！懸賞金 +¥${Number(r.reward ?? 0).toLocaleString()}`,
                          );
                      });
                    }}
                  >
                    追跡逮捕 (¥{s.bounty.toLocaleString()})
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "inmates" && data && (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="wb-mmo-card">
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              🏛 現在の収監者一覧 ({data.inmates.length}名)
            </div>
            {data.inmates.length === 0 ? (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                現在収監されている囚人はいません。
              </div>
            ) : (
              data.inmates.map((i) => (
                <div
                  key={i.ownerKey}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(148,163,184,0.12)",
                  }}
                >
                  <div>
                    <strong>{i.name}</strong>{" "}
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      ({i.inmateNumber} / {i.cellId})
                    </span>
                    <div style={{ fontSize: 11, color: "#cbd5e1" }}>
                      残り {fmtSec(i.remainingMs)} / 保釈金 ¥{i.bailCost.toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="wb-mmo-btn wb-mmo-btn-amber"
                    onClick={() => {
                      void postAction({ action: "pay_bail", targetOwnerKey: i.ownerKey }).then(
                        (r) => {
                          if (r) setMsg(`${i.name} の保釈金を肩代わりし釈放しました！`);
                        },
                      );
                    }}
                  >
                    保釈金を肩代わり
                  </button>
                </div>
              ))
            )}
          </div>

          {data.inmates.length > 0 && inventoryFoodAndTools.length > 0 && (
            <div className="wb-mmo-card">
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                🎁 面会・アイテム差し入れ（密輸も可）
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <select
                  value={careTarget}
                  onChange={(e) => setCareTarget(e.target.value)}
                  style={{
                    padding: 6,
                    borderRadius: 8,
                    background: "rgba(0,0,0,0.4)",
                    color: "#fff",
                    border: "1px solid rgba(148,163,184,0.3)",
                  }}
                >
                  {data.inmates.map((i) => (
                    <option key={i.ownerKey} value={i.ownerKey}>
                      {i.name} ({i.inmateNumber})
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={careItemId}
                    onChange={(e) => setCareItemId(e.target.value)}
                    style={{
                      flex: 1,
                      padding: 6,
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.4)",
                      color: "#fff",
                      border: "1px solid rgba(148,163,184,0.3)",
                    }}
                  >
                    {inventoryFoodAndTools.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.def?.name} (所持: {x.cnt})
                      </option>
                    ))}
                  </select>
                  <input
                    value={careMsg}
                    onChange={(e) => setCareMsg(e.target.value)}
                    maxLength={40}
                    placeholder="メッセージ"
                    style={{
                      flex: 1,
                      padding: 6,
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.4)",
                      color: "#fff",
                      border: "1px solid rgba(148,163,184,0.3)",
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !careTarget}
                    className="wb-mmo-btn wb-mmo-btn-cyan"
                    onClick={() => {
                      void postAction({
                        action: "care_package",
                        targetOwnerKey: careTarget,
                        itemId: careItemId,
                        message: careMsg,
                      }).then((r) => {
                        if (r) {
                          setCareMsg("");
                          setMsg("差し入れを届けました！");
                        }
                      });
                    }}
                  >
                    差し入れる
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
