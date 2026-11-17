// WORLD BOX バッチ8b-1: 道具強化と食事/装飾品の効果差のテスト。
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
    out.push(
      line
        .replace(/^export\s+(?=(const|let|var|function|class)\s)/, "")
        .replace(/^export\s+(?=async\s+function)/, "")
        .replace(/^export\s*\{[^}]*\};?\s*$/, ""),
    );
  }
  return out.join("\n");
}

function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

async function loadBundle(files, exportNames) {
  const code =
    files.map((name) => stripModuleSyntax(transpile(name))).join("\n") +
    `\nexport { ${exportNames.join(", ")} };\n`;
  return import(dataUrl(code));
}

const A = await loadBundle(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts"],
  ["parseProfile", "serializeProfile", "ENHANCE_MAX_LEVEL", "ENHANCE_MATERIALS"],
);

test("enhance: 攻撃力の概念は無い（強化は道具ティアにだけ効く）", () => {
  assert.equal("playerAttack" in A, false);
  assert.equal(A.ENHANCE_MAX_LEVEL, 3);
  assert.equal(A.ENHANCE_MATERIALS[4].itemId, "mithril");
});

test("enhance: profile roundtrips and clamps levels", () => {
  const prof = A.parseProfile(null);
  assert.deepEqual(prof.enhance, {});
  const up = { ...prof, enhance: { iron_pickaxe: 2, bogus: 99, wood: -1 } };
  const back = A.parseProfile(JSON.parse(JSON.stringify(A.serializeProfile(up))));
  assert.equal(back.enhance.iron_pickaxe, 2);
  assert.equal(back.enhance.bogus, 3);
  assert.equal(back.enhance.wood, undefined);
});

const V = await loadBundle(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/vitals.ts"],
  ["stepVitals", "applyBuff", "parseProfile", "BUFF_DURATION_MS"],
);

function baseProfile(overrides = {}) {
  return {
    ...V.parseProfile(null),
    hunger: 100, vitalAt: 1_000_000, status: [],
    ...overrides,
  };
}

test("buffs: warm slows hunger drain (alert は存在しない)", () => {
  const now = 1_000_000 + 600_000; // 10分後
  const plain = V.stepVitals(baseProfile(), now).profile;
  assert.equal(plain.hunger, 95.833); // 放置レート: 100 - (100/14400)*600（端数は保持）
  const buffed = V.applyBuff(baseProfile(), "warm", 1_000_000);
  const warmed = V.stepVitals(buffed, now).profile;
  assert.equal(warmed.hunger, 97.5); // ドレイン ×0.6
  // バフ自体は窓の途中まで残っている（終端ちょうどで掃除される）
  const mid = V.stepVitals(buffed, 1_300_000).profile;
  assert.ok(mid.status.some((e) => e.kind === "warm"));
  assert.deepEqual(Object.keys(V.BUFF_DURATION_MS), ["warm"]);
});

const E = await loadBundle(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/vitals.ts", "worldbox/economy/economy.ts"],
  ["eatItem", "sellItem", "parseProfile"],
);

test("effects: stew grants warm, honey tea is hunger only", () => {
  const now = 5_000_000;
  const prof = { ...E.parseProfile(null), hunger: 10, items: { stew: 1, honey_tea: 1 } };
  const ate = E.eatItem(prof, "stew", now);
  assert.equal(ate.ok, true);
  const warm = ate.profile.status.find((e) => e.kind === "warm");
  assert.equal(warm.until, now + 10 * 60_000);
  const drank = E.eatItem(ate.profile, "honey_tea", now);
  assert.equal(drank.ok, true);
  assert.ok(!drank.profile.status.some((e) => e.kind === "alert"), "alert バフは無い");
  assert.ok(drank.profile.status.some((e) => e.kind === "warm"), "warm バフは残る");
});

test("effects: holding the golden accessory boosts sell proceeds by 10%", () => {
  const plain = { ...E.parseProfile(null), items: { wood: 10 } };
  const r1 = E.sellItem(plain, "wood", 10);
  const withAcc = { ...E.parseProfile(null), items: { wood: 10, accessory: 1 } };
  const r2 = E.sellItem(withAcc, "wood", 10);
  assert.equal(r1.coin.amount, 480); // wood sellPrice 48 × 10
  assert.equal(r2.coin.amount, 528);
});
