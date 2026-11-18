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

function stripModuleSyntax(code) {
  const lines = code.split("\n");
  const out = [];
  let skippingImport = false;
  for (const line of lines) {
    if (skippingImport) {
      if (line.includes(";")) skippingImport = false;
      continue;
    }
    if (/^import\s/.test(line)) {
      if (!line.includes(";")) skippingImport = true;
      continue;
    }
    out.push(line.replace(/^export\s+/, ""));
  }
  return out.join("\n");
}

function loadBundle(files, names) {
  const code = files.map((name) => stripModuleSyntax(transpile(name))).join("\n");
  return new Function(`${code}\nreturn { ${names.join(", ")} };`)();
}

const v = loadBundle(
  [
    "worldbox/economy/items.ts",
    "worldbox/player/profile.ts",
    "worldbox/player/roles.ts",
    "worldbox/player/vitals.ts",
    "worldbox/economy/economy.ts",
  ],
  [
    "ITEMS",
    "itemById",
    "DEFAULT_PROFILE",
    "parseProfile",
    "serializeProfile",
    "HUNGER_MAX",
    "stepVitals",
    "consumeEffect",
    "eatItem",
    "applyBuff",
    "classifyActivity",
    "activityForWindow",
    "hungerDrainPerSec",
    "HUNGER_DRAIN_IDLE_PER_SEC",
    "HUNGER_MOVE_MULT",
    "HUNGER_DASH_MULT",
    "VITAL_SETTLE_CAP_MS",
    "WARM_HUNGER_MULT",
  ],
);

const T0 = 1_700_000_000_000;

test("vitals: 旧形式プロフィール（HP・死亡記録つき）は余分を落として読める", () => {
  const legacy = JSON.stringify({
    ...v.DEFAULT_PROFILE,
    hp: 37,
    deaths: 3,
    lastDamageAt: 123,
    respawn: { x: 1, y: 2 },
    status: [
      { kind: "poison", until: T0 + 1000 },
      { kind: "warm", until: T0 + 60_000 },
    ],
    hunger: 55,
  });
  const p = v.parseProfile(legacy);
  assert.equal("hp" in p, false);
  assert.equal("deaths" in p, false);
  assert.equal("respawn" in p, false);
  assert.equal(p.hunger, 55);
  assert.deepEqual(
    p.status.map((e) => e.kind),
    ["warm"],
  );
});

test("vitals: 空腹は活動で減り方が変わる（飢えても死亡しない）", () => {
  const base = { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] };
  const idle = v.stepVitals(base, T0 + 3600_000, "idle").profile;
  const move = v.stepVitals(base, T0 + 3600_000, "move").profile;
  const dash = v.stepVitals(base, T0 + 3600_000, "dash").profile;
  assert.ok(idle.hunger > move.hunger && move.hunger > dash.hunger);
  let p = base;
  for (let i = 1; i <= 200; i++) p = v.stepVitals(p, T0 + i * 1800_000, "dash").profile;
  assert.equal(p.hunger, 0);
  const starved = v.stepVitals(base, T0 + 1800_000, "dash");
  assert.equal("died" in starved, false);
});

test("vitals: 放置レートは満腹→空まで約4時間、活動倍率は 1.6 / 2.5", () => {
  assert.equal(v.HUNGER_MOVE_MULT, 1.6);
  assert.equal(v.HUNGER_DASH_MULT, 2.5);
  const fullHours = 100 / v.hungerDrainPerSec("idle") / 3600;
  assert.ok(Math.abs(fullHours - 4) < 0.01, `満腹→空が ${fullHours} 時間`);
  assert.equal(v.hungerDrainPerSec("move"), v.HUNGER_DRAIN_IDLE_PER_SEC * 1.6);
  assert.equal(v.hungerDrainPerSec("dash"), v.HUNGER_DRAIN_IDLE_PER_SEC * 2.5);
});

test("vitals: warm の間は空腹レートが 0.6 倍になる", () => {
  assert.equal(v.WARM_HUNGER_MULT, 0.6);
  const buffed = v.applyBuff(
    { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] },
    "warm",
    T0,
  );
  const plain = v.stepVitals(
    { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] },
    T0 + 600_000,
    "idle",
  ).profile;
  const warm = v.stepVitals(buffed, T0 + 600_000, "idle").profile;
  const plainDrain = 100 - plain.hunger;
  const warmDrain = 100 - warm.hunger;
  assert.ok(
    Math.abs(warmDrain - plainDrain * 0.6) < 0.01,
    `warm 減少 ${warmDrain} / 放置 ${plainDrain}`,
  );
});

test("vitals: 活動クラスは平均速度で決まる（上限で頭打ち）", () => {
  assert.equal(v.classifyActivity(0), "idle");
  assert.equal(v.classifyActivity(0.29), "idle");
  assert.equal(v.classifyActivity(0.3), "move");
  assert.equal(v.classifyActivity(2), "move");
  assert.equal(v.classifyActivity(5.6), "dash");
  assert.equal(v.classifyActivity(100), "dash");
});

test("vitals: activityForWindow は位置の無い窓・空間変更を idle にする", () => {
  const prev = { x: 10, y: 10, space: "world" };
  assert.equal(v.activityForWindow(null, { x: 10, y: 10, space: "world" }, 10), "idle");
  assert.equal(v.activityForWindow(prev, null, 10), "idle");
  assert.equal(v.activityForWindow(prev, { x: 10, y: 10, space: "cave:1,2,0" }, 10), "idle");
  assert.equal(v.activityForWindow(prev, { x: 10, y: 10, space: "world" }, 10), "idle");
  assert.equal(v.activityForWindow(prev, { x: 40, y: 10, space: "world" }, 10), "move");
  assert.equal(v.activityForWindow(prev, { x: 40, y: 10, space: "world" }, 5), "dash");
});

test("vitals: 前回精算位置（vitalX/vitalY/vitalSpace）が往復する", () => {
  const p = { ...v.parseProfile(null), vitalX: 3, vitalY: -7, vitalSpace: "world" };
  const back = v.parseProfile(v.serializeProfile(p));
  assert.equal(back.vitalX, 3);
  assert.equal(back.vitalY, -7);
  assert.equal(back.vitalSpace, "world");
  const fresh = v.parseProfile(null);
  assert.equal(fresh.vitalX, undefined);
});

test("vitals: 精算は30分で頭打ち（長期離脱で一気に空にならない）", () => {
  assert.equal(v.VITAL_SETTLE_CAP_MS, 30 * 60 * 1000);
  const base = { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] };
  const capped = v.stepVitals(base, T0 + 24 * 3600_000, "idle").profile;
  const exact = v.stepVitals(base, T0 + 30 * 60_000, "idle").profile;
  assert.equal(capped.hunger, exact.hunger);
  assert.equal(capped.vitalAt, T0 + 24 * 3600_000);
});

test("vitals: 15秒間隔の精算でも空腹レートは仕様どおり（端数を捨てない）", () => {
  let p = { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] };
  for (let i = 1; i <= 120; i++) p = v.stepVitals(p, T0 + i * 15_000, "idle").profile;
  const oneShot = v.stepVitals(
    { ...v.parseProfile(null), hunger: 100, vitalAt: T0, status: [] },
    T0 + 1800_000,
    "idle",
  ).profile;
  assert.ok(Math.abs(p.hunger - oneShot.hunger) < 0.1, `刻み ${p.hunger} / 一括 ${oneShot.hunger}`);
});

test("vitals: 食事は空腹と warm だけ（consumeEffect / eatItem）", () => {
  const base = { ...v.parseProfile(null), hunger: 10, status: [], items: { stew: 1, wood: 3 } };
  const eff = v.consumeEffect(base, "stew", T0);
  assert.ok(eff);
  assert.equal(eff.hungerGain, 65);
  assert.equal(eff.profile.hunger, 75);
  assert.deepEqual(
    eff.profile.status.map((e) => e.kind),
    ["warm"],
  );
  assert.equal(v.consumeEffect(base, "wood", T0), null);
  const ate = v.eatItem(base, "stew", T0);
  assert.equal(ate.ok, true);
  assert.equal(ate.profile.items.stew ?? 0, 0);
  assert.equal(ate.profile.hunger, 75);
  const full = { ...v.parseProfile(null), hunger: 100, status: [], items: { onigiri: 1 } };
  assert.equal(v.eatItem(full, "onigiri", T0).error, "hunger_full");
});

test("vitals: 解毒薬・包帯・剣はカタログに存在しない", () => {
  for (const id of [
    "antidote",
    "bandage",
    "wooden_sword",
    "stone_sword",
    "iron_sword",
    "mithril_sword",
  ]) {
    assert.equal(v.itemById(id) ?? null, null, `${id} が残っている`);
  }
});

test("vitals: API ルートは sync のみで、ダメージ系アクションを持たない", () => {
  const route = fs.readFileSync(path.join(rootDir, "app/api/worldbox/vitals/route.ts"), "utf8");
  assert.ok(route.includes('"sync"'));
  for (const gone of [
    '"damage"',
    '"pvp"',
    '"hazard"',
    '"set_bed"',
    "applyMobDamage",
    "applyDeath",
  ]) {
    assert.ok(!route.includes(gone), `vitals route に ${gone} が残っている`);
  }
  assert.ok(route.includes("withUserLock"), "ユーザー単位ロックが無い");
});

test("vitals: クライアントは定期 sync を送り、HP バーを持たない", () => {
  const client = fs.readFileSync(
    path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(client.includes('action: "sync"'), "定期 sync が無い");
  assert.ok(!client.includes("maxHpFor"), "HP バーが残っている");
  assert.ok(!client.includes("/api/worldbox/mobs"), "モブ API 参照が残っている");
});
