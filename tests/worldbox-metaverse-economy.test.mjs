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
const companyUrl = dataUrl(transpile("worldbox/social/company.ts"));
const ecoBridgeUrl = dataUrl(transpile("worldbox/economy/economy-bridge.ts"));

const companyProdUrl = dataUrl(
  transpile("worldbox/social/company-production.ts")
    .replaceAll('from "../economy/items"', `from "${itemsUrl}"`)
    .replaceAll('from "./company"', `from "${companyUrl}"`),
);

const commoditiesUrl = dataUrl(
  transpile("worldbox/economy/commodities.ts").replaceAll('from "./items"', `from "${itemsUrl}"`),
);

const bridgeMockState = {
  configured: true,
  balance: 3_000_000,
  failOnKind: null,
  failAtOpIndex: -1,
  ops: [],
};
globalThis.__wbSettlementTestState = bridgeMockState;

const botApiMockUrl = dataUrl(`
export function isBotApiConfigured() { return globalThis.__wbSettlementTestState.configured; }
`);
const bridgeOnlineMockUrl = dataUrl(`
export async function readUserBalance() { return globalThis.__wbSettlementTestState.balance; }
export async function submitEconomyOp(op) {
  const st = globalThis.__wbSettlementTestState;
  st.ops.push(op);
  if (st.failOnKind && op.kind === st.failOnKind && st.ops.length === st.failAtOpIndex) {
    return { state: "failed", op: { ...op, status: "failed", error: "simulated_failure" } };
  }
  if (op.kind === "spend") st.balance -= op.amount;
  else st.balance += op.amount;
  return { state: "done", op: { ...op, status: "done", appliedAt: Date.now() } };
}
export async function waitForOpDone() { return null; }
`);

const settlementUrl = dataUrl(
  transpile("worldbox/economy/settlement.ts")
    .replaceAll('from "../../bot-api"', `from "${botApiMockUrl}"`)
    .replaceAll('from "./economy-bridge"', `from "${ecoBridgeUrl}"`)
    .replaceAll('from "./economy-bridge-online"', `from "${bridgeOnlineMockUrl}"`),
);

const C = await import(companyUrl);
const CP = await import(companyProdUrl);
const M = await import(commoditiesUrl);
const S = await import(settlementUrl);

const T0 = 1_800_000_000_000;

test("settlement: 大口コイン課金・返金チャンクと途中失敗時のロールバック", async () => {
  bridgeMockState.configured = true;
  bridgeMockState.balance = 2_500_000;
  bridgeMockState.failOnKind = null;
  bridgeMockState.failAtOpIndex = -1;
  bridgeMockState.ops = [];

  const okRes = await S.chargeUserChunked(
    "dc:100000000000000001",
    "100000000000000001",
    1_500_000,
    "market_buy",
    {
      opPrefix: "testpay1",
      refundReason: "market_refund",
    },
  );
  assert.equal(okRes.state, "done");
  assert.equal(okRes.applied, 1_500_000);
  assert.equal(bridgeMockState.balance, 1_000_000);
  assert.equal(bridgeMockState.ops.length, 2);

  // 2回目のチャンクで失敗 -> 1回目(1,000,000円)がロールバック返金される
  bridgeMockState.balance = 2_500_000;
  bridgeMockState.ops = [];
  bridgeMockState.failOnKind = "spend";
  bridgeMockState.failAtOpIndex = 2;

  const failRes = await S.chargeUserChunked(
    "dc:100000000000000001",
    "100000000000000001",
    1_500_000,
    "market_buy",
    {
      opPrefix: "testpay2",
      refundReason: "market_refund",
    },
  );
  assert.equal(failRes.state, "failed");
  assert.equal(failRes.applied, 0);
  assert.equal(bridgeMockState.balance, 2_500_000);
  assert.equal(bridgeMockState.ops.at(-1)?.kind, "earn");
  assert.equal(bridgeMockState.ops.at(-1)?.reason, "market_refund");
});

test("company-production: 倉庫入出庫・工場生産(出勤加速)・原材料買取注文", () => {
  const { company: base } = C.foundCompany(
    "CMP0000001",
    { name: "TestSteel", description: "製鉄・パン工場テスト", capital: 800_000, salary: 5_000 },
    { ownerKey: "dc:owner", discordId: "owner", name: "Owner", joinedAt: T0 },
    T0,
  );
  // 原材料買取枠を作成（小麦 10個 @ 30円 = 300円エスクロー）
  const buyRes = CP.planBuyOrderCreate(base, "wheat", 30, 10, "owner", T0, "BO1");
  assert.ok("company" in buyRes);
  assert.equal(buyRes.company.assets, base.assets - 300);

  // プレイヤーが4個売却 -> 会社在庫 +4・買取枠残 6
  const sellRes = CP.planSellToBuyOrder(buyRes.company, "BO1", 4);
  assert.ok("company" in sellRes);
  assert.equal(sellRes.payout, 120);
  assert.equal(CP.companyInventoryCount(sellRes.company, "wheat"), 4);

  // 残り6個キャンセル -> 180円返金
  const cancelRes = CP.planBuyOrderCancel(sellRes.company, "BO1", "owner", T0 + 1000);
  assert.ok("company" in cancelRes);
  assert.equal(cancelRes.refund, 180);
  assert.equal(cancelRes.company.buyOrders.length, 0);

  // 小麦を追加で2個補充してパン量産(小麦6個必要)を開始。出勤中2人で1.4倍速になる
  const stocked = CP.addCompanyInventory(cancelRes.company, "wheat", 2);
  assert.ok(stocked);
  const startSlow = CP.planFactoryStart(stocked, "bulk_bread", 1, "owner", 0, T0, "FJ0");
  const startFast = CP.planFactoryStart(stocked, "bulk_bread", 1, "owner", 2, T0, "FJ1");
  assert.ok("job" in startSlow && "job" in startFast);
  assert.ok(startFast.job.readyAt < startSlow.job.readyAt);

  // 完了前は回収不可、完了後はパン5個が倉庫へ
  const tooEarly = CP.planFactoryCollect(startFast.company, "FJ1", startFast.job.readyAt - 1);
  assert.deepEqual(tooEarly, { error: "job_not_ready" });
  const collected = CP.planFactoryCollect(startFast.company, "FJ1", startFast.job.readyAt);
  assert.ok("company" in collected);
  assert.equal(CP.companyInventoryCount(collected.company, "bread"), 5);
});

test("commodities: 価格優先・時間優先マッチ・価格改善返金・ウォッシュトレード防止・マクロ指数", () => {
  let state = M.emptyCommoditiesMarket();

  // 売り手A: wheat x10 @ 100円 (先), 売り手B: wheat x10 @ 90円 (後だが最安値)
  const s1 = M.placeMarketOrder(state, {
    side: "sell",
    actorType: "player",
    actorKey: "dc:sellerA",
    discordId: "sellerA",
    itemId: "wheat",
    price: 100,
    qty: 10,
    now: T0,
  });
  assert.equal(s1.ok, true);
  state = s1.result.state;

  const s2 = M.placeMarketOrder(state, {
    side: "sell",
    actorType: "company",
    actorKey: "co:CMPB",
    discordId: "ceoB",
    companyId: "CMPB",
    itemId: "wheat",
    price: 90,
    qty: 10,
    now: T0 + 100,
  });
  assert.equal(s2.ok, true);
  state = s2.result.state;

  // ウォッシュトレード防止: sellerA が 100円で買おうとしても sellerA 自身の売り板には約定しない（sellerB の 90円のみ約定）
  const bSelf = M.placeMarketOrder(state, {
    side: "buy",
    actorType: "player",
    actorKey: "dc:sellerA",
    discordId: "sellerA",
    itemId: "wheat",
    price: 100,
    qty: 12,
    now: T0 + 200,
  });
  assert.equal(bSelf.ok, true);
  assert.equal(bSelf.result.immediateItemsReceived, 10);
  // 100円指値で90円約定したため差額10円×10=100円が返金される
  assert.equal(bSelf.result.refundCoins, 100);
  // 残り2個は買い板として残る
  assert.equal(bSelf.result.order?.qty, 12);
  assert.equal(bSelf.result.order?.filled, 10);
  state = bSelf.result.state;

  // 売り手co:CMPB の受取権利（900円 - 3%手数料27円 = 873円）を回収
  const claimRes = M.takeActorClaims(state, "co:CMPB");
  assert.equal(claimRes.claim.coins, 873);
  state = claimRes.state;
  assert.equal(state.feeTreasury, 27);

  // 板取得とマクロ指数の計算
  const book = M.orderBookForItem(state, "wheat");
  assert.equal(book.bestBid, 100);
  assert.equal(book.bestAsk, 100);

  const macro = M.computeCommodityMacroIndices(state);
  assert.equal(macro.totalVolume, 10);
  assert.equal(macro.totalTurnover, 900);
  assert.ok(macro.sectors.crop.priceRatio > 0);

  // 売り手Aの残注文キャンセルで在庫10個返却
  const cancelRes = M.cancelMarketOrder(state, s1.result.order.id, "dc:sellerA");
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.refundItems, 10);
});
