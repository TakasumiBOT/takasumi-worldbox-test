import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src", "lib");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const itemsUrl = dataUrl(transpile("worldbox/economy/items.ts"));
const stockUrl = dataUrl(transpile("worldbox/economy/stock.ts"));
const companyUrl = dataUrl(transpile("worldbox/social/company.ts"));
const commoditiesUrl = dataUrl(
  transpile("worldbox/economy/commodities.ts").replaceAll('from "./items"', `from "${itemsUrl}"`),
);
const exchangeUrl = dataUrl(
  transpile("worldbox/economy/exchange.ts")
    .replaceAll('from "../social/company"', `from "${companyUrl}"`)
    .replaceAll('from "./commodities"', `from "${commoditiesUrl}"`)
    .replaceAll('from "./stock"', `from "${stockUrl}"`),
);
const fxUrl = dataUrl(
  transpile("worldbox/economy/fx.ts").replaceAll(
    'from "./commodities"',
    `from "${commoditiesUrl}"`,
  ),
);
const bankUrl = dataUrl(transpile("worldbox/economy/bank.ts"));

const C = await import(companyUrl);
const M = await import(commoditiesUrl);
const EX = await import(exchangeUrl);
const FX = await import(fxUrl);
const BK = await import(bankUrl);

const T0 = 1_800_000_000_000;

test("exchange: IPO要件検証・AMM買付・配当分配・ポートフォリオ評価", () => {
  const { company: smallCo } = C.foundCompany(
    "CMP0000002",
    { name: "SmallCo", description: "資産不足テスト企業", capital: 400_000, salary: 5_000 },
    { ownerKey: "dc:founder", discordId: "founder", name: "Founder", joinedAt: T0 },
    T0,
  );
  const { company: bigCo } = C.foundCompany(
    "CMP0000003",
    { name: "MegaCorp", description: "大型上場企業テスト", capital: 800_000, salary: 5_000 },
    { ownerKey: "dc:founder", discordId: "founder", name: "Founder", joinedAt: T0 },
    T0,
  );

  let ex = EX.emptyExchangeState();
  const mkt = M.emptyCommoditiesMarket();

  const failIpo = EX.planCompanyIpo(
    ex,
    smallCo,
    { ticker: "MGC", issuedShares: 10_000, publicPct: 30, ipoPrice: 100 },
    T0,
  );
  assert.equal(failIpo.ok, false);
  assert.equal(failIpo.error, "insufficient_assets");

  const okIpo = EX.planCompanyIpo(
    ex,
    bigCo,
    { ticker: "MGC", issuedShares: 10_000, publicPct: 30, ipoPrice: 100 },
    T0,
  );
  assert.equal(okIpo.ok, true);
  assert.equal(okIpo.founderShares, 7_000);
  assert.equal(okIpo.listing.poolShares, 3_000);
  assert.equal(okIpo.fee, EX.IPO_LISTING_FEE);
  ex = okIpo.state;

  const listedCo = {
    ...bigCo,
    assets: bigCo.assets - okIpo.fee,
    ipo: {
      ticker: "MGC",
      issuedShares: 10_000,
      publicShares: 3_000,
      ipoPrice: 100,
      listedAt: T0,
      totalDividendsPaid: 0,
    },
  };
  const companies = new Map([[listedCo.id, listedCo]]);

  // 投資家が500株購入 -> AMMスリッページにより約定価格・株価が上昇
  const buy = EX.planExchangeBuy(ex, "dc:inv1", "MGC", 500, mkt, companies, T0 + 1000);
  assert.equal(buy.ok, true);
  assert.ok(buy.plan.execPrice > 100);
  ex = buy.plan.nextState;
  assert.ok(ex.listings.MGC.lastPrice > 100);

  // 配当 150,000円（創業者7,000株＋投資家500株＝7,500株に配分 -> 1株20円）
  const div = EX.planCorporateDividend(ex, listedCo, 150_000);
  assert.equal(div.ok, true);
  assert.equal(div.perShare, 20);
  assert.equal(div.totalDistributed, 150_000);
  assert.equal(div.recipientCount, 2);
  ex = div.state;
  assert.equal(ex.portfolios["dc:inv1"].claimableDividends, 10_000);
  assert.equal(ex.portfolios["dc:founder"].claimableDividends, 140_000);

  // NPC銘柄の売買とポートフォリオ評価
  const buyNpc = EX.planExchangeBuy(ex, "dc:inv1", "TAKASUMI", 10, mkt, companies, T0 + 2000);
  assert.equal(buyNpc.ok, true);
  ex = buyNpc.plan.nextState;
  const val = EX.computePortfolioValue(ex, "dc:inv1", mkt, companies, T0 + 2000);
  assert.ok(val > 50_000);
});

test("fx: 現物スワップ・レバレッジ証拠金取引・スワップ金利・強制ロスカット報奨金", () => {
  let fx = FX.emptyFxState();
  const mkt = M.emptyCommoditiesMarket();

  // GLD 現物買付 -> 売付
  const spotBuy = FX.fxSpotSwapBuy(fx, "dc:tr1", "GLD", 25_000, mkt, 4, T0);
  assert.equal(spotBuy.ok, true);
  assert.ok(spotBuy.centiReceived > 0);
  fx = spotBuy.state;
  assert.ok(FX.fxSpotPortfolioValue(fx, "dc:tr1", mkt, 4, T0) > 0);

  const spotSell = FX.fxSpotSwapSell(
    fx,
    "dc:tr1",
    "GLD",
    Math.floor(spotBuy.centiReceived / 2),
    mkt,
    4,
    T0 + 1000,
  );
  assert.equal(spotSell.ok, true);
  assert.ok(spotSell.wbcReceived > 0);
  fx = spotSell.state;

  // VLT (高金利11% vs WBC 3%) を10倍レバレッジでロングオープン
  const openRes = FX.openFxMarginPosition(
    fx,
    {
      ownerKey: "dc:tr1",
      discordId: "tr1",
      currency: "VLT",
      side: "long",
      leverage: 10,
      marginWbc: 10_000,
      now: T0,
    },
    mkt,
    4,
  );
  assert.equal(openRes.ok, true);
  fx = openRes.state;

  // 24時間経過でプラスのスワップ金利が付与される
  const defVlt = FX.fxCurrencyById("VLT");
  const eval24h = FX.evaluateMarginPosition(
    openRes.position,
    openRes.position.entryRate,
    defVlt,
    T0 + 24 * 3_600_000,
  );
  assert.ok(eval24h.swapDelta > 0);

  // 価格が8%急落（10倍レバなので-80% -> 維持率20% <= 30% でロスカット対象）
  const crashRate = Math.floor(openRes.position.entryRate * 0.92);
  const evalCrash = FX.evaluateMarginPosition(openRes.position, crashRate, defVlt, T0 + 1000);
  assert.equal(evalCrash.liquidatable, true);

  // フロー偏りを大きくマイナスにして実際に強制ロスカットをトリガーできるか確認
  const stressedFx = {
    ...fx,
    flows: {
      ...fx.flows,
      VLT: { ...fx.flows.VLT, skewBps: -1500 },
    },
  };
  const liqRes = FX.closeFxMarginPosition(
    stressedFx,
    openRes.position.id,
    "dc:liquidator",
    mkt,
    4,
    T0 + 5000,
    true,
  );
  assert.equal(liqRes.ok, true);
  assert.equal(liqRes.liquidated, true);
});

test("bank: 変動金利預金・50%LTV株式/FX/預金担保ローン・担保ロック・返済", () => {
  let bank = BK.emptyBankState();
  const dep = BK.planBankDeposit(bank, "dc:u1", 100_000, T0);
  assert.equal(dep.ok, true);
  bank = dep.state;

  // 預金10万 + 株式10万 + FX 10万 = 担保30万 -> LTV 50% で最大 15万借入可能
  const limit = BK.computeCreditLimit(bank.accounts["dc:u1"], 100_000, 100_000);
  assert.equal(limit.totalCollateral, 300_000);
  assert.equal(limit.maxBorrowLimit, 150_000);

  const tooMuch = BK.planBankBorrow(bank, "dc:u1", 150_001, 100_000, 100_000, T0);
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.error, "exceeds_credit_limit");

  const borrow = BK.planBankBorrow(bank, "dc:u1", 120_000, 100_000, 100_000, T0);
  assert.equal(borrow.ok, true);
  bank = borrow.state;

  // 株式とFX評価額がゼロになると預金10万だけでは債務12万の担保が足りず引き出しロック
  const locked = BK.planBankWithdraw(bank, "dc:u1", 50_000, 0, 0, T0 + 1000);
  assert.equal(locked.ok, false);
  assert.equal(locked.error, "locked_as_collateral");

  // 24時間後の利息加算確認と全額返済
  const later = T0 + 24 * 3_600_000;
  const accrued = BK.accrueBankAccount(bank.accounts["dc:u1"], bank, later);
  assert.ok(accrued.deposit > 100_000);
  assert.ok(accrued.accruedInterest > 0);

  const repay = BK.planBankRepay(bank, "dc:u1", 200_000, later);
  assert.equal(repay.ok, true);
  assert.ok(repay.paidInterest > 0);
  assert.equal(repay.paidPrincipal, 120_000);
  assert.equal(BK.totalBankDebt(repay.state.accounts["dc:u1"]), 0);
});
