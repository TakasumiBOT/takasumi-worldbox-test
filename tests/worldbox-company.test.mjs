// WORLD BOX（Takasumi 版）会社システムの検証:
// - 入力検証（会社名・説明・資本金・時給・商品）
// - 会社の一生: 設立（税20%）→ 招待入社（上限15人・コード失効）→
//   給料（社長 ×1.15・所得税15%・資産不足は全員スキップ）→
//   商品（作成税15%・売却税50%・出品上限15・寿命1週間）→
//   ボーナス（資産の1/10まで・23時間クールダウン）→
//   法人税（累進 0〜70%・資本金は利益に数えない）→ 脱退・解散条件
// - 保存値のパース、JST の時間キー（Cron 冪等化）
// - 配線: ルート / Cron / vercel.json / クライアント / earn 理由
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const C = await import(dataUrl(transpile("worldbox/social/company.ts")));
const eco = await import(dataUrl(transpile("worldbox/economy/economy-bridge.ts")));

const OWNER = { ownerKey: "discord:1001", discordId: "1001", name: "社長", joinedAt: 0 };
const EMP = (n) => ({
  ownerKey: `discord:${2000 + n}`,
  discordId: `${2000 + n}`,
  name: `社員${n}`,
  joinedAt: 0,
});
const T0 = Date.UTC(2026, 10, 18, 0, 0, 0); // JST 2026-11-18 09:00

function foundCompany(capital = 100_000, salary = 10_000) {
  return C.foundCompany(
    "ABCDEFGHIJ",
    { name: "テスト株式会社", description: "テスト用の会社です", capital, salary },
    { ...OWNER, joinedAt: T0 },
    T0,
  );
}

// ---------- 検証 ----------

test("company: 会社名は4〜20文字、説明は5〜100文字だけ通る", () => {
  assert.equal(C.validateCompanyName("あいうえ"), "あいうえ");
  assert.equal(C.validateCompanyName(" あいうえ "), "あいうえ");
  assert.equal(C.validateCompanyName("あいう"), null);
  assert.equal(C.validateCompanyName("あ".repeat(21)), null);
  assert.equal(C.validateCompanyName(42), null);
  assert.equal(C.validateCompanyDescription("あいうえお"), "あいうえお");
  assert.equal(C.validateCompanyDescription("あいうえ"), null);
  assert.equal(C.validateCompanyDescription("あ".repeat(101)), null);
});

test("company: 資本金は100,000〜1,000,000、時給は1,000〜100,000だけ通る", () => {
  assert.equal(C.validateCompanyCapital(100_000), 100_000);
  assert.equal(C.validateCompanyCapital(1_000_000), 1_000_000);
  assert.equal(C.validateCompanyCapital(99_999), null);
  assert.equal(C.validateCompanyCapital(1_000_001), null);
  assert.equal(C.validateCompanyCapital(100_000.5), null);
  assert.equal(C.validateCompanySalary(1_000), 1_000);
  assert.equal(C.validateCompanySalary(100_000), 100_000);
  assert.equal(C.validateCompanySalary(999), null);
  assert.equal(C.validateCompanySalary(100_001), null);
});

test("company: 商品入力は長さと価格（100〜999,999）を検証する", () => {
  const ok = C.validateProductInput({
    name: "資料",
    description: "説明文",
    content: "中身",
    price: 100,
  });
  assert.deepEqual(ok, { name: "資料", description: "説明文", content: "中身", price: 100 });
  assert.equal(
    C.validateProductInput({ name: "", description: "x", content: "y", price: 100 }),
    null,
  );
  assert.equal(
    C.validateProductInput({ name: "x".repeat(21), description: "x", content: "y", price: 100 }),
    null,
  );
  assert.equal(
    C.validateProductInput({ name: "x", description: "x", content: "y", price: 99 }),
    null,
  );
  assert.equal(
    C.validateProductInput({ name: "x", description: "x", content: "y", price: 1_000_000 }),
    null,
  );
  assert.equal(
    C.validateProductInput({ name: "x", description: "x", content: "y", price: 100.5 }),
    null,
  );
});

test("company: ID と招待コードは仕様の文字数で、会社 ID の形が判定できる", () => {
  const rand = () => 0; // 常に先頭文字
  assert.equal(C.makeCompanyId(rand), "AAAAAAAAAA");
  assert.equal(C.makeInviteCode(rand), "AAAAAAAAAA");
  assert.equal(C.makeProductId(rand), "AAAAAAAA");
  assert.equal(C.isCompanyId("ABCDEFGHIJ"), true);
  assert.equal(C.isCompanyId("member:discord:1"), false);
  assert.equal(C.isCompanyId("short"), false);
});

// ---------- 設立 ----------

test("company: 設立は資本金を入金してから設立税20%を引き、初期資産は80%", () => {
  const { company, history } = foundCompany(100_000);
  assert.equal(company.assets, 80_000);
  assert.equal(company.members.length, 1);
  assert.equal(company.ownerKey, OWNER.ownerKey);
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((h) => [h.amount, h.reason]),
    [
      [100_000, "会社の資本金の追加"],
      [-20_000, "会社設立税の支払い"],
    ],
  );
  assert.equal(company.stats.totalEarn, 100_000);
  assert.equal(company.stats.totalUse, 20_000);
  assert.equal(company.stats.totalTax, 20_000);
  // 端数の切り捨て: 資本金 100,001 → 税 20,000（floor）
  const odd = foundCompany(100_001);
  assert.equal(odd.company.assets, 100_001 - 20_000);
});

// ---------- 所属 ----------

test("company: 入社は上限15人（オーナー含む）までで、重複は弾く", () => {
  let { company } = foundCompany();
  for (let n = 1; n <= 14; n++) {
    const joined = C.joinCompany(company, EMP(n));
    assert.ok("company" in joined, `join ${n}`);
    company = joined.company;
  }
  assert.equal(company.members.length, 15);
  const full = C.joinCompany(company, EMP(99));
  assert.deepEqual(full, { error: "full" });
  const dup = C.joinCompany(company, EMP(1));
  assert.deepEqual(dup, { error: "already_member" });
});

test("company: 招待コードは発行から1時間で失効する", () => {
  const invite = { code: "ABCDEFGHIJ", companyId: "ABCDEFGHIJ", createdAt: T0 };
  assert.equal(C.isInviteExpired(invite, T0 + 3_599_999), false);
  assert.equal(C.isInviteExpired(invite, T0 + 3_600_000), true);
});

test("company: 脱退と解雇はメンバーを外し、オーナーは外せない。解散は単独時のみ", () => {
  let { company } = foundCompany();
  company = C.joinCompany(company, EMP(1)).company;
  assert.equal(C.canDissolve(company, OWNER.ownerKey), false);
  const after = C.removeMember(company, EMP(1).ownerKey);
  assert.equal(after.members.length, 1);
  assert.equal(C.canDissolve(after, OWNER.ownerKey), true);
  assert.equal(C.canDissolve(after, EMP(1).ownerKey), false);
  const ownerRemoved = C.removeMember(after, OWNER.ownerKey);
  assert.equal(ownerRemoved.members.length, 1);
});

// ---------- 給料 ----------

test("company: 給料は社長 ×1.15、所得税15%控除、台帳からは総額を引く", () => {
  let { company } = foundCompany(100_000, 10_000);
  company = C.joinCompany(company, EMP(1)).company;
  const plan = C.planSalaryRun(company, T0);
  assert.equal(plan.skipped, false);
  const byKey = new Map(plan.payouts.map((p) => [p.member.ownerKey, p]));
  assert.equal(byKey.get(OWNER.ownerKey).gross, 11_500);
  assert.equal(byKey.get(OWNER.ownerKey).net, 11_500 - 1_725);
  assert.equal(byKey.get(EMP(1).ownerKey).gross, 10_000);
  assert.equal(byKey.get(EMP(1).ownerKey).net, 8_500);
  assert.equal(plan.company.assets, 80_000 - 21_500);
  assert.equal(plan.history.length, 2);
  assert.ok(plan.history.every((h) => h.reason === "給料の支払い"));
});

test("company: 給料は会社資産が総額に不足する回は全員スキップ（部分支給なし）", () => {
  // 資本金 100,000 → 資産 80,000。時給 100,000 では社長分 115,000 だけで不足。
  const { company } = foundCompany(100_000, 100_000);
  const plan = C.planSalaryRun(company, T0);
  assert.deepEqual(plan, { skipped: true });
});

// ---------- 商品 ----------

function makeProduct(price = 10_000, id = "PROD0001") {
  return {
    id,
    companyId: "ABCDEFGHIJ",
    creatorKey: EMP(1).ownerKey,
    creatorName: "社員1",
    name: "市場レポート",
    description: "説明",
    content: "秘密の内容",
    price,
    createdAt: T0,
  };
}

test("company: 商品作成税は価格の15%を会社資産から払い、出品上限は15件", () => {
  let { company } = foundCompany();
  company = C.joinCompany(company, EMP(1)).company;
  const plan = C.planProductCreate(company, makeProduct(10_000), T0);
  assert.ok("company" in plan);
  assert.equal(plan.company.assets, 80_000 - 1_500);
  assert.equal(plan.entry.amount, -1_500);
  assert.equal(plan.entry.reason, "商品作成税");
  assert.deepEqual(plan.company.productIds, ["PROD0001"]);
  // 資産不足: 資産 80,000 で価格 999,999（税 149,999）は作れない
  const poor = C.planProductCreate(company, makeProduct(999_999, "PROD0002"), T0);
  assert.deepEqual(poor, { error: "tax_unaffordable" });
  // 上限: 15件出品済みの会社には16件目を作れない
  const filled = { ...company, productIds: Array.from({ length: 15 }, (_, i) => `P${i}`) };
  const over = C.planProductCreate(filled, makeProduct(100, "PROD0016"), T0);
  assert.deepEqual(over, { error: "limit" });
});

test("company: 商品が売れると全額入金から売却税50%を引き、出品から消える", () => {
  let { company } = foundCompany();
  company = C.joinCompany(company, EMP(1)).company;
  company = C.planProductCreate(company, makeProduct(10_000), T0).company;
  const before = company.assets;
  const sale = C.planProductSale(company, makeProduct(10_000), "9001", T0);
  assert.equal(sale.company.assets, before + 10_000 - 5_000);
  assert.deepEqual(sale.company.productIds, []);
  assert.deepEqual(
    sale.history.map((h) => [h.amount, h.reason]),
    [
      [10_000, "商品（市場レポート）の売却"],
      [-5_000, "商品売却税"],
    ],
  );
  assert.equal(sale.company.stats.totalTax, 20_000 + 1_500 + 5_000);
});

test("company: 商品は作成から1週間で寿命切れになる", () => {
  const product = makeProduct();
  assert.equal(C.isProductExpired(product, T0 + 7 * 24 * 3_600_000 - 1), false);
  assert.equal(C.isProductExpired(product, T0 + 7 * 24 * 3_600_000), true);
});

// ---------- ボーナス ----------

test("company: ボーナスは資産の1/10（上限150,000）まで、23時間クールダウン、所得税控除", () => {
  let { company } = foundCompany(1_000_000, 10_000); // 資産 800,000 → 上限 80,000
  company = C.joinCompany(company, EMP(1)).company;
  const plan = C.planBonus(company, EMP(1).ownerKey, 80_000, T0);
  assert.ok("company" in plan);
  assert.equal(plan.gross, 80_000);
  assert.equal(plan.net, 80_000 - 12_000);
  assert.equal(plan.company.assets, 800_000 - 80_000);
  // 上限超え（80,001）と下限未満（99）
  assert.deepEqual(C.planBonus(company, EMP(1).ownerKey, 80_001, T0), { error: "invalid_amount" });
  assert.deepEqual(C.planBonus(company, EMP(1).ownerKey, 99, T0), { error: "invalid_amount" });
  // クールダウン: 支給直後は同じ相手へ出せない。23時間後は出せる
  assert.deepEqual(C.planBonus(plan.company, EMP(1).ownerKey, 100, T0 + 1), { error: "cooldown" });
  const afterDay = C.planBonus(plan.company, EMP(1).ownerKey, 100, T0 + 82_800_000);
  assert.ok("company" in afterDay);
  // 非メンバーには出せない
  assert.deepEqual(C.planBonus(company, "discord:9999", 100, T0), { error: "not_member" });
});

// ---------- 法人税 ----------

test("company: 法人税は累進ブラケット（0〜70%）で計算する", () => {
  assert.equal(C.corporateTaxFor(0), 0);
  assert.equal(C.corporateTaxFor(5_000), 0);
  assert.equal(C.corporateTaxFor(10_000), 600);
  assert.equal(C.corporateTaxFor(30_000), 3_600);
  assert.equal(C.corporateTaxFor(500_000), 198_800);
  assert.equal(C.corporateTaxFor(600_000), 268_800);
});

test("company: 課税利益はウィンドウ内の入金から資本金の追加を除いた額", () => {
  const history = [
    { at: T0, userId: "1", amount: 100_000, reason: "会社の資本金の追加" },
    { at: T0, userId: "2", amount: 10_000, reason: "商品（x）の売却" },
    { at: T0 - 1, userId: "2", amount: 50_000, reason: "商品（y）の売却" },
    { at: T0, userId: "", amount: -5_000, reason: "商品売却税" },
  ];
  assert.equal(C.taxableProfit(history, T0), 10_000);
});

test("company: 法人税は資産が税額に不足する場合は徴収されない", () => {
  const { company } = foundCompany(); // 資産 80,000
  const plan = C.planCorporateTax(company, 30_000, T0); // 税 3,600
  assert.ok(plan);
  assert.equal(plan.tax, 3_600);
  assert.equal(plan.company.assets, 80_000 - 3_600);
  assert.ok(plan.entry.reason.includes("法人税"));
  const poor = { ...company, assets: 100 };
  assert.equal(C.planCorporateTax(poor, 30_000, T0), null);
  assert.equal(C.planCorporateTax(company, 5_000, T0), null); // 税 0
});

// ---------- JST 時間キー ----------

test("company: 給料時間帯と冪等キーは JST 基準（8〜20時・3時間税）", () => {
  assert.equal(C.isSalaryHour(T0), true); // JST 09:00
  assert.equal(C.salaryRunKey(T0), "2026-11-18T09");
  assert.equal(C.isSalaryHour(Date.UTC(2026, 10, 17, 23, 0)), true); // JST 08:00
  assert.equal(C.isSalaryHour(Date.UTC(2026, 10, 18, 12, 0)), false); // JST 21:00
  assert.equal(C.isTaxHour(T0), true); // 9 % 3 == 0
  assert.equal(C.taxRunKey(T0), "2026-11-18T09");
  assert.equal(C.isTaxHour(Date.UTC(2026, 10, 18, 1, 0)), false); // JST 10:00
  assert.equal(C.taxRunKey(Date.UTC(2026, 10, 18, 2, 0)), "2026-11-18T09"); // JST 11:00 → 窓は 09
});

// ---------- パース ----------

test("company: 保存値のパースは往復で一致し、壊れた値を弾く", () => {
  const { company, history } = foundCompany();
  const parsed = C.parseCompany(JSON.stringify(company));
  assert.equal(parsed.id, company.id);
  assert.equal(parsed.assets, 80_000);
  assert.equal(parsed.members[0].ownerKey, OWNER.ownerKey);
  assert.equal(C.parseCompany("not json"), null);
  assert.equal(C.parseCompany(JSON.stringify({ id: "short" })), null);
  assert.equal(C.parseCompany(null), null);
  const parsedHistory = C.parseCompanyHistory(JSON.stringify(history));
  assert.equal(parsedHistory.length, 2);
  assert.deepEqual(C.parseCompanyHistory("junk"), []);
  const product = C.parseCompanyProduct(JSON.stringify(makeProduct()));
  assert.equal(product.content, "秘密の内容");
  assert.equal(C.parseCompanyProduct(JSON.stringify({ id: "x" })), null);
});

// ---------- 一生（純粋ロジックの連結） ----------

test("company: 一生 — 設立→入社→給料→商品→販売→ボーナス→税→解散条件", () => {
  const balances = new Map([[OWNER.discordId, 1_000_000]]);
  let { company, history } = foundCompany(200_000, 10_000);
  let hist = [...history].reverse(); // 保存は新しい順
  balances.set(OWNER.discordId, balances.get(OWNER.discordId) - 200_000); // 資本金 spend
  assert.equal(company.assets, 160_000);

  company = C.joinCompany(company, EMP(1)).company;

  const salary = C.planSalaryRun(company, T0);
  assert.equal(salary.skipped, false);
  company = salary.company;
  hist = C.appendHistory(hist, salary.history);
  for (const p of salary.payouts) {
    balances.set(p.member.discordId, (balances.get(p.member.discordId) ?? 0) + p.net);
  }
  assert.equal(balances.get(OWNER.discordId), 800_000 + 9_775);
  assert.equal(balances.get(EMP(1).discordId), 8_500);

  const created = C.planProductCreate(company, makeProduct(20_000), T0);
  company = created.company;
  hist = C.appendHistory(hist, [created.entry]);
  const sale = C.planProductSale(company, makeProduct(20_000), "9001", T0);
  company = sale.company;
  hist = C.appendHistory(hist, sale.history);
  // 資産: 160,000 - 21,500（給料） - 3,000（作成税） + 20,000 - 10,000（売却税）
  assert.equal(company.assets, 145_500);

  const bonus = C.planBonus(company, EMP(1).ownerKey, 10_000, T0);
  company = bonus.company;
  hist = C.appendHistory(hist, [bonus.entry]);
  balances.set(EMP(1).discordId, balances.get(EMP(1).discordId) + bonus.net);
  assert.equal(balances.get(EMP(1).discordId), 8_500 + 8_500);

  // 直近ウィンドウの利益 = 商品売却 20,000 のみ（資本金は除外）→ 税 600+1,500=2,100
  const profit = C.taxableProfit(hist, T0 - C.COMPANY_TAX_WINDOW_MS);
  assert.equal(profit, 20_000);
  const tax = C.planCorporateTax(company, profit, T0);
  assert.equal(tax.tax, 2_100);
  company = tax.company;

  // 解散は社員がいる間は不可。全員抜ければ可。
  assert.equal(C.canDissolve(company, OWNER.ownerKey), false);
  company = C.removeMember(company, EMP(1).ownerKey);
  assert.equal(C.canDissolve(company, OWNER.ownerKey), true);
});

// ---------- 配線 ----------

test("company: earn 理由に会社系（給料・ボーナス・解散返還）が許可されている", () => {
  for (const reason of ["company_salary", "company_bonus", "company_dissolve"]) {
    assert.ok(eco.EARN_REASONS.has(reason), reason);
    const op = eco.buildEconomyOp(
      { kind: "earn", userKey: "discord:10001", discordId: "10001", amount: 100, reason },
      "12345678-abcd-4abc-8abc-0123456789ab",
      T0,
    );
    assert.ok(op, reason);
  }
});

test("company: ルート・Cron・クライアント・vercel.json に配線されている", () => {
  const route = fs.readFileSync(path.join(rootDir, "app/api/worldbox/company/route.ts"), "utf8");
  for (const action of [
    '"create"',
    '"join"',
    '"leave"',
    '"fire"',
    '"invite"',
    '"setting"',
    '"bonus"',
    '"product_create"',
    '"product_buy"',
    '"dissolve"',
  ]) {
    assert.ok(route.includes(`action === ${action}`), action);
  }
  const cron = fs.readFileSync(
    path.join(rootDir, "app/api/worldbox/internal/company-cron/route.ts"),
    "utf8",
  );
  assert.ok(cron.includes("runCompanyCron"));
  assert.ok(cron.includes("CRON_SECRET"));
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/worldbox/internal/company-cron"));
  const client = fs.readFileSync(
    path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(client.includes("WorldBoxCompanyPanel"));
  assert.ok(client.includes('id: "company"'));
  const panel = fs.readFileSync(
    path.join(rootDir, "app/games/worldbox/WorldBoxCompanyPanel.tsx"),
    "utf8",
  );
  assert.ok(panel.includes("/api/worldbox/company"));
});
