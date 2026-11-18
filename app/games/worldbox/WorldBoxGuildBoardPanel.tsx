"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ITEMS, itemById } from "@/lib/worldbox/economy/items";
import {
  onGuildBoardChanged,
  onGuildRequestsChanged,
} from "@/lib/worldbox/social/guild-board-push";
import { ItemAnnotation, ItemSlot, ItemSlotGrid } from "./ItemSlotGrid";
import type { NationRole, NationsResponse } from "@/lib/worldbox/social/nations";
import type { PlayerProfile } from "@/lib/worldbox/player/profile";
import {
  ADVENTURE_ROLES,
  masteryRankOf,
  roleChangeCost,
  type AdventureRoleId,
} from "@/lib/worldbox/player/roles";
import type { GuildRequest } from "@/lib/worldbox/social/requests";

const ROLE_LABEL: Record<NationRole, string> = { king: "王", minister: "大臣", citizen: "国民" };

const REQUEST_ERROR_LABEL: Record<string, string> = {
  not_enough_coins: "お金が足りません",
  not_enough_items: "アイテムが足りません",
  too_many_guild: "依頼がいっぱいです",
  too_many_poster: "自分の依頼がいっぱいです",
  not_in_nation: "国に所属していません",
  not_at_guild_board: "ギルドボードの前で操作してください",
  invalid_reward: "報酬が不正です",
  invalid_count: "個数が不正です",
  unknown_item: "アイテムが不正です",
  not_found: "依頼が見つかりません",
  requests_unavailable: "いま使えません",
  economy_unavailable: "いま使えません",
  economy_failed: "受け付けられませんでした",
  store_failed: "保存に失敗しました",
  unauthorized: "ログインが必要です",
  discord_required: "Discord ログインが必要です",
};

const SETTINGS_ERROR_LABEL: Record<string, string> = {
  king_only: "王だけができます",
  not_at_guild_board: "ギルドボードの前で操作してください",
  not_member: "国民ではありません",
  no_union: "国に所属していません",
  invalid_tax_rate: "税率が不正です",
  invalid_visibility: "公開設定が不正です",
  invalid_target: "対象が不正です",
  store_failed: "保存に失敗しました",
  nation_settings_unavailable: "いま使えません",
  unauthorized: "ログインが必要です",
};

const TAX_RATE_PERCENT_STEPS = [0, 1, 2, 3, 5, 7, 10];

type NationSettingsMember = {
  key: string;
  name: string;
  tag: string;
  role: NationRole;
  appointed: boolean;
  discordMinister: boolean;
};

type NationSettingsData = {
  guildId: string;
  guildName: string;
  role: NationRole;
  taxRate: number;
  visibility: "open" | "private";
  taxCollected: number;
  members: NationSettingsMember[];
};

type RequestView = GuildRequest & { mine: boolean };

type RequestsData = {
  loggedIn: boolean;
  me: { guildId: string; guildName: string; role: NationRole } | null;
  requests: RequestView[];
};

const root: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(430px, calc(100% - 24px))",
  maxHeight: "calc(100% - 24px)",
  overflowY: "auto",
  padding: 14,
  borderRadius: 12,
  zIndex: 6,
  textAlign: "left",
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(10,12,20,0.94)",
  color: "#fff",
  boxShadow: "0 10px 32px rgba(0,0,0,0.55)",
};
const btn: React.CSSProperties = {
  minHeight: 38,
  padding: "4px 14px",
  borderRadius: 10,
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.07)",
  color: "inherit",
  touchAction: "manipulation",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};
const tabBtn: React.CSSProperties = { ...btn, minHeight: 34, padding: "2px 12px", fontSize: 13 };
const tabOn: React.CSSProperties = {
  background: "rgba(255,210,62,0.22)",
  borderColor: "rgba(255,210,62,0.8)",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  padding: "7px 0",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};
const input: React.CSSProperties = {
  minHeight: 38,
  padding: "4px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontSize: 14,
};

export default function WorldBoxGuildBoardPanel({
  nations,
  nationMsg,
  onNationAction,
  profile,
  onProfileChange,
  getPlayerPos,
  onClose,
  inviteGuildId,
}: {
  nations: NationsResponse;
  nationMsg: string;
  onNationAction: (body: Record<string, unknown>) => void;
  profile: PlayerProfile | null;
  onProfileChange: (profile: PlayerProfile) => void;
  getPlayerPos: () => { x: number; y: number };
  onClose: () => void;
  inviteGuildId?: string | null;
}) {
  const [tab, setTab] = useState<"requests" | "roles" | "adventure" | "board" | "settings">(
    "requests",
  );
  const [nsData, setNsData] = useState<NationSettingsData | null>(null);
  const [nsLoaded, setNsLoaded] = useState(false);
  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/worldbox/nation-settings", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) setNsData((await res.json()) as NationSettingsData);
      else setNsData(null);
    } catch {
      setNsData(null);
    } finally {
      setNsLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (tab === "settings") void refreshSettings();
  }, [tab, refreshSettings]);
  const settingsAct = async (body: Record<string, unknown>) => {
    setMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/worldbox/nation-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as NationSettingsData & { error?: string };
      if (!res.ok) {
        setMsg(SETTINGS_ERROR_LABEL[json.error as string] ?? "失敗しました");
        return;
      }
      setNsData(json);
    } catch {
      setMsg("失敗しました");
    } finally {
      setBusy(false);
    }
  };
  const [unionMsgs, setUnionMsgs] = useState<
    { name: string; text: string; at: number; source?: string }[]
  >([]);
  const [unionRole, setUnionRole] = useState<string>("");
  const [unionMode, setUnionMode] = useState<"global" | "channel" | "none">("none");
  const [unionLinkChannelId, setUnionLinkChannelId] = useState<string | null>(null);
  const [unionDirectory, setUnionDirectory] = useState<{
    channels: { id: string; name: string }[];
    globalChatChannelId: string | null;
  } | null>(null);
  const [unionPicking, setUnionPicking] = useState(false);
  const refreshUnion = useCallback(async () => {
    try {
      const [chatRes, setRes] = await Promise.all([
        fetch("/api/worldbox/chat?channel=union", { headers: { Accept: "application/json" } }),
        fetch("/api/worldbox/union-settings", { headers: { Accept: "application/json" } }),
      ]);
      if (chatRes.ok) {
        const data = (await chatRes.json()) as {
          messages?: { name: string; text: string; at: number; source?: string }[];
        };
        setUnionMsgs(data.messages ?? []);
      }
      if (setRes.ok) {
        const data = (await setRes.json()) as {
          role?: string;
          settings?: { mode?: "global" | "channel" | "none"; channelId?: string | null };
          directory?: {
            channels: { id: string; name: string }[];
            globalChatChannelId: string | null;
          } | null;
        };
        setUnionRole(data.role ?? "");
        setUnionMode(data.settings?.mode ?? "none");
        setUnionLinkChannelId(data.settings?.channelId ?? null);
        setUnionDirectory(data.directory ?? null);
      }
    } catch {
      /* 読めなくてもパネルは開いたままにする */
    }
  }, []);
  useEffect(() => {
    if (tab === "board") void refreshUnion();
  }, [tab, refreshUnion]);
  const [boardText, setBoardText] = useState("");
  const sendUnionPost = async () => {
    const text = boardText.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "union", text, space: "lobby" }),
      });
      if (res.ok) {
        setBoardText("");
        await refreshUnion();
      } else {
        setMsg(
          res.status === 429
            ? "少し待ってから送ってください"
            : res.status === 409
              ? "ユニオンに所属していません"
              : "送れませんでした",
        );
      }
    } catch {
      setMsg("送れませんでした");
    } finally {
      setBusy(false);
    }
  };
  const saveUnionLink = async (mode: "global" | "channel" | "none", channelId: string | null) => {
    setBusy(true);
    try {
      const res = await fetch("/api/worldbox/union-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, channelId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        settings?: { mode?: "global" | "channel" | "none"; channelId?: string | null };
        error?: string;
      };
      if (res.ok) {
        setUnionMode(json.settings?.mode ?? mode);
        setUnionLinkChannelId(json.settings?.channelId ?? null);
        setUnionPicking(false);
        setMsg("保存した");
      } else {
        setMsg(
          json.error === "directory_unavailable"
            ? "Discord側の準備待ちです"
            : json.error === "global_not_available"
              ? "グローバルチャットがありません"
              : json.error === "channel_not_listed"
                ? "そのチャンネルは選べません"
                : "保存できない",
        );
      }
    } catch {
      setMsg("保存できない");
    } finally {
      setBusy(false);
    }
  };
  const [data, setData] = useState<RequestsData | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [reqSel, setReqSel] = useState<string | null>(null);
  const [formItem, setFormItem] = useState<string>(ITEMS[0]?.id ?? "");
  const [formCount, setFormCount] = useState(1);
  const [formReward, setFormReward] = useState(100);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/worldbox/requests", {
        headers: { Accept: "application/json" },
      });
      if (res.ok) setData((await res.json()) as RequestsData);
    } catch {
      /* 読めなくてもパネルは開いたままにする */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(
    () =>
      onGuildRequestsChanged(() => {
        void refresh();
      }),
    [refresh],
  );
  useEffect(
    () =>
      onGuildBoardChanged(() => {
        if (tabRef.current === "board") void refreshUnion();
      }),
    [refreshUnion],
  );

  const act = async (
    body: Record<string, unknown>,
    done?: (res: Record<string, unknown>) => void,
  ) => {
    setMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/worldbox/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setMsg(REQUEST_ERROR_LABEL[json.error as string] ?? "失敗しました");
        return;
      }
      if (Array.isArray(json.requests)) {
        setData((prev) => (prev ? { ...prev, requests: json.requests as RequestView[] } : prev));
      }
      done?.(json);
    } catch {
      setMsg("失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const me = nations.me;
  const myNation = me ? (nations.nations.find((n) => n.id === me.nationId) ?? null) : null;
  const foundable = nations.myGuilds.filter((g) => g.owner && !g.hasNation);
  const joinable = nations.myGuilds.filter((g) => g.hasNation);
  const myGuildIds = new Set(nations.myGuilds.map((g) => g.guildId));
  const others = [...nations.nations]
    .filter((n) => !myGuildIds.has(n.guildId))
    .sort((a, b) => b.prosperity - a.prosperity);
  const pos = getPlayerPos();
  return (
    <div style={root} role="dialog" aria-label="ギルドボード" className="wb-panel">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          position: "sticky",
          top: -14,
          zIndex: 3,
          margin: "-14px -14px 0",
          padding: "14px 14px 8px",
          background: "rgba(10,12,20,0.98)",
        }}
      >
        <strong>ギルドボード</strong>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ ...tabBtn, ...(tab === "requests" ? tabOn : {}) }}
          aria-pressed={tab === "requests"}
          onClick={() => setTab("requests")}
        >
          依頼
        </button>
        <button
          type="button"
          style={{ ...tabBtn, ...(tab === "roles" ? tabOn : {}) }}
          aria-pressed={tab === "roles"}
          onClick={() => setTab("roles")}
        >
          役職
        </button>
        <button
          type="button"
          style={{ ...tabBtn, ...(tab === "adventure" ? tabOn : {}) }}
          aria-pressed={tab === "adventure"}
          onClick={() => setTab("adventure")}
        >
          職業
        </button>
        <button
          type="button"
          style={{ ...tabBtn, ...(tab === "board" ? tabOn : {}) }}
          aria-pressed={tab === "board"}
          onClick={() => setTab("board")}
        >
          掲示
        </button>
        <button
          type="button"
          style={{ ...tabBtn, ...(tab === "settings" ? tabOn : {}) }}
          aria-pressed={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          設定
        </button>
        <button type="button" style={tabBtn} onClick={onClose}>
          閉じる
        </button>
      </div>

      {tab === "requests" && (
        <div style={{ marginTop: 10 }}>
          {data === null ? (
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>読み込み中…</p>
          ) : !data.loggedIn ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, opacity: 0.75 }}>ログインが必要</span>
              <a
                href="/api/auth/discord/authorize?next=/games/worldbox"
                style={{
                  ...btn,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Discordでログイン
              </a>
            </div>
          ) : !data.me ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, opacity: 0.75 }}>国に所属していません</span>
              <button type="button" style={btn} onClick={() => setTab("roles")}>
                役職を見る
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{data.me.guildName}</strong>
                <span style={{ fontSize: 13, opacity: 0.75 }}>{ROLE_LABEL[data.me.role]}</span>
              </div>
              {data.requests.length === 0 ? (
                <p style={{ margin: "10px 0 0", fontSize: 13, opacity: 0.75 }}>依頼はありません</p>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {data.requests.map((r) => {
                    const have = profile?.items[r.itemId] ?? 0;
                    return (
                      <div key={r.id} style={rowStyle}>
                        <ItemSlot
                          itemId={r.itemId}
                          count={r.count}
                          badge={`${r.reward}`}
                          selected={reqSel === r.id}
                          onClick={() => setReqSel(r.id)}
                        />
                        <span style={{ fontSize: 12, opacity: 0.75 }}>{r.posterName}</span>
                        <span style={{ flex: 1 }} />
                        {r.mine ? (
                          <button
                            type="button"
                            style={btn}
                            disabled={busy}
                            onClick={() => void act({ action: "cancel", requestId: r.id })}
                          >
                            取消
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={btn}
                            disabled={busy || have < r.count}
                            onClick={() =>
                              void act({ action: "fulfill", requestId: r.id }, (res) => {
                                if (res.profile) onProfileChange(res.profile as PlayerProfile);
                              })
                            }
                          >
                            納品（所持 {have}）
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(() => {
                    const sel = data.requests.find((r) => r.id === reqSel);
                    if (!sel) return null;
                    return (
                      <ItemAnnotation itemId={sel.itemId}>
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          <span className="muted">
                            報酬 {sel.reward} 円 ／ 所持 {profile?.items[sel.itemId] ?? 0}
                          </span>
                        </div>
                      </ItemAnnotation>
                    );
                  })()}
                </div>
              )}
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <div style={{ maxHeight: 168, overflowY: "auto", overscrollBehavior: "contain" }}>
                  <ItemSlotGrid>
                    {ITEMS.map((item) => (
                      <ItemSlot
                        key={item.id}
                        itemId={item.id}
                        selected={formItem === item.id}
                        onClick={() => setFormItem(item.id)}
                      />
                    ))}
                  </ItemSlotGrid>
                </div>
                {formItem && (
                  <div style={{ fontSize: 13, marginTop: 6 }}>
                    {itemById(formItem)?.name ?? formItem}
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  marginTop: 8,
                }}
              >
                <input
                  aria-label="個数"
                  type="number"
                  min={1}
                  max={99}
                  value={formCount}
                  onChange={(e) => setFormCount(Number(e.target.value))}
                  style={{ ...input, width: 64 }}
                />
                <input
                  aria-label="報酬"
                  type="number"
                  min={1}
                  value={formReward}
                  onChange={(e) => setFormReward(Number(e.target.value))}
                  style={{ ...input, width: 96 }}
                />
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: "post",
                      itemId: formItem,
                      count: formCount,
                      reward: formReward,
                    })
                  }
                >
                  依頼を出す
                </button>
              </div>
            </div>
          )}
          {msg && (
            <p role="status" style={{ margin: "10px 0 0", fontSize: 13 }}>
              {msg}
            </p>
          )}
        </div>
      )}

      {tab === "adventure" && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.values(ADVENTURE_ROLES).map((r) => {
            const rank = profile ? masteryRankOf(profile, r.id) : 1;
            const current = profile?.role === r.id;
            const cost = profile && !current ? roleChangeCost(profile, r.id) : 0;
            return (
              <div key={r.id} style={{ ...rowStyle, justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      fontSize: 14,
                      fontWeight: 700,
                      border: "1px solid rgba(255,255,255,0.35)",
                      background: current ? "rgba(255,210,62,0.25)" : "rgba(255,255,255,0.08)",
                    }}
                  >
                    {r.symbol}
                  </span>
                  <strong>{r.name}</strong>
                  <span
                    aria-label={`熟練ランク ${rank}`}
                    style={{ letterSpacing: 2, fontSize: 11 }}
                  >
                    {"●".repeat(rank)}
                    <span style={{ opacity: 0.3 }}>{"●".repeat(5 - rank)}</span>
                  </span>
                  <span style={{ flexBasis: "100%", paddingLeft: 34, fontSize: 11, opacity: 0.75 }}>
                    常時: {r.passiveName} ・ 専門: {r.specialtyName}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {cost > 0 && (
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                      {cost.toLocaleString("ja-JP")} 円
                    </span>
                  )}
                  <button
                    type="button"
                    style={{ ...btn, ...(current ? tabOn : {}) }}
                    disabled={busy || current || !profile}
                    onClick={async () => {
                      setBusy(true);
                      setMsg("");
                      try {
                        const res = await fetch("/api/worldbox/roles", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "set_role",
                            role: r.id as AdventureRoleId,
                          }),
                        });
                        const json = (await res.json().catch(() => ({}))) as {
                          profile?: PlayerProfile;
                          error?: string;
                        };
                        if (res.ok && json.profile) {
                          onProfileChange(json.profile);
                          setMsg(`${r.name}になりました`);
                        } else {
                          setMsg(
                            json.error === "not_at_guild_board"
                              ? "ギルドボードの前で操作してください"
                              : json.error === "not_enough_coins"
                                ? "お金が足りません"
                                : "変更できませんでした",
                          );
                        }
                      } catch {
                        setMsg("変更できませんでした");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {current ? "選択中" : "選ぶ"}
                  </button>
                </span>
              </div>
            );
          })}
          {msg && <div style={{ fontSize: 13 }}>{msg}</div>}
        </div>
      )}

      {tab === "board" && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {unionMsgs.length === 0 ? (
              <span style={{ fontSize: 13, opacity: 0.75 }}>まだ投稿がない</span>
            ) : (
              [...unionMsgs].reverse().map((m, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <strong>{m.name}</strong>
                  {m.source === "discord" && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        padding: "1px 5px",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.35)",
                      }}
                    >
                      Discord
                    </span>
                  )}
                  <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 11 }}>
                    {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div>{m.text}</div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input
              value={boardText}
              onChange={(e) => setBoardText(e.target.value)}
              placeholder="ユニオンへ投稿"
              maxLength={120}
              style={{ ...input, flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendUnionPost();
              }}
            />
            <button
              type="button"
              style={btn}
              disabled={busy || !boardText.trim()}
              onClick={() => void sendUnionPost()}
            >
              送る
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Discord連携</span>
              {unionDirectory === null ? (
                <span style={{ fontSize: 12, opacity: 0.75 }}>Discord側の準備待ち</span>
              ) : (
                <>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    {unionMode === "global"
                      ? "グローバルチャット"
                      : unionMode === "channel"
                        ? (unionDirectory.channels.find((c) => c.id === unionLinkChannelId)?.name ??
                          "専用チャンネル")
                        : "連携なし"}
                  </span>
                  {(unionRole === "king" || unionRole === "minister") && (
                    <>
                      <button
                        type="button"
                        style={{ ...tabBtn, ...(unionMode === "global" ? tabOn : {}) }}
                        disabled={busy || !unionDirectory.globalChatChannelId}
                        aria-pressed={unionMode === "global"}
                        onClick={() => {
                          void saveUnionLink("global", null);
                        }}
                      >
                        グローバルチャット
                      </button>
                      <button
                        type="button"
                        style={{ ...tabBtn, ...(unionMode === "channel" ? tabOn : {}) }}
                        disabled={busy}
                        aria-pressed={unionMode === "channel"}
                        onClick={() => setUnionPicking((v) => !v)}
                      >
                        専用チャンネル
                      </button>
                      <button
                        type="button"
                        style={{ ...tabBtn, ...(unionMode === "none" ? tabOn : {}) }}
                        disabled={busy}
                        aria-pressed={unionMode === "none"}
                        onClick={() => {
                          void saveUnionLink("none", null);
                        }}
                      >
                        連携なし
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            {unionDirectory !== null &&
              unionPicking &&
              (unionRole === "king" || unionRole === "minister") && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    marginTop: 6,
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {unionDirectory.channels.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      style={{
                        ...btn,
                        textAlign: "left",
                        ...(unionLinkChannelId === c.id && unionMode === "channel" ? tabOn : {}),
                      }}
                      disabled={busy}
                      onClick={() => {
                        void saveUnionLink("channel", c.id);
                      }}
                    >
                      #{c.name}
                    </button>
                  ))}
                </div>
              )}
          </div>
          {msg && <div style={{ fontSize: 13, marginTop: 6 }}>{msg}</div>}
        </div>
      )}

      {tab === "settings" && (
        <div style={{ marginTop: 10 }}>
          {!nsLoaded ? (
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>読み込み中…</p>
          ) : !nsData ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, opacity: 0.75 }}>国に所属していません</span>
              <button type="button" style={btn} onClick={() => setTab("roles")}>
                役職を見る
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {(() => {
                  const color = nations.nations.find((n) => n.id === nsData.guildId)?.color;
                  return color ? (
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: color,
                        display: "inline-block",
                      }}
                    />
                  ) : null;
                })()}
                <strong style={{ fontSize: 14 }}>{nsData.guildName}</strong>
                <span style={{ fontSize: 13, opacity: 0.75 }}>{ROLE_LABEL[nsData.role]}</span>
              </div>
              <div style={rowStyle}>
                <span style={{ fontSize: 13, opacity: 0.8 }}>税率</span>
                <span style={{ flex: 1 }} />
                {nsData.role === "king" ? (
                  TAX_RATE_PERCENT_STEPS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      style={{
                        ...tabBtn,
                        ...(Math.round(nsData.taxRate * 100) === p ? tabOn : {}),
                      }}
                      aria-pressed={Math.round(nsData.taxRate * 100) === p}
                      disabled={busy}
                      onClick={() => void settingsAct({ action: "set_tax", taxRate: p / 100 })}
                    >
                      {p}%
                    </button>
                  ))
                ) : (
                  <span style={{ fontSize: 14 }}>{Math.round(nsData.taxRate * 100)}%</span>
                )}
              </div>
              <div style={rowStyle}>
                <span style={{ fontSize: 13, opacity: 0.8 }}>公開</span>
                <span style={{ flex: 1 }} />
                {nsData.role === "king" ? (
                  <>
                    <button
                      type="button"
                      style={{ ...tabBtn, ...(nsData.visibility === "open" ? tabOn : {}) }}
                      aria-pressed={nsData.visibility === "open"}
                      disabled={busy}
                      onClick={() =>
                        void settingsAct({ action: "set_visibility", visibility: "open" })
                      }
                    >
                      公開
                    </button>
                    <button
                      type="button"
                      style={{ ...tabBtn, ...(nsData.visibility === "private" ? tabOn : {}) }}
                      aria-pressed={nsData.visibility === "private"}
                      disabled={busy}
                      onClick={() =>
                        void settingsAct({ action: "set_visibility", visibility: "private" })
                      }
                    >
                      非公開
                    </button>
                  </>
                ) : (
                  <span style={{ fontSize: 14 }}>
                    {nsData.visibility === "private" ? "非公開" : "公開"}
                  </span>
                )}
              </div>
              <div style={rowStyle}>
                <span style={{ fontSize: 13, opacity: 0.8 }}>税収</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 14 }}>{nsData.taxCollected.toLocaleString("ja-JP")}</span>
              </div>
              <p style={{ margin: "10px 0 6px", fontSize: 13 }}>大臣</p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {nsData.members
                  .filter((m) => m.role !== "king")
                  .map((m) => (
                    <li key={m.key} style={rowStyle}>
                      <span style={{ fontSize: 14 }}>{m.name}</span>
                      {m.appointed && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "1px 6px",
                            borderRadius: 6,
                            border: "1px solid rgba(255,210,62,0.7)",
                            color: "#ffd23e",
                          }}
                        >
                          任命
                        </span>
                      )}
                      {m.discordMinister && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "1px 6px",
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.35)",
                            opacity: 0.85,
                          }}
                        >
                          Discord
                        </span>
                      )}
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{ROLE_LABEL[m.role]}</span>
                      <span style={{ flex: 1 }} />
                      {nsData.role === "king" &&
                        (m.appointed ? (
                          <button
                            type="button"
                            style={btn}
                            disabled={busy}
                            onClick={() =>
                              void settingsAct({
                                action: "set_minister",
                                targetKey: m.key,
                                minister: false,
                              })
                            }
                          >
                            解除
                          </button>
                        ) : (
                          <button
                            type="button"
                            style={btn}
                            disabled={busy}
                            onClick={() =>
                              void settingsAct({
                                action: "set_minister",
                                targetKey: m.key,
                                minister: true,
                              })
                            }
                          >
                            大臣にする
                          </button>
                        ))}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {msg && (
            <p role="status" style={{ margin: "10px 0 0", fontSize: 13 }}>
              {msg}
            </p>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div style={{ marginTop: 10 }}>
          {me && myNation ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: myNation.color,
                  display: "inline-block",
                }}
              />
              <strong>{myNation.name}</strong>
              <span>{ROLE_LABEL[me.role]}</span>
              <span style={{ opacity: 0.75, fontSize: 13 }}>国民 {myNation.members}人</span>
              <span style={{ opacity: 0.75, fontSize: 13 }}>繁栄度 {myNation.prosperity}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                style={btn}
                onClick={() => {
                  const url = `${window.location.origin}/games/worldbox?union=${myNation.guildId}`;
                  if (navigator.clipboard) {
                    void navigator.clipboard.writeText(url).then(
                      () => setMsg("招待リンクをコピーした"),
                      () => setMsg(url),
                    );
                  } else {
                    setMsg(url);
                  }
                }}
              >
                招待リンク
              </button>
              <button type="button" style={btn} onClick={() => onNationAction({ action: "leave" })}>
                {me.role === "king" && myNation.members <= 1 ? "解散" : "離脱"}
              </button>
            </div>
          ) : (
            <div>
              {nations.loggedIn && nations.guildsScopeRequired && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 13, opacity: 0.75 }}>
                    サーバー一覧の取得に再ログインが必要
                  </span>
                  <a
                    href="/api/auth/discord/authorize?next=/games/worldbox"
                    style={{
                      ...btn,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    Discordで再ログイン
                  </a>
                </div>
              )}
              {nations.loggedIn && !nations.guildsScopeRequired && foundable.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 13 }}>建国できるサーバー</p>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                    {foundable.map((g) => (
                      <li
                        key={g.guildId}
                        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                      >
                        <strong>{g.name}</strong>
                        <span style={{ flex: 1 }} />
                        <button
                          type="button"
                          style={btn}
                          onClick={() => onNationAction({ action: "found", guildId: g.guildId })}
                        >
                          建国
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {nations.loggedIn && !nations.guildsScopeRequired && joinable.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: "0 0 6px", fontSize: 13 }}>国があるサーバー</p>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                    {[...joinable]
                      .sort(
                        (a, b) =>
                          (a.guildId === inviteGuildId ? -1 : 0) -
                          (b.guildId === inviteGuildId ? -1 : 0),
                      )
                      .map((g) => {
                        const n = nations.nations.find((x) => x.guildId === g.guildId);
                        return (
                          <li
                            key={g.guildId}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                              ...(g.guildId === inviteGuildId
                                ? {
                                    border: "1px solid #e8c85a",
                                    borderRadius: 8,
                                    padding: "4px 6px",
                                  }
                                : {}),
                            }}
                          >
                            {n && (
                              <span
                                aria-hidden
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: 3,
                                  background: n.color,
                                  display: "inline-block",
                                }}
                              />
                            )}
                            <strong>{g.name}</strong>
                            <span style={{ opacity: 0.75, fontSize: 13 }}>
                              {ROLE_LABEL[g.myRole]}
                              {n ? ` ・ ${n.members}人` : ""}
                            </span>
                            <span style={{ flex: 1 }} />
                            <button
                              type="button"
                              style={btn}
                              onClick={() => onNationAction({ action: "join", guildId: g.guildId })}
                            >
                              参加
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              )}
              {others.length === 0 && joinable.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>まだ国はありません</p>
              ) : others.length > 0 ? (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {others.map((n) => {
                    const dist = Math.round(
                      Math.hypot(n.capital.x + 0.5 - pos.x, n.capital.y + 0.5 - pos.y),
                    );
                    return (
                      <li
                        key={n.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          opacity: 0.55,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            background: n.color,
                            display: "inline-block",
                          }}
                        />
                        <strong>{n.name}</strong>
                        <span style={{ fontSize: 13 }}>
                          {n.members}人 ・ 繁栄度 {n.prosperity} ・ {dist}タイル
                        </span>
                        <span style={{ flex: 1 }} />
                        {nations.loggedIn && (
                          <button type="button" style={btn} disabled>
                            参加
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!nations.loggedIn && (
                <p style={{ margin: "10px 0 0", fontSize: 13, opacity: 0.75 }}>
                  建国・参加はログイン後
                </p>
              )}
            </div>
          )}
          {nationMsg && (
            <p role="status" style={{ margin: "10px 0 0", fontSize: 13 }}>
              {nationMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
