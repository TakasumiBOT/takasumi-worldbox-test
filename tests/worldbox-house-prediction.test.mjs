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

const HP = await import(dataUrl(transpile("worldbox/activity/house-pool.ts")));
const PR = await import(dataUrl(transpile("worldbox/activity/prediction.ts")));

const T0 = 1_800_000_000_000;

test("house-pool: LP出資シェア発行・収益配分によるNAV上昇・償還手数料・安全残高制限", () => {
  let pool = HP.emptyHousePoolState();
  assert.equal(HP.housePoolNavPerShare(pool), 1);

  // プレイヤーが1,000,000円出資 -> シード1,000,000 + 出資1,000,000 = 2,000,000円（シェア各50%）
  const dep = HP.planHousePoolDeposit(pool, "dc:lp1", 1_000_000);
  assert.equal(dep.ok, true);
  assert.equal(dep.sharesMinted, 1_000_000);
  pool = dep.state;

  // カジノ・競馬・予測市場から200,000円の胴元収益が流入 -> プール2,200,000円 / 2,000,000シェア (NAV 1.1)
  pool = HP.applyHousePoolYield(pool, 200_000);
  assert.equal(pool.cumulativeYield, 200_000);
  assert.ok(Math.abs(HP.housePoolNavPerShare(pool) - 1.1) < 1e-6);
  assert.equal(HP.housePoolActorValue(pool, "dc:lp1"), 1_100_000);

  // 次の出資者はNAV 1.1のため110,000円で100,000シェアを取得
  const dep2 = HP.planHousePoolDeposit(pool, "co:CMP1", 110_000);
  assert.equal(dep2.ok, true);
  assert.equal(dep2.sharesMinted, 100_000);
  pool = dep2.state;

  // lp1が全シェア引き出し -> 解約手数料0.5%差引後を受領
  const wd = HP.planHousePoolWithdraw(pool, "dc:lp1", 1_000_000);
  assert.equal(wd.ok, true);
  assert.equal(wd.gross, 1_100_000);
  assert.equal(wd.fee, 5_500);
  assert.equal(wd.net, 1_094_500);

  // 損失発生時もプール最低準備金(10,000円)を割らない
  const lossPool = HP.applyHousePoolYield(wd.state, -99_999_999);
  assert.equal(lossPool.poolWbc, 10_000);
  assert.ok(lossPool.cumulativeLoss > 0);
});

test("prediction: 1時間パリミュチュエル市場・締切ガード・分配とLP手数料還流・片側全額返金", () => {
  let st = PR.emptyPredictionState();
  const win = PR.currentRoundWindow(T0);
  const ensured = PR.ensureRound(
    st,
    { kind: "fx", symbol: "GLD", label: "ゴールド本位", strikePrice: 2500 },
    T0,
  );
  st = ensured.state;
  const round = ensured.round;
  assert.equal(round.opensAt, win.opensAt);

  // UP 20,000円, DOWN 30,000円（合計50,000円 -> 手数料4%=2,000円, LP還流=1,000円, 分配原資=48,000円）
  const bUp = PR.planPredictionBet(st, {
    ownerKey: "dc:u1",
    discordId: "u1",
    roundId: round.id,
    side: "up",
    amount: 20_000,
    now: win.opensAt + 60_000,
  });
  assert.equal(bUp.ok, true);
  st = bUp.state;

  const bDown = PR.planPredictionBet(st, {
    ownerKey: "dc:u2",
    discordId: "u2",
    roundId: round.id,
    side: "down",
    amount: 30_000,
    now: win.opensAt + 120_000,
  });
  assert.equal(bDown.ok, true);
  st = bDown.state;

  // 締切後はベット不可
  const late = PR.planPredictionBet(st, {
    ownerKey: "dc:u3",
    discordId: "u3",
    roundId: round.id,
    side: "up",
    amount: 1_000,
    now: win.closesAt,
  });
  assert.equal(late.ok, false);
  assert.equal(late.error, "betting_closed");

  // 決済時刻到達：価格上昇で UP 勝利
  const settled = PR.settlePredictionRound(st, round.id, 2550, win.settlesAt);
  assert.equal(settled.settled, true);
  assert.equal(settled.houseFeeYield, 1_000);
  st = settled.state;

  const claimU1 = PR.claimUserPredictionPayouts(st, "dc:u1");
  assert.equal(claimU1.totalPayout, 48_000);
  // 二重請求防止
  const claimAgain = PR.claimUserPredictionPayouts(claimU1.state, "dc:u1");
  assert.equal(claimAgain.totalPayout, 0);

  // 敗者は0円
  const claimU2 = PR.claimUserPredictionPayouts(claimAgain.state, "dc:u2");
  assert.equal(claimU2.totalPayout, 0);

  // 片側ベットのみ＆勝者0の場合は手数料ゼロで全額返金
  let st2 = PR.emptyPredictionState();
  const r2 = PR.ensureRound(
    st2,
    { kind: "stock", symbol: "TAKASUMI", label: "タカスミ", strikePrice: 1000 },
    T0,
  );
  st2 = r2.state;
  const bOnlyUp = PR.planPredictionBet(st2, {
    ownerKey: "dc:u1",
    discordId: "u1",
    roundId: r2.round.id,
    side: "up",
    amount: 5_000,
    now: win.opensAt + 10_000,
  });
  assert.equal(bOnlyUp.ok, true);
  const s2 = PR.settlePredictionRound(bOnlyUp.state, r2.round.id, 900, win.settlesAt);
  assert.equal(s2.houseFeeYield, 0);
  const refund = PR.claimUserPredictionPayouts(s2.state, "dc:u1");
  assert.equal(refund.totalPayout, 5_000);
});
