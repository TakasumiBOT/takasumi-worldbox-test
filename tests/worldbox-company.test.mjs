import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src/lib");

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
const T0 = Date.UTC(2026, 10, 18, 0, 0, 0);

function foundCompany(capital = 100_000, salary = 10_000) {
  return C.foundCompany(
    "ABCDEFGHIJ",
    { name: "テスト株式会社", description: "テスト用の会社です", capital, salary },
    { ...OWNER, joinedAt: T0 },
    T0,
  );
}

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
  const rand = () => 0;
  assert.equal(C.makeCompanyId(rand), "AAAAAAAAAA");
  assert.equal(C.makeInviteCode(rand), "AAAAAAAAAA");
  assert.equal(C.makeProductId(rand), "AAAAAAAA");
  assert.equal(C.isCompanyId("ABCDEFGHIJ"), true);
  assert.equal(C.isCompanyId("member:discord:1"), false);
  assert.equal(C.isCompanyId("short"), false);
});

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
  const odd = foundCompany(100_001);
  assert.equal(odd.company.assets, 100_001 - 20_000);
});

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
  const { company } = foundCompany(100_000, 100_000);
  const plan = C.planSalaryRun(company, T0);
  assert.deepEqual(plan, { skipped: true });
});

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

test("company: 商品作成税は価格の5%を会社資産から払い、出品上限は15件", () => {
  let { company } = foundCompany();
  company = C.joinCompany(company, EMP(1)).company;
  const plan = C.planProductCreate(company, makeProduct(10_000), T0);
  assert.ok("company" in plan);
  assert.equal(plan.company.assets, 80_000 - 500);
  assert.equal(plan.entry.amount, -500);
  assert.equal(plan.entry.reason, "商品作成税");
  assert.deepEqual(plan.company.productIds, ["PROD0001"]);
  const poor = C.planProductCreate(
    { ...company, assets: 40_000 },
    makeProduct(999_999, "PROD0002"),
    T0,
  );
  assert.deepEqual(poor, { error: "tax_unaffordable" });
  const filled = { ...company, productIds: Array.from({ length: 15 }, (_, i) => `P${i}`) };
  const over = C.planProductCreate(filled, makeProduct(100, "PROD0016"), T0);
  assert.deepEqual(over, { error: "limit" });
});

test("company: 商品が売れると全額入金から売却税10%を引き、出品から消える", () => {
  let { company } = foundCompany();
  company = C.joinCompany(company, EMP(1)).company;
  company = C.planProductCreate(company, makeProduct(10_000), T0).company;
  const before = company.assets;
  const sale = C.planProductSale(company, makeProduct(10_000), "9001", T0);
  assert.equal(sale.company.assets, before + 10_000 - 1_000);
  assert.deepEqual(sale.company.productIds, []);
  assert.deepEqual(
    sale.history.map((h) => [h.amount, h.reason]),
    [
      [10_000, "商品（市場レポート）の売却"],
      [-1_000, "商品売却税"],
    ],
  );
  assert.equal(sale.company.stats.totalTax, 20_000 + 500 + 1_000);
});

test("company: 高額商品の販売後も全税引き後で黒字になる", () => {
  let { company } = foundCompany(1_000_000, 10_000);
  const startAssets = company.assets;
  const created = C.planProductCreate(company, makeProduct(500_000), T0);
  assert.ok("company" in created);
  const sale = C.planProductSale(created.company, makeProduct(500_000), "9001", T0);
  const hist = [created.entry, ...sale.history];
  const profit = C.taxableProfit(hist, T0);
  assert.equal(profit, 425_000);
  const tax = C.planCorporateTax(sale.company, profit, T0);
  assert.ok(tax);
  assert.ok(tax.company.assets > startAssets, "販売・納税後に黒字になること");
});

test("company: 商品は作成から1週間で寿命切れになる", () => {
  const product = makeProduct();
  assert.equal(C.isProductExpired(product, T0 + 7 * 24 * 3_600_000 - 1), false);
  assert.equal(C.isProductExpired(product, T0 + 7 * 24 * 3_600_000), true);
});

test("company: ボーナスは資産の1/10（上限150,000）まで、23時間クールダウン、所得税控除", () => {
  let { company } = foundCompany(1_000_000, 10_000);
  company = C.joinCompany(company, EMP(1)).company;
  const plan = C.planBonus(company, EMP(1).ownerKey, 80_000, T0);
  assert.ok("company" in plan);
  assert.equal(plan.gross, 80_000);
  assert.equal(plan.net, 80_000 - 12_000);
  assert.equal(plan.company.assets, 800_000 - 80_000);
  assert.deepEqual(C.planBonus(company, EMP(1).ownerKey, 80_001, T0), { error: "invalid_amount" });
  assert.deepEqual(C.planBonus(company, EMP(1).ownerKey, 99, T0), { error: "invalid_amount" });
  assert.deepEqual(C.planBonus(plan.company, EMP(1).ownerKey, 100, T0 + 1), { error: "cooldown" });
  const afterDay = C.planBonus(plan.company, EMP(1).ownerKey, 100, T0 + 82_800_000);
  assert.ok("company" in afterDay);
  assert.deepEqual(C.planBonus(company, "discord:9999", 100, T0), { error: "not_member" });
});

test("company: 法人税は累進ブラケット（0〜70%）で計算する", () => {
  assert.equal(C.corporateTaxFor(0), 0);
  assert.equal(C.corporateTaxFor(5_000), 0);
  assert.equal(C.corporateTaxFor(10_000), 600);
  assert.equal(C.corporateTaxFor(30_000), 3_600);
  assert.equal(C.corporateTaxFor(500_000), 198_800);
  assert.equal(C.corporateTaxFor(600_000), 268_800);
});

test("company: 課税利益はウィンドウ内の純営業利益（資本金・設立税・法人税を除外、下限0）", () => {
  const history = [
    { at: T0, userId: "1", amount: 100_000, reason: "会社の資本金の追加" },
    { at: T0, userId: "1", amount: -20_000, reason: "会社設立税の支払い" },
    { at: T0, userId: "", amount: -1_000, reason: "10000コインにかかる法人税の支払い" },
    { at: T0, userId: "2", amount: 10_000, reason: "商品（x）の売却" },
    { at: T0 - 1, userId: "2", amount: 50_000, reason: "商品（y）の売却" },
    { at: T0, userId: "", amount: -1_000, reason: "商品売却税" },
    { at: T0, userId: "2", amount: -3_000, reason: "給料の支払い" },
  ];
  assert.equal(C.taxableProfit(history, T0), 6_000);
  assert.equal(
    C.taxableProfit([{ at: T0, userId: "2", amount: -10_000, reason: "給料の支払い" }], T0),
    0,
  );
});

test("company: 法人税は資産が税額に不足する場合は徴収されない", () => {
  const { company } = foundCompany();
  const plan = C.planCorporateTax(company, 30_000, T0);
  assert.ok(plan);
  assert.equal(plan.tax, 3_600);
  assert.equal(plan.company.assets, 80_000 - 3_600);
  assert.ok(plan.entry.reason.includes("法人税"));
  const poor = { ...company, assets: 100 };
  assert.equal(C.planCorporateTax(poor, 30_000, T0), null);
  assert.equal(C.planCorporateTax(company, 5_000, T0), null);
});

test("company: 給料時間帯と冪等キーは JST 基準（8〜20時・3時間税）", () => {
  assert.equal(C.isSalaryHour(T0), true);
  assert.equal(C.salaryRunKey(T0), "2026-11-18T09");
  assert.equal(C.isSalaryHour(Date.UTC(2026, 10, 17, 23, 0)), true);
  assert.equal(C.isSalaryHour(Date.UTC(2026, 10, 18, 12, 0)), false);
  assert.equal(C.isTaxHour(T0), true);
  assert.equal(C.taxRunKey(T0), "2026-11-18T09");
  assert.equal(C.isTaxHour(Date.UTC(2026, 10, 18, 1, 0)), false);
  assert.equal(C.taxRunKey(Date.UTC(2026, 10, 18, 2, 0)), "2026-11-18T09");
});

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

test("company: 一生 — 設立→入社→給料→商品→販売→ボーナス→税→解散条件", () => {
  const balances = new Map([[OWNER.discordId, 1_000_000]]);
  let { company, history } = foundCompany(200_000, 10_000);
  let hist = [...history].reverse();
  balances.set(OWNER.discordId, balances.get(OWNER.discordId) - 200_000);
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

  const created = C.planProductCreate(company, makeProduct(60_000), T0);
  company = created.company;
  hist = C.appendHistory(hist, [created.entry]);
  const sale = C.planProductSale(company, makeProduct(60_000), "9001", T0);
  company = sale.company;
  hist = C.appendHistory(hist, sale.history);
  assert.equal(company.assets, 189_500);

  const bonus = C.planBonus(company, EMP(1).ownerKey, 10_000, T0);
  company = bonus.company;
  hist = C.appendHistory(hist, [bonus.entry]);
  balances.set(EMP(1).discordId, balances.get(EMP(1).discordId) + bonus.net);
  assert.equal(balances.get(EMP(1).discordId), 8_500 + 8_500);

  const profit = C.taxableProfit(hist, T0 - C.COMPANY_TAX_WINDOW_MS);
  assert.equal(profit, 19_500);
  const tax = C.planCorporateTax(company, profit, T0);
  assert.equal(tax.tax, 2_025);
  company = tax.company;

  assert.equal(C.canDissolve(company, OWNER.ownerKey), false);
  company = C.removeMember(company, EMP(1).ownerKey);
  assert.equal(C.canDissolve(company, OWNER.ownerKey), true);
  assert.deepEqual(C.dissolutionPayout(100_000), { payout: 80_000, tax: 20_000 });
});

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
  const route = fs.readFileSync(
    path.join(rootDir, "src/app/api/worldbox/company/route.ts"),
    "utf8",
  );
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
    path.join(rootDir, "src/app/api/worldbox/internal/company-cron/route.ts"),
    "utf8",
  );
  assert.ok(cron.includes("runCompanyCron"));
  assert.ok(cron.includes("CRON_SECRET"));
  const vercel = JSON.parse(fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"));
  assert.ok(vercel.crons.some((c) => c.path === "/api/worldbox/internal/company-cron"));
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(client.includes("WorldBoxCompanyPanel"));
  assert.ok(client.includes('id: "company"'));
  const panel = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxCompanyPanel.tsx"),
    "utf8",
  );
  assert.ok(panel.includes("/api/worldbox/company"));
});

test("company-p4: 本社は設立直後は未登録で、保存値の往復で位置が一致する", () => {
  const { company } = foundCompany();
  assert.equal(company.hq, null);
  const withHq = { ...company, hq: { space: "world", x: 123, y: -45 } };
  const parsed = C.parseCompany(JSON.stringify(withHq));
  assert.deepEqual(parsed.hq, { space: "world", x: 123, y: -45 });
  assert.equal(C.parseCompanyHq(null), null);
  assert.equal(C.parseCompanyHq({ space: "", x: 1, y: 2 }), null);
  assert.equal(C.parseCompanyHq({ space: "world", x: 1.5, y: 2 })?.x, 1);
  assert.equal(C.parseCompanyHq({ space: "world", x: 2_000_000, y: 0 }), null);
  assert.equal(C.parseCompanyHq({ space: "x".repeat(33), x: 0, y: 0 }), null);
});

test("company-p4: 本社エリア判定は同空間・半径3（チェビシェフ、端含む）だけ", () => {
  const hq = { space: "lobby", x: 10, y: 10 };
  assert.equal(C.isNearHq(hq, "lobby", 10, 10), true);
  assert.equal(C.isNearHq(hq, "lobby", 13, 7), true);
  assert.equal(C.isNearHq(hq, "lobby", 14, 10), false);
  assert.equal(C.isNearHq(hq, "world", 10, 10), false);
  assert.equal(C.isNearHq(null, "lobby", 10, 10), false);
  assert.equal(C.COMPANY_HQ_RADIUS, 3);
});

test("company-p4: 勤務報酬は固定額で時給操作の影響を受けず、時給変更は24時間クールダウンがある", () => {
  const { company } = foundCompany(100_000, 10_000);
  assert.equal(C.workRewardFor(company), C.COMPANY_WORK_REWARD);
  assert.equal(C.workRewardFor({ ...company, salary: 1_000 }), C.COMPANY_WORK_REWARD);
  assert.equal(C.workRewardFor({ ...company, salary: 100_000 }), C.COMPANY_WORK_REWARD);
  assert.equal(C.COMPANY_WORK_COOLDOWN_MS, 5 * 60_000);
  assert.equal(C.canChangeSalary(company, T0), true);
  const changed = { ...company, lastSalaryChangedAt: T0 };
  assert.equal(C.canChangeSalary(changed, T0 + C.COMPANY_SALARY_CHANGE_COOLDOWN_MS - 1), false);
  assert.equal(C.canChangeSalary(changed, T0 + C.COMPANY_SALARY_CHANGE_COOLDOWN_MS), true);
});

test("company-p4: 勤務状態のパースと活性判定（会社一致・24時間の寿命）", () => {
  const duty = { companyId: "ABCDEFGHIJ", since: T0, lastWorkAt: 0 };
  assert.deepEqual(C.parseCompanyDuty(JSON.stringify(duty)), duty);
  assert.equal(C.parseCompanyDuty("junk"), null);
  assert.equal(C.parseCompanyDuty(JSON.stringify({ companyId: "short" })), null);
  assert.equal(C.isDutyActive(duty, "ABCDEFGHIJ", T0 + 60_000), true);
  assert.equal(C.isDutyActive(duty, "ZZZZZZZZZZ", T0 + 60_000), false);
  assert.equal(C.isDutyActive(duty, "ABCDEFGHIJ", T0 + C.COMPANY_DUTY_TTL_MS), false);
  assert.equal(C.isDutyActive(null, "ABCDEFGHIJ", T0), false);
});

test("company-p4: 勤務1回で報酬は会社資産だけに増え、個人への払い出しは無い", () => {
  const { company } = foundCompany(100_000, 10_000);
  const member = company.members[0];
  const duty = { companyId: company.id, since: T0, lastWorkAt: 0 };
  const plan = C.planWork(company, member, duty, T0 + 1_000);
  assert.ok(!("error" in plan));
  assert.equal(plan.reward, C.COMPANY_WORK_REWARD);
  assert.equal(plan.company.assets, company.assets + C.COMPANY_WORK_REWARD);
  assert.equal(plan.entry.amount, C.COMPANY_WORK_REWARD);
  assert.ok(plan.entry.reason.startsWith("勤務報酬"));
  assert.equal(plan.entry.userId, member.discordId);
  assert.equal("payouts" in plan, false);
  assert.equal("net" in plan, false);
  assert.equal(plan.duty.lastWorkAt, T0 + 1_000);
  const profit = C.taxableProfit([plan.entry], T0);
  assert.equal(profit, C.COMPANY_WORK_REWARD);
});

test("company-p4: 勤務は5分クールダウン中は弾かれ、過ぎれば再びできる", () => {
  const { company } = foundCompany(100_000, 10_000);
  const member = company.members[0];
  const duty = { companyId: company.id, since: T0, lastWorkAt: T0 };
  const blocked = C.planWork(company, member, duty, T0 + 60_000);
  assert.ok("error" in blocked);
  assert.equal(blocked.error, "cooldown");
  assert.equal(blocked.nextWorkAt, T0 + C.COMPANY_WORK_COOLDOWN_MS);
  const ok = C.planWork(company, member, duty, T0 + C.COMPANY_WORK_COOLDOWN_MS);
  assert.ok(!("error" in ok));
});

test("company-p4: 店舗看板の登録パースは会社 ID と設置者 ID を要求する", () => {
  const sign = { companyId: "ABCDEFGHIJ", ownerId: "deadbeef" };
  assert.deepEqual(C.parseCompanySign(JSON.stringify(sign)), sign);
  assert.equal(C.parseCompanySign(JSON.stringify({ companyId: "ABCDEFGHIJ" })), null);
  assert.equal(C.parseCompanySign(JSON.stringify({ ownerId: "deadbeef" })), null);
  assert.equal(C.parseCompanySign(null), null);
});

test("company-p4: 店頭購入はパネル購入と同じ計画（売却税10%・開示は購入時のみ）を使う", () => {
  const signRoute = fs.readFileSync(
    path.join(rootDir, "src/app/api/worldbox/company/sign/route.ts"),
    "utf8",
  );
  assert.ok(signRoute.includes("loadSignCompany"));
  assert.ok(signRoute.includes("loadTileOverride"));
  assert.ok(signRoute.includes("isSignItem"));
  assert.ok(!signRoute.includes("content: p.content"));
  assert.ok(!signRoute.includes("content: product.content"));
  const route = fs.readFileSync(
    path.join(rootDir, "src/app/api/worldbox/company/route.ts"),
    "utf8",
  );
  assert.ok(route.includes("planProductSale"));
});

test("company-p4: ルート・パネル・クライアントに空間化の配線がある", () => {
  const route = fs.readFileSync(
    path.join(rootDir, "src/app/api/worldbox/company/route.ts"),
    "utf8",
  );
  for (const action of [
    '"hq_set"',
    '"hq_clear"',
    '"clock_in"',
    '"clock_out"',
    '"work"',
    '"sign_register"',
    '"sign_unregister"',
  ]) {
    assert.ok(route.includes(`action === ${action}`), action);
  }
  assert.ok(route.includes("loadActorPosition"));
  assert.ok(route.includes("planWork"));
  const panel = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxCompanyPanel.tsx"),
    "utf8",
  );
  assert.ok(panel.includes("anchorCompanyId"));
  assert.ok(panel.includes('"hq_set"'));
  assert.ok(panel.includes('"clock_in"'));
  assert.ok(panel.includes('"work"'));
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(client.includes("/api/worldbox/company/sign"));
  assert.ok(client.includes("companyHqsRef"));
  assert.ok(client.includes("本社"));
  assert.ok(client.includes('"sign_register"'));
});
