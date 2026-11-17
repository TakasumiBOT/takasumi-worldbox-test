// WORLD BOX（Takasumi 版）の会社システム（純粋ロジック）。
// 数字とルールの正は TakasumiBOT v3 の会社仕様（V3-COMPANY-SPEC.md）:
// 設立税20%・従業員上限15人・招待コード10文字/使い切り/1時間・
// 時給は 8〜20 時に毎時支給（社長 ×1.15、所得税15%を控除、
// 会社資産が給料総額に不足する回は全員スキップ）・商品は情報の
// 売り切り（作成税15%・売却税50%・出品上限15件・寿命1週間）・
// ボーナス（100〜150,000、会社資産の1/10まで、受取人ごと23時間）・
// 法人税（3時間ごとの直近利益へ累進 0〜70%）。
//
// お金の器: 会社資産（assets）は bot_kv 上の会社台帳で、個人残高とは
// 別の財布。個人残高との出入りは経済ブリッジのオプ経由でのみ行う
// （company-online.ts / ルート側）: 個人→会社は spend オプで国庫へ
// 払い込み、会社→個人は earn オプで国庫から払い出す。v3 の
// 「すべてのお金は国庫を介する」モデルの写しで、台帳の増減と
// オプの適用が対になる。会社内部だけの動き（税・商品代金の付け替え）
// は台帳の増減と取引履歴だけで完結する。
//
// 社員の稼ぎの会社帰属（v3 の /work 相当）について: WORLD BOX に
// /work は無く、ワールド内の収入は理由ごとに別々のルートがその場で
// 個人へ earn オプを積む形（harvest / shop_sale / guild_shop_sale /
// guild_request_reward 等）で散っている。全経路に所属判定を差し込む
// と「行為のフィードバックとしての受取」が会社都合で化けるため、
// ここでは配線しない。接続は Phase 4 の「出社（勤務行為）」で、
// 勤務という明示的な行為の報酬だけを会社へ帰属させる設計とする
// （ROADMAP-MODERN.md Phase 4）。無所属者の収入には一切触らない。
// ユニオン・ギルド・国家とは独立のシステムとして併存する（G2 確定）。

/** 会社名の長さ（v3: 4〜20文字）。 */
export const COMPANY_NAME_MIN = 4;
export const COMPANY_NAME_MAX = 20;
/** 会社の説明の長さ（v3: 5〜100文字）。 */
export const COMPANY_DESCRIPTION_MIN = 5;
export const COMPANY_DESCRIPTION_MAX = 100;
/** 資本金の下限（v3: 100,000）。 */
export const COMPANY_CAPITAL_MIN = 100_000;
/**
 * 資本金の上限。v3 に明示は無いが、個人→会社の払い込みは経済
 * ブリッジの spend オプ（1件 1,000,000 まで）で運ぶため、その上限に
 * 合わせる。解散返還など会社→個人の払い出しは分割して運ぶ。
 */
export const COMPANY_CAPITAL_MAX = 1_000_000;
/** 会社設立税率（v3: 資本金の20%）。 */
export const COMPANY_ESTABLISH_TAX_RATE = 0.2;
/** 従業員上限（v3: 15人、オーナー含む）。 */
export const COMPANY_MEMBER_LIMIT = 15;
/** 時給の範囲（v3: minWage 1,000 〜 maxWage 100,000）。 */
export const COMPANY_SALARY_MIN = 1_000;
export const COMPANY_SALARY_MAX = 100_000;
/** 社長（オーナー）の給料倍率（v3: ×1.15）。 */
export const COMPANY_OWNER_SALARY_MULTIPLIER = 1.15;
/** 所得税率（v3: 給料・ボーナスの受取時に15%控除）。 */
export const COMPANY_INCOME_TAX_RATE = 0.15;
/** 給料支給の時間帯（JST、開始・終了ともに含む。v3: 8〜20時の毎時）。 */
export const COMPANY_SALARY_HOUR_START = 8;
export const COMPANY_SALARY_HOUR_END = 20;
/** 招待コード（v3: 10文字・使い切り・1時間で失効）。 */
export const COMPANY_INVITE_CODE_LENGTH = 10;
export const COMPANY_INVITE_TTL_MS = 3_600_000;
/** 商品の文字列長（v3: 名前1〜20・説明1〜50・内容1〜500）。 */
export const COMPANY_PRODUCT_NAME_MAX = 20;
export const COMPANY_PRODUCT_DESCRIPTION_MAX = 50;
export const COMPANY_PRODUCT_CONTENT_MAX = 500;
/** 商品価格（v3: 100以上、入力は最大6桁）。 */
export const COMPANY_PRODUCT_PRICE_MIN = 100;
export const COMPANY_PRODUCT_PRICE_MAX = 999_999;
/** 商品作成税率（v3: 価格の15%を会社資産から）。 */
export const COMPANY_PRODUCT_CREATE_TAX_RATE = 0.15;
/** 商品売却税率（v3: 価格の50%が国庫へ、会社の取り分は50%）。 */
export const COMPANY_PRODUCT_SALE_TAX_RATE = 0.5;
/** 会社あたりの同時出品上限（v3: 15件）。 */
export const COMPANY_PRODUCT_LIMIT = 15;
/** 商品の寿命（v3: 1週間で自動削除）。 */
export const COMPANY_PRODUCT_TTL_MS = 7 * 24 * 3_600_000;
/** ボーナス金額の範囲（v3: 100〜150,000、かつ会社資産の1/10まで）。 */
export const COMPANY_BONUS_MIN = 100;
export const COMPANY_BONUS_MAX = 150_000;
export const COMPANY_BONUS_ASSETS_DIVISOR = 10;
/** ボーナスの受取人ごとクールダウン（v3: 23時間 = 82,800,000ms）。 */
export const COMPANY_BONUS_COOLDOWN_MS = 82_800_000;
/** 法人税の課税ウィンドウ（v3: 3時間ごとに直近3時間の利益）。 */
export const COMPANY_TAX_WINDOW_MS = 3 * 3_600_000;
/** 取引履歴の保持件数（会社ごと、直近分）。 */
export const COMPANY_HISTORY_LIMIT = 200;
/** 資本金追加の履歴理由。法人税の利益計算から除外される唯一の入金。 */
export const COMPANY_CAPITAL_REASON = "会社の資本金の追加";

/**
 * 法人税の累進ブラケット（v3: CompanyBenefitTaxBrackets）。
 * [そのブラケットの上限（利益額）, その帯域にかかる税率] の昇順。
 * 帯域ごとの限界税率として計算する。
 */
export const COMPANY_TAX_BRACKETS: readonly (readonly [number, number])[] = [
  [5_000, 0],
  [10_000, 0.12],
  [30_000, 0.15],
  [50_000, 0.18],
  [80_000, 0.22],
  [100_000, 0.25],
  [200_000, 0.3],
  [300_000, 0.4],
  [400_000, 0.5],
  [500_000, 0.6],
  [Number.POSITIVE_INFINITY, 0.7],
];

export interface CompanyMember {
  ownerKey: string;
  discordId: string;
  name: string;
  joinedAt: number;
}

export interface CompanyStats {
  totalEarn: number;
  totalUse: number;
  totalTax: number;
}

export interface Company {
  id: string;
  name: string;
  description: string;
  /** オーナーの所有者キー（"discord:<id>"）。 */
  ownerKey: string;
  /** 会社資産（会社財布）。個人残高とは別の台帳。 */
  assets: number;
  /** 時給（全社員共通の支給額設定）。 */
  salary: number;
  createdAt: number;
  members: CompanyMember[];
  /** 出品中の商品 ID（会社あたり最大 COMPANY_PRODUCT_LIMIT 件）。 */
  productIds: string[];
  stats: CompanyStats;
  /** ボーナスの最終支給時刻（受取人の所有者キーごと）。 */
  lastBonusAt: Record<string, number>;
  /** 給料支給済みの JST 時間キー（冪等化用、"YYYY-MM-DDTHH"）。 */
  lastSalaryKey: string;
  /** 法人税徴収済みの JST 3時間ウィンドウキー（冪等化用）。 */
  lastTaxKey: string;
}

export interface CompanyHistoryEntry {
  at: number;
  /** 実行者の Discord ID（システム処理では ""）。 */
  userId: string;
  /** 符号付き金額（入金は正、出金は負）。 */
  amount: number;
  reason: string;
}

export interface CompanyProduct {
  id: string;
  companyId: string;
  creatorKey: string;
  creatorName: string;
  name: string;
  description: string;
  /** 購入者にだけ開示される内容テキスト。 */
  content: string;
  price: number;
  createdAt: number;
}

export interface CompanyInvite {
  code: string;
  companyId: string;
  createdAt: number;
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(length: number, rand: () => number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ID_CHARS[Math.min(ID_CHARS.length - 1, Math.floor(rand() * ID_CHARS.length))];
  }
  return out;
}

/** 会社 ID（v3 と同じ10文字）。 */
export function makeCompanyId(rand: () => number = Math.random): string {
  return randomString(10, rand);
}

/** 招待コード（v3 と同じ10文字）。 */
export function makeInviteCode(rand: () => number = Math.random): string {
  return randomString(COMPANY_INVITE_CODE_LENGTH, rand);
}

/** 商品 ID（v3 と同じ8文字）。 */
export function makeProductId(rand: () => number = Math.random): string {
  return randomString(8, rand);
}

/** 会社 ID の形（bot_kv のキー判別にも使う）。 */
export function isCompanyId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 会社名: 前後の空白を落として 4〜20文字のときだけ通す。 */
export function validateCompanyName(value: unknown): string | null {
  const name = trimmed(value);
  return name.length >= COMPANY_NAME_MIN && name.length <= COMPANY_NAME_MAX ? name : null;
}

/** 会社の説明: 前後の空白を落として 5〜100文字のときだけ通す。 */
export function validateCompanyDescription(value: unknown): string | null {
  const text = trimmed(value);
  return text.length >= COMPANY_DESCRIPTION_MIN && text.length <= COMPANY_DESCRIPTION_MAX
    ? text
    : null;
}

/** 資本金: 整数 100,000〜1,000,000 のときだけ通す。 */
export function validateCompanyCapital(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= COMPANY_CAPITAL_MIN && value <= COMPANY_CAPITAL_MAX ? value : null;
}

/** 時給: 整数 1,000〜100,000 のときだけ通す。 */
export function validateCompanySalary(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= COMPANY_SALARY_MIN && value <= COMPANY_SALARY_MAX ? value : null;
}

/** 商品の入力検証。通れば正規化した値を返す。 */
export function validateProductInput(value: {
  name?: unknown;
  description?: unknown;
  content?: unknown;
  price?: unknown;
}): { name: string; description: string; content: string; price: number } | null {
  const name = trimmed(value.name);
  const description = trimmed(value.description);
  const content = trimmed(value.content);
  if (name.length < 1 || name.length > COMPANY_PRODUCT_NAME_MAX) return null;
  if (description.length < 1 || description.length > COMPANY_PRODUCT_DESCRIPTION_MAX) return null;
  if (content.length < 1 || content.length > COMPANY_PRODUCT_CONTENT_MAX) return null;
  if (typeof value.price !== "number" || !Number.isInteger(value.price)) return null;
  if (value.price < COMPANY_PRODUCT_PRICE_MIN || value.price > COMPANY_PRODUCT_PRICE_MAX)
    return null;
  return { name, description, content, price: value.price };
}

/** 税額（率を掛けて切り捨て）。 */
function taxOf(amount: number, rate: number): number {
  return Math.floor(amount * rate);
}

/** 設立税（資本金の20%）。 */
export function establishmentTax(capital: number): number {
  return taxOf(capital, COMPANY_ESTABLISH_TAX_RATE);
}

/** 所得税（給料・ボーナスの受取時に控除される15%）。 */
export function incomeTax(amount: number): number {
  return taxOf(amount, COMPANY_INCOME_TAX_RATE);
}

/** 商品作成税（価格の15%）。 */
export function productCreateTax(price: number): number {
  return taxOf(price, COMPANY_PRODUCT_CREATE_TAX_RATE);
}

/** 商品売却税（価格の50%）。 */
export function productSaleTax(price: number): number {
  return taxOf(price, COMPANY_PRODUCT_SALE_TAX_RATE);
}

/** 社員1人の給料総額（オーナーは時給 ×1.15、切り捨て）。 */
export function salaryGrossFor(company: Company, member: CompanyMember): number {
  if (member.ownerKey === company.ownerKey) {
    return Math.floor(company.salary * COMPANY_OWNER_SALARY_MULTIPLIER);
  }
  return company.salary;
}

/** 法人税（直近利益への累進課税、帯域ごとの限界税率で計算し総額を切り捨て）。 */
export function corporateTaxFor(profit: number): number {
  if (!Number.isFinite(profit) || profit <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const [limit, rate] of COMPANY_TAX_BRACKETS) {
    if (profit <= lower) break;
    const band = Math.min(profit, limit) - lower;
    tax += band * rate;
    lower = limit;
  }
  return Math.floor(tax);
}

export function isCompanyOwner(company: Company, ownerKey: string): boolean {
  return company.ownerKey === ownerKey;
}

export function isCompanyMember(company: Company, ownerKey: string): boolean {
  return company.members.some((m) => m.ownerKey === ownerKey);
}

export function memberOf(company: Company, ownerKey: string): CompanyMember | null {
  return company.members.find((m) => m.ownerKey === ownerKey) ?? null;
}

/**
 * 台帳の増減を会社へ適用し、対応する取引履歴エントリを返す。
 * 統計（累計収益・支出・納税）もここで一元的に更新する:
 * 入金は totalEarn、出金は totalUse、理由に「税」を含む出金は totalTax。
 */
export function applyLedger(
  company: Company,
  amount: number,
  reason: string,
  userId: string,
  now: number,
): { company: Company; entry: CompanyHistoryEntry } {
  const stats: CompanyStats = { ...company.stats };
  if (amount > 0) stats.totalEarn += amount;
  if (amount < 0) {
    stats.totalUse += -amount;
    if (reason.includes("税")) stats.totalTax += -amount;
  }
  const entry: CompanyHistoryEntry = { at: now, userId, amount, reason };
  return {
    company: { ...company, assets: company.assets + amount, stats },
    entry,
  };
}

/** 履歴へ追記し、保持上限を超えた古い分を落とす（新しい順に保持）。 */
export function appendHistory(
  history: readonly CompanyHistoryEntry[],
  entries: readonly CompanyHistoryEntry[],
): CompanyHistoryEntry[] {
  return [...entries, ...history].slice(0, COMPANY_HISTORY_LIMIT);
}

/**
 * 会社を設立する（台帳側の状態だけを作る。資本金の spend オプ適用は
 * 呼び出し側が先に済ませている前提）。
 * v3 の処理順序どおり「資本金全額を入金 → 設立税を差し引く」ため、
 * 初期資産 = 資本金 × 0.8、履歴は2件残る。
 */
export function foundCompany(
  id: string,
  input: { name: string; description: string; capital: number; salary: number },
  owner: CompanyMember,
  now: number,
): { company: Company; history: CompanyHistoryEntry[] } {
  const base: Company = {
    id,
    name: input.name,
    description: input.description,
    ownerKey: owner.ownerKey,
    assets: 0,
    salary: input.salary,
    createdAt: now,
    members: [owner],
    productIds: [],
    stats: { totalEarn: 0, totalUse: 0, totalTax: 0 },
    lastBonusAt: {},
    lastSalaryKey: "",
    lastTaxKey: "",
  };
  const history: CompanyHistoryEntry[] = [];
  let step = applyLedger(base, input.capital, COMPANY_CAPITAL_REASON, owner.discordId, now);
  history.push(step.entry);
  step = applyLedger(
    step.company,
    -establishmentTax(input.capital),
    "会社設立税の支払い",
    owner.discordId,
    now,
  );
  history.push(step.entry);
  return { company: step.company, history };
}

export type JoinCompanyError = "full" | "already_member";

/** 社員を加える。成功したら新しい Company、失敗したら理由を返す。 */
export function joinCompany(
  company: Company,
  member: CompanyMember,
): { company: Company } | { error: JoinCompanyError } {
  if (isCompanyMember(company, member.ownerKey)) return { error: "already_member" };
  if (company.members.length >= COMPANY_MEMBER_LIMIT) return { error: "full" };
  return { company: { ...company, members: [...company.members, member] } };
}

/** 社員を外す（脱退・解雇共通）。オーナーは外せない。 */
export function removeMember(company: Company, ownerKey: string): Company {
  if (ownerKey === company.ownerKey) return company;
  return {
    ...company,
    members: company.members.filter((m) => m.ownerKey !== ownerKey),
    lastBonusAt: Object.fromEntries(
      Object.entries(company.lastBonusAt).filter(([key]) => key !== ownerKey),
    ),
  };
}

/** 解散できる状態か（オーナーが単独メンバーのときだけ）。 */
export function canDissolve(company: Company, ownerKey: string): boolean {
  return isCompanyOwner(company, ownerKey) && company.members.length === 1;
}

/** 招待コードが失効しているか（発行から1時間）。 */
export function isInviteExpired(invite: CompanyInvite, now: number): boolean {
  return now - invite.createdAt >= COMPANY_INVITE_TTL_MS;
}

/** 商品が寿命切れか（作成から1週間）。 */
export function isProductExpired(product: CompanyProduct, now: number): boolean {
  return now - product.createdAt >= COMPANY_PRODUCT_TTL_MS;
}

/** 給料支給1回分の計画。資産が総額に不足する回は全員スキップ。 */
export function planSalaryRun(
  company: Company,
  now: number,
):
  | { skipped: true }
  | {
      skipped: false;
      company: Company;
      history: CompanyHistoryEntry[];
      payouts: { member: CompanyMember; gross: number; net: number }[];
    } {
  const payouts = company.members.map((member) => {
    const gross = salaryGrossFor(company, member);
    return { member, gross, net: gross - incomeTax(gross) };
  });
  const total = payouts.reduce((sum, p) => sum + p.gross, 0);
  if (company.assets < total) return { skipped: true };
  let current = company;
  const history: CompanyHistoryEntry[] = [];
  for (const p of payouts) {
    const step = applyLedger(current, -p.gross, "給料の支払い", p.member.discordId, now);
    current = step.company;
    history.push(step.entry);
  }
  return { skipped: false, company: current, history, payouts };
}

/** 法人税の課税対象利益: ウィンドウ内の入金合計から資本金の追加を除く。 */
export function taxableProfit(
  history: readonly CompanyHistoryEntry[],
  windowStart: number,
): number {
  let profit = 0;
  for (const entry of history) {
    if (entry.at < windowStart) continue;
    if (entry.amount > 0 && entry.reason !== COMPANY_CAPITAL_REASON) profit += entry.amount;
  }
  return profit;
}

/**
 * 法人税1回分の計画。税額が0、または資産が税額に不足する場合は
 * 徴収しない（v3 の「不足する場合は徴収されない」に従う）。
 */
export function planCorporateTax(
  company: Company,
  profit: number,
  now: number,
): { company: Company; entry: CompanyHistoryEntry; tax: number } | null {
  const tax = corporateTaxFor(profit);
  if (tax <= 0 || company.assets < tax) return null;
  const step = applyLedger(company, -tax, `${profit}コインにかかる法人税の支払い`, "", now);
  return { company: step.company, entry: step.entry, tax };
}

export type BonusError = "invalid_amount" | "cooldown" | "not_member";

/** ボーナス支給の検証と計画。原資は会社資産、受取は所得税控除後の額。 */
export function planBonus(
  company: Company,
  targetKey: string,
  amount: unknown,
  now: number,
):
  | {
      company: Company;
      entry: CompanyHistoryEntry;
      target: CompanyMember;
      gross: number;
      net: number;
    }
  | { error: BonusError } {
  const target = memberOf(company, targetKey);
  if (!target) return { error: "not_member" };
  if (typeof amount !== "number" || !Number.isInteger(amount)) return { error: "invalid_amount" };
  const cap = Math.min(
    COMPANY_BONUS_MAX,
    Math.floor(company.assets / COMPANY_BONUS_ASSETS_DIVISOR),
  );
  if (amount < COMPANY_BONUS_MIN || amount > cap) return { error: "invalid_amount" };
  const last = company.lastBonusAt[targetKey] ?? 0;
  if (now - last < COMPANY_BONUS_COOLDOWN_MS) return { error: "cooldown" };
  const step = applyLedger(
    company,
    -amount,
    `（${target.name}）へのボーナスの支払い`,
    target.discordId,
    now,
  );
  const next: Company = {
    ...step.company,
    lastBonusAt: { ...step.company.lastBonusAt, [targetKey]: now },
  };
  return {
    company: next,
    entry: step.entry,
    target,
    gross: amount,
    net: amount - incomeTax(amount),
  };
}

export type ProductCreateError = "limit" | "tax_unaffordable";

/** 商品作成の計画。作成税は会社資産から（不足したら作れない）。 */
export function planProductCreate(
  company: Company,
  product: CompanyProduct,
  now: number,
): { company: Company; entry: CompanyHistoryEntry } | { error: ProductCreateError } {
  if (company.productIds.length >= COMPANY_PRODUCT_LIMIT) return { error: "limit" };
  const tax = productCreateTax(product.price);
  if (company.assets < tax) return { error: "tax_unaffordable" };
  const creatorId = memberOf(company, product.creatorKey)?.discordId ?? "";
  const step = applyLedger(company, -tax, "商品作成税", creatorId, now);
  const withProduct: Company = {
    ...step.company,
    productIds: [...step.company.productIds, product.id],
  };
  return { company: withProduct, entry: step.entry };
}

/**
 * 商品購入の会社側の付け替え（買い手の spend オプ適用後に呼ぶ）。
 * 価格全額が入金され、売却税50%が差し引かれる（会社の実質取り分50%）。
 * 商品は出品一覧から外れる（売り切り）。
 */
export function planProductSale(
  company: Company,
  product: CompanyProduct,
  buyerDiscordId: string,
  now: number,
): { company: Company; history: CompanyHistoryEntry[] } {
  const history: CompanyHistoryEntry[] = [];
  let step = applyLedger(
    company,
    product.price,
    `商品（${product.name}）の売却`,
    buyerDiscordId,
    now,
  );
  history.push(step.entry);
  step = applyLedger(step.company, -productSaleTax(product.price), "商品売却税", "", now);
  history.push(step.entry);
  const next: Company = {
    ...step.company,
    productIds: step.company.productIds.filter((id) => id !== product.id),
  };
  return { company: next, history };
}

// ---- JST の時間キー（Cron の冪等化と時間帯判定） ----

const JST_OFFSET_MS = 9 * 3_600_000;

function jstParts(now: number): { date: string; hour: number } {
  const jst = new Date(now + JST_OFFSET_MS);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, hour: jst.getUTCHours() };
}

/** 給料支給の対象時間帯（JST 8〜20時）か。 */
export function isSalaryHour(now: number): boolean {
  const { hour } = jstParts(now);
  return hour >= COMPANY_SALARY_HOUR_START && hour <= COMPANY_SALARY_HOUR_END;
}

/** 給料支給の冪等キー（JST の日付+時）。 */
export function salaryRunKey(now: number): string {
  const { date, hour } = jstParts(now);
  return `${date}T${String(hour).padStart(2, "0")}`;
}

/** 法人税の対象時間か（JST で3時間ごと: 0,3,6,...,21時台）。 */
export function isTaxHour(now: number): boolean {
  return jstParts(now).hour % 3 === 0;
}

/** 法人税の冪等キー（JST の日付+3時間ウィンドウ開始時）。 */
export function taxRunKey(now: number): string {
  const { date, hour } = jstParts(now);
  const start = hour - (hour % 3);
  return `${date}T${String(start).padStart(2, "0")}`;
}

// ---- 保存値のパース（壊れていたら null） ----

function asRecord(value: unknown): Record<string, unknown> | null {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function parseCompany(raw: unknown): Company | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (!isCompanyId(data.id)) return null;
  if (typeof data.name !== "string" || typeof data.ownerKey !== "string") return null;
  if (!Array.isArray(data.members) || data.members.length === 0) return null;
  const members: CompanyMember[] = [];
  for (const m of data.members) {
    const mm = asRecord(m);
    if (!mm || typeof mm.ownerKey !== "string" || typeof mm.discordId !== "string") return null;
    members.push({
      ownerKey: mm.ownerKey,
      discordId: mm.discordId,
      name: typeof mm.name === "string" ? mm.name.slice(0, 40) : "",
      joinedAt: asInt(mm.joinedAt),
    });
  }
  if (!members.some((m) => m.ownerKey === data.ownerKey)) return null;
  const statsRaw = asRecord(data.stats);
  const lastBonusAt: Record<string, number> = {};
  const bonusRaw = asRecord(data.lastBonusAt);
  if (bonusRaw) {
    for (const [key, value] of Object.entries(bonusRaw)) {
      if (typeof value === "number" && Number.isFinite(value)) lastBonusAt[key] = Math.trunc(value);
    }
  }
  return {
    id: data.id,
    name: data.name.slice(0, COMPANY_NAME_MAX),
    description:
      typeof data.description === "string"
        ? data.description.slice(0, COMPANY_DESCRIPTION_MAX)
        : "",
    ownerKey: data.ownerKey,
    assets: Math.max(0, asInt(data.assets)),
    salary: asInt(data.salary, COMPANY_SALARY_MIN),
    createdAt: asInt(data.createdAt),
    members: members.slice(0, COMPANY_MEMBER_LIMIT),
    productIds: Array.isArray(data.productIds)
      ? data.productIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, COMPANY_PRODUCT_LIMIT)
      : [],
    stats: {
      totalEarn: asInt(statsRaw?.totalEarn),
      totalUse: asInt(statsRaw?.totalUse),
      totalTax: asInt(statsRaw?.totalTax),
    },
    lastBonusAt,
    lastSalaryKey: typeof data.lastSalaryKey === "string" ? data.lastSalaryKey : "",
    lastTaxKey: typeof data.lastTaxKey === "string" ? data.lastTaxKey : "",
  };
}

export function parseCompanyProduct(raw: unknown): CompanyProduct | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (typeof data.id !== "string" || !isCompanyId(data.companyId)) return null;
  if (typeof data.creatorKey !== "string" || typeof data.name !== "string") return null;
  const price = asInt(data.price);
  if (price < COMPANY_PRODUCT_PRICE_MIN) return null;
  return {
    id: data.id,
    companyId: data.companyId,
    creatorKey: data.creatorKey,
    creatorName: typeof data.creatorName === "string" ? data.creatorName.slice(0, 40) : "",
    name: data.name.slice(0, COMPANY_PRODUCT_NAME_MAX),
    description:
      typeof data.description === "string"
        ? data.description.slice(0, COMPANY_PRODUCT_DESCRIPTION_MAX)
        : "",
    content:
      typeof data.content === "string" ? data.content.slice(0, COMPANY_PRODUCT_CONTENT_MAX) : "",
    price,
    createdAt: asInt(data.createdAt),
  };
}

export function parseCompanyInvite(raw: unknown): CompanyInvite | null {
  const data = asRecord(raw);
  if (!data) return null;
  if (typeof data.code !== "string" || !isCompanyId(data.companyId)) return null;
  return { code: data.code, companyId: data.companyId, createdAt: asInt(data.createdAt) };
}

export function parseCompanyHistory(raw: unknown): CompanyHistoryEntry[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: CompanyHistoryEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.reason !== "string") continue;
    out.push({
      at: asInt(record.at),
      userId: typeof record.userId === "string" ? record.userId : "",
      amount: asInt(record.amount),
      reason: record.reason.slice(0, 80),
    });
  }
  return out.slice(0, COMPANY_HISTORY_LIMIT);
}
