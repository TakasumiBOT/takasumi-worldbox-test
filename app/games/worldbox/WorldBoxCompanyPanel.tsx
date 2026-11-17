"use client";
// WORLD BOX（Takasumi 版）の会社パネル。
// 設立・招待コードの発行と入力・メンバー管理・資産と取引履歴・
// 商品の作成と購入・ボーナス・設定変更・解散まで、会社の全操作を
// ここで完結させる。数字の規則はサーバー側（lib/worldbox/social/
// company.ts、TakasumiBOT v3 仕様）が正で、このパネルは表示と
// 入力だけを持つ。商品の内容テキストは購入レスポンスでだけ開示
// される（出品一覧には含めない）。
// Phase 4（空間化）: 本社の表示と登録（オーナーは現在地で登録）、
// 本社近くでの出社・退社と勤務（報酬は会社資産へ）、他社の詳細は
// 受付として開く（会社情報＋出品＋招待コードでの入社）。ワールドの
// 店舗看板や本社マーカーから開くときは anchorCompanyId でその会社
// の受付を最初から開く。
import { useCallback, useEffect, useState } from "react";

const panel: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(600px, calc(100% - 20px))",
  maxHeight: "calc(100% - 20px)",
  overflowY: "auto",
  overscrollBehavior: "contain",
  touchAction: "pan-y",
  padding: 12,
  borderRadius: 12,
  zIndex: 6,
};

const btn: React.CSSProperties = {
  minHeight: 36,
  padding: "4px 12px",
  borderRadius: 10,
  cursor: "pointer",
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  touchAction: "manipulation",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

const input: React.CSSProperties = {
  minHeight: 36,
  padding: "4px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(0,0,0,0.35)",
  color: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 700,
  margin: "14px 0 6px",
  fontSize: 15,
};

const ERROR_LABEL: Record<string, string> = {
  unauthorized: "ログインが必要です",
  guest_not_allowed: "ゲストは会社の機能を使えません",
  company_unavailable: "いま会社システムを使えません",
  economy_unavailable: "いま経済ブリッジを使えません",
  economy_failed: "お金の移動を受け付けられませんでした",
  not_enough_coins: "お金が足りません",
  invalid_name: "会社名は4〜20文字で入力してください",
  invalid_description: "会社の説明は5〜100文字で入力してください",
  invalid_capital: "資本金は100,000〜1,000,000円で入力してください",
  invalid_salary: "時給は1,000〜100,000円で入力してください",
  invalid_product:
    "商品の入力が不正です（名前1〜20字・説明1〜50字・内容1〜500字・価格100〜999,999円）",
  already_in_company: "すでに会社に所属しています",
  not_in_company: "会社に所属していません",
  not_owner: "オーナーだけが実行できます",
  not_member: "その社員は所属していません",
  company_full: "従業員が上限（15人）に達しています",
  invalid_code: "招待コードが不正か、失効しています",
  owner_cannot_leave: "オーナーは脱退できません（解散のみ）",
  cannot_dissolve: "解散はオーナーが1人だけのときだけできます",
  product_not_found: "その商品はもうありません",
  product_expired: "その商品は期限切れで削除されました",
  product_limit: "出品上限（15件）に達しています",
  position_unknown: "現在位置が分かりません（少し移動してから試してください）",
  hq_not_set: "本社が未登録です（オーナーが登録できます）",
  not_at_hq: "本社の近くでしかできません",
  not_on_duty: "先に本社の近くで出社してください",
  work_cooldown: "勤務は5分に1回までです",
  not_your_sign: "自分の看板でだけ登録できます",
  too_far: "看板の近くで操作してください",
  tax_unaffordable: "作成税を払う会社資産が足りません",
  bonus_cooldown: "その社員へのボーナスは23時間に1回までです",
  invalid_amount: "金額が不正です（100〜150,000円、会社資産の1/10まで）",
  store_failed: "保存に失敗しました",
};

interface CompanyProductView {
  id: string;
  companyId: string;
  creatorName: string;
  name: string;
  description: string;
  price: number;
  createdAt: number;
}

interface CompanyHqView {
  space: string;
  x: number;
  y: number;
}

interface CompanyView {
  id: string;
  name: string;
  description: string;
  assets: number;
  salary: number;
  createdAt: number;
  hq: CompanyHqView | null;
  isOwner: boolean;
  isMember: boolean;
  members: { ownerKey: string; name: string; joinedAt: number; owner: boolean }[];
  onDutyMembers: string[];
  stats: { totalEarn: number; totalUse: number; totalTax: number };
  products: CompanyProductView[];
  history: { at: number; amount: number; reason: string }[];
}

interface CompanySummary {
  id: string;
  name: string;
  description: string;
  assets: number;
  salary: number;
  memberCount: number;
  productCount: number;
  createdAt: number;
  hq: CompanyHqView | null;
}

interface DutyView {
  onDuty: boolean;
  since: number;
  lastWorkAt: number;
  nextWorkAt: number;
  workReward: number;
}

interface CompanyData {
  guest: boolean;
  company: CompanyView | null;
  companies: CompanySummary[];
  balance: number | null;
  detail: CompanyView | null;
  duty: DutyView | null;
}

const yen = (n: number) => `${n.toLocaleString()}円`;

/** 空間 ID の表示名（本社の場所の案内用）。 */
function spaceLabel(space: string): string {
  if (space === "world") return "ワールド";
  if (space === "lobby") return "ロビー";
  if (space === "lobby2") return "ロビー2F";
  if (space === "lobby3") return "ロビー3F";
  if (space === "tent") return "テント";
  if (space.startsWith("cave")) return "地下施設";
  if (space.startsWith("dungeon")) return "廃ビル";
  if (space.startsWith("ruins")) return "工事現場";
  return space;
}

function hqLabel(hq: CompanyHqView | null): string {
  if (!hq) return "未登録";
  return `${spaceLabel(hq.space)}（${hq.x}, ${hq.y}）`;
}

export default function WorldBoxCompanyPanel({
  onClose,
  anchorCompanyId = null,
}: {
  onClose: () => void;
  anchorCompanyId?: string | null;
}) {
  const [data, setData] = useState<CompanyData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [detailId, setDetailId] = useState<string | null>(anchorCompanyId);
  const [revealed, setRevealed] = useState<{ name: string; content: string } | null>(null);
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: number } | null>(null);

  // 設立フォーム
  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fCapital, setFCapital] = useState("100000");
  const [fSalary, setFSalary] = useState("1000");
  // 入社
  const [joinCode, setJoinCode] = useState("");
  // 設定
  const [sName, setSName] = useState("");
  const [sDesc, setSDesc] = useState("");
  const [sSalary, setSSalary] = useState("");
  // ボーナス
  const [bonusTarget, setBonusTarget] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  // 商品作成
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pContent, setPContent] = useState("");
  const [pPrice, setPPrice] = useState("1000");

  const refresh = useCallback(async (id: string | null) => {
    try {
      const res = await fetch(`/api/worldbox/company${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as CompanyData;
      setData(json);
      if (json.company) {
        setSName(json.company.name);
        setSDesc(json.company.description);
        setSSalary(String(json.company.salary));
      }
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh(detailId);
  }, [refresh, detailId]);

  const act = async (
    payload: Record<string, unknown>,
    describe?: (data: Record<string, unknown>) => string,
  ) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/worldbox/company", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
        error?: string;
      };
      if (!res.ok) {
        setMsg(ERROR_LABEL[json.error ?? ""] ?? "できませんでした");
        return;
      }
      if (payload.action === "invite" && typeof json.code === "string") {
        setIssuedCode({ code: json.code, expiresAt: Number(json.expiresAt ?? 0) });
      }
      if (payload.action === "product_buy" && typeof json.content === "string") {
        setRevealed({ name: String(json.name ?? "商品"), content: json.content });
      }
      if (describe) setMsg(describe(json));
      await refresh(detailId);
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const head = (text: string) => (
    <div style={panel} className="wb-panel" data-wb-se="self">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>会社</strong>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={onClose}>
          閉じる
        </button>
      </div>
      <p>{text}</p>
    </div>
  );

  if (loadFailed) return head("読み込みに失敗しました。");
  if (!data) return head("読み込み中…");
  if (data.guest) return head("会社の機能を使うには Discord ログインが必要です。");

  const company = data.company;
  const detail = data.detail;

  const productList = (view: CompanyView, buyable: boolean) => (
    <div>
      {view.products.length === 0 && <p style={{ opacity: 0.8 }}>出品中の商品はありません。</p>}
      {view.products.map((p) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>
              {p.name} <span style={{ opacity: 0.75 }}>{yen(p.price)}</span>
            </div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>
              {p.description}（出品: {p.creatorName || "社員"}）
            </div>
          </div>
          {buyable && (
            <button
              type="button"
              style={btn}
              disabled={busy}
              onClick={() => void act({ action: "product_buy", productId: p.id })}
            >
              購入
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div style={panel} className="wb-panel" data-wb-se="self">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <strong>会社</strong>
        {data.balance !== null && <span style={{ opacity: 0.85 }}>所持金 {yen(data.balance)}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={onClose}>
          閉じる
        </button>
      </div>
      {msg && <p role="status">{msg}</p>}
      {revealed && (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 10,
            padding: 10,
            marginTop: 10,
          }}
        >
          <div style={{ fontWeight: 700 }}>購入した商品「{revealed.name}」の内容</div>
          <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{revealed.content}</p>
        </div>
      )}

      {company ? (
        <div>
          <div style={sectionTitle}>
            {company.name}
            <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 13 }}>
              {" "}
              （ID: {company.id}）
            </span>
          </div>
          <p style={{ margin: "4px 0", opacity: 0.9 }}>{company.description}</p>
          <p style={{ margin: "4px 0" }}>
            会社資産 {yen(company.assets)} / 時給 {yen(company.salary)} / 従業員{" "}
            {company.members.length}人
          </p>
          <p style={{ margin: "4px 0", opacity: 0.85, fontSize: 13 }}>
            累計収益 {yen(company.stats.totalEarn)} ・ 累計支出 {yen(company.stats.totalUse)} ・
            累計納税 {yen(company.stats.totalTax)}
          </p>

          <div style={sectionTitle}>本社と勤務</div>
          <p style={{ margin: "4px 0" }}>
            本社: {hqLabel(company.hq)}
            <span style={{ opacity: 0.8, fontSize: 13 }}>
              （本社の近くで出社でき、勤務の報酬 {data.duty ? yen(data.duty.workReward) : ""}
              が会社資産に入ります）
            </span>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {company.isOwner && (
              <>
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() =>
                    void act({ action: "hq_set" }, (json) => {
                      const hq = json.hq as CompanyHqView | undefined;
                      return hq ? `本社を ${hqLabel(hq)} に登録しました` : "本社を登録しました";
                    })
                  }
                >
                  現在地を本社に登録
                </button>
                {company.hq && (
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => void act({ action: "hq_clear" }, () => "本社を解除しました")}
                  >
                    本社を解除
                  </button>
                )}
              </>
            )}
            {data.duty?.onDuty ? (
              <>
                <button
                  type="button"
                  style={btn}
                  disabled={busy || Date.now() < (data.duty?.nextWorkAt ?? 0)}
                  onClick={() =>
                    void act({ action: "work" }, (json) =>
                      typeof json.reward === "number"
                        ? `勤務しました。報酬 ${yen(json.reward)} が会社資産に入りました`
                        : "勤務しました",
                    )
                  }
                >
                  働く（報酬 {data.duty ? yen(data.duty.workReward) : ""}）
                </button>
                <button
                  type="button"
                  style={btn}
                  disabled={busy}
                  onClick={() => void act({ action: "clock_out" }, () => "退社しました")}
                >
                  退社
                </button>
              </>
            ) : (
              <button
                type="button"
                style={btn}
                disabled={busy || !company.hq}
                onClick={() => void act({ action: "clock_in" }, () => "出社しました")}
              >
                出社
              </button>
            )}
          </div>
          {data.duty?.onDuty && (
            <p style={{ margin: "4px 0", opacity: 0.85, fontSize: 13 }}>
              勤務中（{new Date(data.duty.since).toLocaleTimeString()} から）
              {Date.now() < data.duty.nextWorkAt &&
                ` ・ 次に働けるのは ${new Date(data.duty.nextWorkAt).toLocaleTimeString()} から`}
            </p>
          )}

          <div style={sectionTitle}>メンバー</div>
          {company.members.map((m) => (
            <div
              key={m.ownerKey}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}
            >
              <span style={{ flex: 1 }}>
                {m.name || "（名前なし）"}
                {m.owner ? "（オーナー）" : ""}
                {company.onDutyMembers.includes(m.ownerKey) ? "（勤務中）" : ""}
              </span>
              {company.isOwner && !m.owner && (
                <>
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => setBonusTarget(m.ownerKey)}
                  >
                    ボーナス
                  </button>
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() => void act({ action: "fire", targetKey: m.ownerKey })}
                  >
                    解雇
                  </button>
                </>
              )}
            </div>
          ))}
          {company.isOwner && bonusTarget && (
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                style={{ ...input, flex: 1 }}
                inputMode="numeric"
                placeholder="ボーナス額（円）"
                value={bonusAmount}
                onChange={(e) => setBonusAmount(e.target.value)}
              />
              <button
                type="button"
                style={btn}
                disabled={busy}
                onClick={() =>
                  void act(
                    { action: "bonus", targetKey: bonusTarget, amount: Number(bonusAmount) },
                    () => "ボーナスを支給しました（所得税15%を控除して入金されます）",
                  )
                }
              >
                支給
              </button>
              <button type="button" style={btn} onClick={() => setBonusTarget("")}>
                やめる
              </button>
            </div>
          )}

          {company.isOwner && (
            <>
              <div style={sectionTitle}>招待コード</div>
              <button
                type="button"
                style={btn}
                disabled={busy}
                onClick={() => void act({ action: "invite" })}
              >
                招待コードを発行
              </button>
              {issuedCode && (
                <p style={{ margin: "6px 0" }}>
                  コード: <strong>{issuedCode.code}</strong>
                  <span style={{ opacity: 0.8 }}>
                    （1回限り・{new Date(issuedCode.expiresAt).toLocaleTimeString()} まで有効）
                  </span>
                </p>
              )}
            </>
          )}

          <div style={sectionTitle}>商品を作る</div>
          <div style={{ display: "grid", gap: 6 }}>
            <input
              style={input}
              placeholder="商品名（1〜20文字）"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
            />
            <input
              style={input}
              placeholder="説明（1〜50文字）"
              value={pDesc}
              onChange={(e) => setPDesc(e.target.value)}
            />
            <input
              style={input}
              placeholder="内容（購入者だけに開示・1〜500文字）"
              value={pContent}
              onChange={(e) => setPContent(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...input, flex: 1 }}
                inputMode="numeric"
                placeholder="価格（円）"
                value={pPrice}
                onChange={(e) => setPPrice(e.target.value)}
              />
              <button
                type="button"
                style={btn}
                disabled={busy}
                onClick={() =>
                  void act(
                    {
                      action: "product_create",
                      name: pName,
                      description: pDesc,
                      content: pContent,
                      price: Number(pPrice),
                    },
                    () => "商品を出品しました（作成税15%を会社資産から支払いました）",
                  )
                }
              >
                出品
              </button>
            </div>
          </div>

          <div style={sectionTitle}>自社の出品</div>
          {productList(company, false)}

          <div style={sectionTitle}>取引履歴</div>
          {company.history.length === 0 && <p style={{ opacity: 0.8 }}>まだ履歴がありません。</p>}
          {company.history.map((h, i) => (
            <div
              key={`${h.at}-${i}`}
              style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 13 }}
            >
              <span style={{ opacity: 0.75 }}>{new Date(h.at).toLocaleString()}</span>
              <span style={{ flex: 1 }}>{h.reason}</span>
              <span>
                {h.amount >= 0 ? "+" : ""}
                {yen(h.amount)}
              </span>
            </div>
          ))}

          {company.isOwner && (
            <>
              <div style={sectionTitle}>会社設定（オーナー）</div>
              <div style={{ display: "grid", gap: 6 }}>
                <input
                  style={input}
                  placeholder="会社名（4〜20文字）"
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                />
                <input
                  style={input}
                  placeholder="説明（5〜100文字）"
                  value={sDesc}
                  onChange={(e) => setSDesc(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ ...input, flex: 1 }}
                    inputMode="numeric"
                    placeholder="時給（1,000〜100,000円）"
                    value={sSalary}
                    onChange={(e) => setSSalary(e.target.value)}
                  />
                  <button
                    type="button"
                    style={btn}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        {
                          action: "setting",
                          name: sName,
                          description: sDesc,
                          salary: Number(sSalary),
                        },
                        () => "設定を変更しました",
                      )
                    }
                  >
                    保存
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {!company.isOwner && (
              <button
                type="button"
                style={btn}
                disabled={busy}
                onClick={() => void act({ action: "leave" }, () => "脱退しました")}
              >
                脱退する
              </button>
            )}
            {company.isOwner && (
              <button
                type="button"
                style={btn}
                disabled={busy || company.members.length > 1}
                title={company.members.length > 1 ? "従業員を1人にしてから解散できます" : ""}
                onClick={() =>
                  void act({ action: "dissolve" }, () => "解散しました（残資産は返還されます）")
                }
              >
                解散する
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div style={sectionTitle}>会社を設立</div>
          <div style={{ display: "grid", gap: 6 }}>
            <input
              style={input}
              placeholder="会社名（4〜20文字）"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
            <input
              style={input}
              placeholder="会社の説明（5〜100文字）"
              value={fDesc}
              onChange={(e) => setFDesc(e.target.value)}
            />
            <input
              style={input}
              inputMode="numeric"
              placeholder="資本金（100,000〜1,000,000円）"
              value={fCapital}
              onChange={(e) => setFCapital(e.target.value)}
            />
            <input
              style={input}
              inputMode="numeric"
              placeholder="時給（1,000〜100,000円）"
              value={fSalary}
              onChange={(e) => setFSalary(e.target.value)}
            />
            <button
              type="button"
              style={btn}
              disabled={busy}
              onClick={() =>
                void act(
                  {
                    action: "create",
                    name: fName,
                    description: fDesc,
                    capital: Number(fCapital),
                    salary: Number(fSalary),
                  },
                  () => "会社を設立しました（設立税20%を差し引いた額が会社資産です）",
                )
              }
            >
              設立する
            </button>
          </div>

          <div style={sectionTitle}>招待コードで入社</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="招待コード（10文字）"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button
              type="button"
              style={btn}
              disabled={busy}
              onClick={() => void act({ action: "join", code: joinCode }, () => "入社しました")}
            >
              入社
            </button>
          </div>
        </div>
      )}

      <div style={sectionTitle}>会社一覧</div>
      {data.companies.length === 0 && <p style={{ opacity: 0.8 }}>まだ会社がありません。</p>}
      {data.companies.map((c) => (
        <div
          key={c.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{c.name}</div>
            <div style={{ opacity: 0.75, fontSize: 12 }}>
              資産 {yen(c.assets)} ・ 従業員 {c.memberCount}人 ・ 出品 {c.productCount}件
              {c.hq ? ` ・ 本社: ${hqLabel(c.hq)}` : ""}
            </div>
          </div>
          <button
            type="button"
            style={btn}
            onClick={() => setDetailId(detailId === c.id ? null : c.id)}
          >
            {detailId === c.id ? "閉じる" : "見る"}
          </button>
        </div>
      ))}
      {detail && detailId && (
        <div>
          <div style={sectionTitle}>{detail.name}（受付）</div>
          <p style={{ margin: "4px 0", opacity: 0.9 }}>{detail.description}</p>
          <p style={{ margin: "4px 0", opacity: 0.85, fontSize: 13 }}>
            従業員 {detail.members.length}人 ・ 時給 {yen(detail.salary)} ・ 本社:{" "}
            {hqLabel(detail.hq)}
          </p>
          {!company && !detail.isMember && (
            <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
              <input
                style={{ ...input, flex: 1 }}
                placeholder="招待コード（10文字）"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <button
                type="button"
                style={btn}
                disabled={busy}
                onClick={() => void act({ action: "join", code: joinCode }, () => "入社しました")}
              >
                この会社に入社
              </button>
            </div>
          )}
          <div style={sectionTitle}>
            {detail.name} の出品
            <span style={{ fontWeight: 400, opacity: 0.8, fontSize: 13 }}>
              （購入すると内容が開示され、商品は消えます）
            </span>
          </div>
          {productList(detail, true)}
        </div>
      )}
    </div>
  );
}
