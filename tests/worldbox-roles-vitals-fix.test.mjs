// WORLD BOX「役職・強化・バイタル」の回帰テスト（Phase 1 後の現実）。
// - 道具強化の実効ティア（ティア+強化レベル）がツルハシ/斧にも効く
// - 食事効果は vitals.consumeEffect に一本化（eatItem は消費とゲートだけ）
//   効果は空腹と warm バフのみ（HP・解毒は存在しない）
// - バフ duration はアイテム定義（buff.minutes）が正で、vitals 側は導出する
// - 配線: instances のティアゲート/斥候の罠軽減、vitals は sync のみ、
//   roles の技は porter 設置のみでユーザーロック内
// - クライアント配線: 食事バフ（warm）の残り時間表示、毒チップは無い
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");
const appDir = path.join(rootDir, "app");

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

function readApp(rel) {
  return fs.readFileSync(path.join(appDir, rel), "utf8");
}

// ---------------------------------------------------------------- 道具強化
const T = await loadBundle(
  ["worldbox/core/rng.ts", "worldbox/world/mapgen.ts", "worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/presence.ts", "worldbox/world/seasons.ts", "worldbox/world/tiles.ts"],
  ["parseProfile", "bestToolTier", "blockMineDamage", "itemById", "BLOCK_MINE_DAMAGE"],
);

function profileWith(overrides = {}) {
  return { ...T.parseProfile(null), items: {}, enhance: {}, ...overrides };
}

test("enhance: bestToolTier adds enhancement levels (pickaxe/axe)", () => {
  const plain = profileWith({ items: { wooden_pickaxe: 1 } });
  assert.equal(T.bestToolTier(plain, "pickaxe"), 1);
  const enhanced = profileWith({ items: { wooden_pickaxe: 1 }, enhance: { wooden_pickaxe: 2 } });
  assert.equal(T.bestToolTier(enhanced, "pickaxe"), 3);
  // 強化はその道具だけに効く（斧には漏れない）
  assert.equal(T.bestToolTier(enhanced, "axe"), 0);
  const axe = profileWith({ items: { stone_axe: 1 }, enhance: { stone_axe: 1 } });
  assert.equal(T.bestToolTier(axe, "axe"), 3);
  // 持っていない道具の強化は数えない
  const notHeld = profileWith({ items: {}, enhance: { iron_pickaxe: 3 } });
  assert.equal(T.bestToolTier(notHeld, "pickaxe"), 0);
});

test("enhance: blockMineDamage follows the effective pickaxe tier", () => {
  const brick = T.itemById("brick_block"); // durability 55, mineTool pickaxe
  const plain = profileWith({ items: { wooden_pickaxe: 1 } });
  assert.equal(T.blockMineDamage(plain, brick), T.BLOCK_MINE_DAMAGE[1]);
  const enhanced = profileWith({ items: { wooden_pickaxe: 1 }, enhance: { wooden_pickaxe: 2 } });
  assert.equal(T.blockMineDamage(enhanced, brick), T.BLOCK_MINE_DAMAGE[3]);
});

// ---------------------------------------------------------------- 食事まわり
const E = await loadBundle(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/vitals.ts", "worldbox/economy/economy.ts"],
  ["eatItem", "consumeEffect", "parseProfile", "itemById", "BUFF_DURATION_MS"],
);

const NOW = 1_700_000_000_000;

test("eat: 満腹では hunger_full、空腹なら食べられる（HP の概念は無い）", () => {
  const full = { ...E.parseProfile(null), hunger: 100, items: { stew: 1 } };
  const ng = E.eatItem(full, "stew", NOW);
  assert.equal(ng.ok, false);
  assert.equal(ng.error, "hunger_full");
  const hungry = { ...E.parseProfile(null), hunger: 10, items: { stew: 1 } };
  const r = E.eatItem(hungry, "stew", NOW);
  assert.equal(r.ok, true);
  assert.equal("hp" in r.profile, false);
});

test("eat: eatItem applies exactly the consumeEffect formula (single source)", () => {
  const base = { ...E.parseProfile(null), hunger: 10, items: { stew: 1, honey_tea: 1 } };
  const ate = E.eatItem(base, "stew", NOW);
  assert.equal(ate.ok, true);
  assert.equal(ate.profile.hunger, 75); // 10 + 65
  const warm = ate.profile.status.find((e) => e.kind === "warm");
  assert.equal(warm.until, NOW + 10 * 60_000);
  // consumeEffect 単体と結果が一致する（消費だけが eatItem の仕事）
  const removed = { ...base, items: { honey_tea: 1 } };
  const viaEffect = E.consumeEffect(removed, "stew", NOW);
  assert.equal(viaEffect.profile.hunger, ate.profile.hunger);
  assert.deepEqual(viaEffect.profile.status, ate.profile.status);
  // はちみつティーは空腹だけ（解毒・alert バフは無い）
  const drank = E.eatItem({ ...E.parseProfile(null), hunger: 50, items: { honey_tea: 1 } }, "honey_tea", NOW);
  assert.equal(drank.ok, true);
  assert.equal(drank.profile.hunger, 66);
  assert.deepEqual(drank.profile.status, []);
});

test("buffs: BUFF_DURATION_MS is derived from the item catalog (warm only)", () => {
  const stew = E.itemById("stew");
  assert.equal(E.BUFF_DURATION_MS.warm, stew.buff.minutes * 60_000);
  assert.deepEqual(Object.keys(E.BUFF_DURATION_MS), ["warm"]);
});

// ---------------------------------------------------------------- 配線検証
test("wiring: instances route counts enhancement in the cave tier gate and scout mitigation covers traps", () => {
  const src = readApp("api/worldbox/instances/route.ts");
  assert.match(src, /function bestToolTier\([\s\S]*?profile\.enhance/);
  assert.match(src, /profile\.role === "scout" && rng\(\) < 0\.5/, "斥候の罠軽減が無い");
});

test("wiring: vitals route は sync のみをユーザーロック内で処理する", () => {
  const src = readApp("api/worldbox/vitals/route.ts");
  assert.match(src, /withUserLock\(ownerKey/);
  assert.ok(!src.includes('"hazard"'), "hazard アクションが残っている");
  assert.ok(!src.includes('"damage"'), "damage アクションが残っている");
});

test("wiring: roles の技は porter 設置のみ（蘇生は無い）", () => {
  const src = readApp("api/worldbox/roles/route.ts");
  assert.match(src, /fields\.action === "skill"[\s\S]{0,700}?withUserLock\(ownerKey, async \(\) => \{\s*const profile = await loadProfile\(ownerKey\);/);
  assert.ok(!src.includes('"revive"'), "蘇生が残っている");
  assert.match(src, /addMasteryXp\(next, "teleporter", 2\)/, "ポーター設置の技 XP が無い");
});

test("wiring: client shows the warm food buff with remaining minutes and no poison chip", () => {
  const src = readApp("games/worldbox/WorldBoxClient.tsx");
  assert.match(src, /"温かい食事"/);
  assert.match(src, /e\.until > gaugeNow/);
  assert.ok(!src.includes("毒</span>"), "毒チップが残っている");
});
