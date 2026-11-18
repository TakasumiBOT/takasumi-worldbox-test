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

const S = await import(dataUrl(transpile("worldbox/economy/stock.ts")));
const S2 = await import(dataUrl(transpile("worldbox/economy/stock.ts") + "\n// second instance\n"));
const eco = await import(dataUrl(transpile("worldbox/economy/economy-bridge.ts")));

const infraStubUrl = dataUrl(`
const kvStore = new Map();
const ops = new Map();
export function isBotApiConfigured() { return true; }
export async function kvGet(ns, key) {
  const v = kvStore.get(ns + ":" + key);
  return v === undefined ? null : v;
}
export async function kvSet(ns, key, value) { kvStore.set(ns + ":" + key, value); }
export async function kvDelete(ns, key) { kvStore.delete(ns + ":" + key); }
export async function kvList(ns) {
  const out = new Map();
  for (const [k, v] of kvStore) {
    if (k.startsWith(ns + ":")) out.set(k.slice(ns.length + 1), v);
  }
  return out;
}
export async function submitEconomyOp(op) {
  const existing = ops.get(op.id);
  if (existing) return { state: existing.status, op: existing };
  const done = { ...op, status: "done", appliedAt: Date.now() };
  ops.set(op.id, done);
  return { state: "done", op: done };
}
export async function waitForOpDone(userKey, opId) {
  return ops.get(opId) ?? null;
}
export function __ops() { return [...ops.values()]; }
export function __reset() { kvStore.clear(); ops.clear(); }
`);
const infra = await import(infraStubUrl);
const stockUrl = dataUrl(transpile("worldbox/economy/stock.ts"));
const ecoUrl = dataUrl(transpile("worldbox/economy/economy-bridge.ts"));
const online = await import(
  dataUrl(
    transpile("worldbox/economy/stock-online.ts")
      .replaceAll('"../../bot-api"', JSON.stringify(infraStubUrl))
      .replaceAll('"./economy-bridge"', JSON.stringify(ecoUrl))
      .replaceAll('"./economy-bridge-online"', JSON.stringify(infraStubUrl))
      .replaceAll('"./stock"', JSON.stringify(stockUrl)),
  )
);

const T0 = Date.UTC(2026, 10, 18, 3, 0, 0);
const DAY_MS = 24 * 3_600_000;

test("stock: 銘柄は架空企業10社で、配当パラメータが v3 仕様の範囲内", () => {
  assert.equal(S.STOCKS.length, 10);
  const ids = new Set(S.STOCKS.map((s) => s.id));
  assert.equal(ids.size, 10);
  for (const def of S.STOCKS) {
    assert.ok(def.name.length > 0 && def.industry.length > 0, `${def.id} に社名・業種が無い`);
    assert.ok(
      def.dividendAmount >= 100 && def.dividendAmount <= 5_000,
      `${def.id} の dividendAmount が範囲外`,
    );
    assert.ok(
      def.dividendRate >= 0.0001 && def.dividendRate <= 0.003,
      `${def.id} の dividendRate が範囲外`,
    );
    assert.equal(S.stockById(def.id), def);
  }
  assert.equal(S.stockById("SONY"), null);
  assert.equal(S.stockById(123), null);
});

test("stock: 価格系列は決定的で、別インスタンスでも同じ列になる", () => {
  for (const def of S.STOCKS) {
    const a = S.stockPriceSeries(def);
    const b = S2.stockPriceSeries(S2.stockById(def.id));
    assert.equal(a.length, S.STOCK_SERIES_LENGTH);
    assert.deepEqual([...a], [...b], `${def.id} の系列がインスタンス間で違う`);
    for (const price of a) {
      assert.ok(Number.isInteger(price), `${def.id} の価格が整数でない`);
      assert.ok(
        price >= S.STOCK_PRICE_MIN && price <= S.STOCK_PRICE_MAX,
        `${def.id} の価格が範囲外: ${price}`,
      );
    }
  }
});

test("stock: 時刻インデックスは1時間で1つ進み、系列の末尾で先頭へ戻る", () => {
  assert.equal(S.stockIndexAt(S.STOCK_EPOCH_MS), 0);
  assert.equal(S.stockIndexAt(S.STOCK_EPOCH_MS + 3_600_000), 1);
  assert.equal(S.stockIndexAt(S.STOCK_EPOCH_MS - 1), 0);
  const def = S.stockById("TOMOTA");
  const first = S.stockPrice(def, S.STOCK_EPOCH_MS);
  assert.equal(S.stockPrice(def, S.STOCK_EPOCH_MS + S.STOCK_SERIES_LENGTH * 3_600_000), first);
  const now = S.STOCK_EPOCH_MS + 100 * 3_600_000;
  assert.equal(S.stockPrevPrice(def, now), S.stockPrice(def, now - 3_600_000));
  const history = S.stockPriceHistory(def, now, 48);
  assert.equal(history.length, 48);
  assert.equal(history[history.length - 1], S.stockPrice(def, now));
});

test("stock: 購入計画は総額=単価×株数、上限と株数の検証が効く", () => {
  const def = S.stockById("RIPPLE");
  const price = S.stockPrice(def, T0);
  const plan = S.planStockBuy(def, 10, T0);
  assert.deepEqual(plan, { price, count: 10, total: price * 10 });
  assert.equal(S.planStockBuy(def, 0, T0), null);
  assert.equal(S.planStockBuy(def, -3, T0), null);
  assert.equal(S.planStockBuy(def, 1.5, T0), null);
  assert.equal(S.planStockBuy(def, S.STOCK_COUNT_MAX + 1, T0), null);
  assert.equal(S.planStockBuy(def, S.STOCK_COUNT_MAX, T0), null);
});

test("stock: 売却計画は売却税10%を差し引き、税は国庫側に残る計算になる", () => {
  const def = S.stockById("TOMOTA");
  const price = S.stockPrice(def, T0);
  const plan = S.planStockSell(def, { TOMOTA: 100 }, 100, T0);
  const gross = price * 100;
  const tax = Math.floor(gross * 0.1);
  assert.equal(plan.gross, gross);
  assert.equal(plan.tax, tax);
  assert.equal(plan.net, gross - tax);
  assert.equal(plan.net + plan.tax, plan.gross);
  assert.equal(S.planStockSell(def, { TOMOTA: 5 }, 6, T0), null);
  assert.equal(S.planStockSell(def, {}, 1, T0), null);
});

test("stock: 配当は最低保有数から、対象株数は10,000で頭打ち", () => {
  const def = S.stockById("TAKASUMI");
  const price = 10_000;
  assert.equal(S.stockDividendFor(def, def.dividendAmount - 1, price), 0);
  assert.equal(
    S.stockDividendFor(def, def.dividendAmount, price),
    Math.ceil(def.dividendAmount * price * def.dividendRate),
  );
  assert.equal(
    S.stockDividendFor(def, 50_000, price),
    Math.ceil(10_000 * price * def.dividendRate),
  );
  const plan = S.planStockDividends({ TAKASUMI: 100, TOMOTA: 10 }, T0);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].stockId, "TAKASUMI");
  assert.equal(plan.total, plan.entries[0].amount);
});

test("stock: 配当の日付キーは JST 0:00 で切り替わる", () => {
  assert.equal(S.stockDividendDateKey(Date.UTC(2026, 0, 1, 14, 59, 59)), "2026-01-01");
  assert.equal(S.stockDividendDateKey(Date.UTC(2026, 0, 1, 15, 0, 0)), "2026-01-02");
});

test("stock: 配当オプ ID は決定的で、ユーザー・日付・分割で変わる", () => {
  const a = S.stockDividendOpId("discord:100100100100100100", "2026-11-19", 0);
  assert.equal(a, S.stockDividendOpId("discord:100100100100100100", "2026-11-19", 0));
  assert.notEqual(a, S.stockDividendOpId("discord:1002", "2026-11-19", 0));
  assert.notEqual(a, S.stockDividendOpId("discord:1001", "2026-11-20", 0));
  assert.notEqual(a, S.stockDividendOpId("discord:1001", "2026-11-19", 1));
  assert.match(a, /^[A-Za-z0-9-]{8,64}$/);
});

test("stock: 保有アカウントのパースは壊れた値を落とし、正の保有だけ残す", () => {
  const parsed = S.parseStockAccount(
    JSON.stringify({
      holdings: { TOMOTA: 100, DEEDLE: 0, JTTI: -5, RIPPLE: 2.5, UNKNOWN: 10 },
      lastDividendDate: "2026-11-18",
      dividends: [
        { date: "2026-11-18", stockId: "TOMOTA", shares: 100, price: 2800, amount: 280 },
        { date: "x", stockId: "TOMOTA", shares: 1, price: 1, amount: 1 },
      ],
    }),
  );
  assert.deepEqual(parsed.holdings, { TOMOTA: 100 });
  assert.equal(parsed.lastDividendDate, "2026-11-18");
  assert.equal(parsed.dividends.length, 1);
  assert.equal(S.parseStockAccount("{broken"), null);
  assert.equal(S.parseStockAccount(42), null);
  assert.deepEqual(S.parseStockAccount({}), {
    holdings: {},
    lastDividendDate: null,
    dividends: [],
  });
});

test("stock: 保有の付け替え（買う・売る・売り切るとキーが消える）", () => {
  let account = S.emptyStockAccount();
  account = S.applyStockBuy(account, "TOMOTA", 30);
  account = S.applyStockBuy(account, "TOMOTA", 20);
  assert.equal(account.holdings.TOMOTA, 50);
  account = S.applyStockSell(account, "TOMOTA", 10);
  assert.equal(account.holdings.TOMOTA, 40);
  account = S.applyStockSell(account, "TOMOTA", 40);
  assert.equal("TOMOTA" in account.holdings, false);
  const before = S.applyStockBuy(S.emptyStockAccount(), "DEEDLE", 5);
  assert.deepEqual(S.applyStockSell(before, "DEEDLE", 6), before);
});

test("stock(online): 購入は spend 確定後に保有が増え、売却は税引後の earn で保有が減る", async () => {
  infra.__reset();
  const now = T0;
  const def = S.stockById("RIPPLE");
  const price = S.stockPrice(def, now);

  const bought = await online.buyShares(
    "discord:100100100100100100",
    "100100100100100100",
    "RIPPLE",
    10,
    now,
  );
  assert.equal(bought.state, "done");
  assert.equal(bought.total, price * 10);
  let account = await online.loadStockAccount("discord:100100100100100100");
  assert.equal(account.holdings.RIPPLE, 10);
  let ops = infra.__ops();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "spend");
  assert.equal(ops[0].reason, "stock_buy");
  assert.equal(ops[0].amount, price * 10);

  const sold = await online.sellShares(
    "discord:100100100100100100",
    "100100100100100100",
    "RIPPLE",
    4,
    now,
  );
  assert.equal(sold.state, "done");
  const gross = price * 4;
  assert.equal(sold.gross, gross);
  assert.equal(sold.tax, Math.floor(gross * 0.1));
  assert.equal(sold.net, gross - sold.tax);
  account = await online.loadStockAccount("discord:100100100100100100");
  assert.equal(account.holdings.RIPPLE, 6);
  ops = infra.__ops();
  assert.equal(ops.length, 2);
  assert.equal(ops[1].kind, "earn");
  assert.equal(ops[1].reason, "stock_sell");
  assert.equal(ops[1].amount, sold.net);

  assert.equal(
    (await online.sellShares("discord:100100100100100100", "100100100100100100", "RIPPLE", 7, now))
      .state,
    "invalid",
  );
  assert.equal(
    (await online.buyShares("discord:100100100100100100", "100100100100100100", "RIPPLE", 0, now))
      .state,
    "invalid",
  );
  assert.equal(infra.__ops().length, 2);
});

test("stock(online): 配当 Cron は同日に二重払いせず、翌日に再び払う", async () => {
  infra.__reset();
  const now = Date.UTC(2026, 10, 18, 15, 0, 0);
  await online.storeStockAccount("discord:100100100100100100", {
    holdings: { TAKASUMI: 100, TOMOTA: 10 },
    lastDividendDate: null,
    dividends: [],
  });
  await online.storeStockAccount("discord:100200200200200200", {
    holdings: { TOMOTA: 10 }, // どの銘柄も最低保有数に届かない
    lastDividendDate: null,
    dividends: [],
  });
  const expected = S.planStockDividends({ TAKASUMI: 100, TOMOTA: 10 }, now);
  assert.ok(expected.total > 0);

  const run1 = await online.runStockDividendCron(now);
  assert.equal(run1.paidUsers, 1);
  assert.equal(run1.totalPaid, expected.total);
  const divOps = infra.__ops().filter((op) => op.reason === "stock_dividend");
  assert.equal(divOps.length, 1);
  assert.equal(divOps[0].amount, expected.total);
  assert.equal(divOps[0].id, S.stockDividendOpId("discord:100100100100100100", "2026-11-19", 0));

  const account = await online.loadStockAccount("discord:100100100100100100");
  assert.equal(account.lastDividendDate, "2026-11-19");
  assert.equal(account.dividends.length, 1);
  assert.equal(account.dividends[0].stockId, "TAKASUMI");
  assert.equal(account.dividends[0].amount, expected.total);

  const run2 = await online.runStockDividendCron(now + 3_600_000);
  assert.equal(run2.paidUsers, 0);
  assert.equal(infra.__ops().filter((op) => op.reason === "stock_dividend").length, 1);

  const run3 = await online.runStockDividendCron(now + DAY_MS);
  assert.equal(run3.paidUsers, 1);
  const divOpsAfter = infra.__ops().filter((op) => op.reason === "stock_dividend");
  assert.equal(divOpsAfter.length, 2);
  assert.notEqual(divOpsAfter[1].id, divOpsAfter[0].id);
});

test("stock: earn 理由ホワイトリストに株式の売却と配当が入っている", () => {
  assert.ok(eco.EARN_REASONS.has("stock_sell"));
  assert.ok(eco.EARN_REASONS.has("stock_dividend"));
  const sell = eco.buildEconomyOp(
    {
      kind: "earn",
      userKey: "discord:100100100100100100",
      discordId: "100100100100100100",
      amount: 900,
      reason: "stock_sell",
    },
    "test-op-0001",
    T0,
  );
  assert.ok(sell);
  const dividend = eco.buildEconomyOp(
    {
      kind: "earn",
      userKey: "discord:100100100100100100",
      discordId: "100100100100100100",
      amount: 300,
      reason: "stock_dividend",
    },
    "test-op-0002",
    T0,
  );
  assert.ok(dividend);
  const buy = eco.buildEconomyOp(
    {
      kind: "spend",
      userKey: "discord:100100100100100100",
      discordId: "100100100100100100",
      amount: 5000,
      reason: "stock_buy",
    },
    "test-op-0003",
    T0,
  );
  assert.ok(buy);
});

test("stock: 配線（取引所ステーション・ルート・Cron・クライアント）", () => {
  const read = (p) => fs.readFileSync(path.join(rootDir, p), "utf8");
  const lobby = read("lib/worldbox/world/lobby.ts");
  assert.ok(lobby.includes('"stock"'), "LobbyStation に stock が無い");
  assert.ok(
    lobby.includes('put("stock_board", 32, 17, { station: "stock" })'),
    "取引所の掲示板が置かれていない",
  );
  assert.ok(read("lib/worldbox/world/textures.ts").includes("stock_board"));
  assert.ok(fs.existsSync(path.join(rootDir, "public/img/worldbox/lobby/stock_board.png")));

  const route = read("app/api/worldbox/stock/route.ts");
  assert.ok(route.includes("loadMyLobbyStation") && route.includes("not_at_exchange"));
  assert.ok(route.includes("guest_not_allowed"));
  assert.ok(route.includes("buyShares") && route.includes("sellShares"));

  const cron = read("app/api/worldbox/internal/stock-cron/route.ts");
  assert.ok(cron.includes("runStockDividendCron") && cron.includes("CRON_SECRET"));
  const vercel = JSON.parse(read("vercel.json"));
  assert.ok(
    vercel.crons.some(
      (c) => c.path === "/api/worldbox/internal/stock-cron" && c.schedule === "0 15 * * *",
    ),
    "vercel.json に stock-cron（毎日 0:00 JST）が無い",
  );

  const client = read("app/games/worldbox/WorldBoxClient.tsx");
  assert.ok(client.includes("WorldBoxStockPanel"));
  assert.ok(client.includes('stock: "取引所"'));
  const panel = read("app/games/worldbox/WorldBoxStockPanel.tsx");
  assert.ok(panel.includes("/api/worldbox/stock"));
  assert.ok(panel.includes("プレイヤーの会社は上場しません"), "会社との混同を避ける注意書きが無い");
});
