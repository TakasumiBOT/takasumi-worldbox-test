// AGO WORLD BOX 設置物の動作C（床・ハザード・柵と門）のテスト。
// - 床ブロック: 固体にしない、速度倍率、橋は水上に置けて通常ブロックは置けない
// - 環境ハザード: ダメージ量と applyHazardDamage（クールダウン・スポーン保護）
// - 柵の固体化と木の門の開閉（applyToggleGate / actionForTile / parse の往復）
// - ルートとクライアントの配線（ソース確認）
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

function bundleModule(files, names) {
  const code = files.map((name) => stripModuleSyntax(transpile(name))).join("\n");
  return dataUrl(`${code}\nexport { ${names.join(", ")} };`);
}

function loadBundle(files, names) {
  const code = files.map((name) => stripModuleSyntax(transpile(name))).join("\n");
  return new Function(`${code}\nreturn { ${names.join(", ")} };`)();
}

const invUrl = bundleModule(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts"],
  ["parseProfile", "countItem"],
);
const inv = await import(invUrl);

const tilesUrl = bundleModule(
  ["worldbox/core/rng.ts", "worldbox/world/mapgen.ts", "worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/presence.ts", "worldbox/world/seasons.ts", "worldbox/world/tiles.ts"],
  [
    "worldTileSource", "mapTileAt", "T_GRASS", "T_WATER",
    "applyPlaceBlock", "applyToggleGate", "tileView", "actionForTile",
    "placedBlockSolid", "isFloorItem", "floorSpeedMultiplier", "isFenceItem", "isGateItem",
    "tileKey", "parseTileOverride", "presenceIdFor",
  ],
);
const T = await import(tilesUrl);

const v = loadBundle(
  ["worldbox/economy/items.ts", "worldbox/player/profile.ts", "worldbox/player/roles.ts", "worldbox/player/vitals.ts", "worldbox/economy/economy.ts"],
  ["parseProfile"],
);

const map = T.worldTileSource();
function findTile(id) {
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      if (T.mapTileAt(map, x, y) === id) return { x, y };
    }
  }
  throw new Error(`tile ${id} not found`);
}
const grassAt = findTile(T.T_GRASS);
const waterAt = findTile(T.T_WATER);

const NOW = 1_700_000_000_000;
const ME_KEY = "discord:611111111111111111";
const NO_CTX = { onCapital: false };
const withItems = (items) => inv.parseProfile({ items });
const place = (current, profile, key, at, itemId) =>
  T.applyPlaceBlock(current, profile, map, key, at.x, at.y, itemId, NOW, NO_CTX);

test("床: 床ブロックは固体にせず、速度倍率が定義どおり", () => {
  for (const id of ["path_block", "ice_block", "honey_block", "slime_block", "bridge_block"]) {
    assert.equal(T.isFloorItem(id), true, id);
    assert.equal(T.placedBlockSolid(id), false, id);
  }
  assert.equal(T.floorSpeedMultiplier("path_block"), 1.3);
  assert.equal(T.floorSpeedMultiplier("honey_block"), 0.5);
  assert.equal(T.floorSpeedMultiplier("ice_block"), 1);
  assert.equal(T.floorSpeedMultiplier(null), 1);
  // 通常ブロックは固体のまま
  assert.equal(T.placedBlockSolid("stone_block"), true);
});

test("橋: 水の上に置ける。通常ブロックと床（橋以外）は水に置けない", () => {
  const p = withItems({ bridge_block: 1, dirt_block: 1, path_block: 1 });
  const ok = place(null, p, ME_KEY, waterAt, "bridge_block");
  assert.equal(ok.ok, true);
  assert.equal(ok.override.block.itemId, "bridge_block");
  assert.equal(place(null, withItems({ dirt_block: 1 }), ME_KEY, waterAt, "dirt_block").ok, false);
  assert.equal(place(null, withItems({ path_block: 1 }), ME_KEY, waterAt, "path_block").ok, false);
  // 橋は陸にも置ける
  assert.equal(place(null, withItems({ bridge_block: 1 }), ME_KEY, grassAt, "bridge_block").ok, true);
});

test("ハザード: サボテン/マグマは通常ブロック（ダメージの仕組みは無い）", () => {
  for (const id of ["cactus_block", "magma_block"]) {
    const p = withItems({ [id]: 1 });
    const placed = place(null, p, ME_KEY, grassAt, id);
    assert.equal(placed.ok, true, `${id} が置ける`);
    assert.equal(placed.view.block.itemId, id);
  }
  assert.equal("hazardDamageFor" in v, false);
  assert.equal("applyHazardDamage" in v, false);
});

test("柵と門: 柵は固体、門は開閉でき、状態が parse を往復する", () => {
  for (const id of ["fence_wood", "stone_fence", "iron_fence"]) {
    assert.equal(T.isFenceItem(id), true, id);
    assert.equal(T.placedBlockSolid(id), true, id);
  }
  assert.equal(T.isGateItem("wooden_gate"), true);
  // 門を設置して開閉する
  const p = withItems({ wooden_gate: 1 });
  const placed = place(null, p, ME_KEY, grassAt, "wooden_gate");
  assert.equal(placed.ok, true);
  const closed = placed.override;
  const opened = T.applyToggleGate(closed, placed.profile, map, ME_KEY, grassAt.x, grassAt.y, NOW);
  assert.equal(opened.ok, true);
  assert.equal(opened.override.gateOpen, true);
  assert.equal(opened.view.block.gateOpen, true);
  const reclosed = T.applyToggleGate(opened.override, opened.profile, map, ME_KEY, grassAt.x, grassAt.y, NOW);
  assert.equal(reclosed.override.gateOpen, false);
  // parse の往復で gateOpen が残る
  const parsed = T.parseTileOverride(JSON.stringify(opened.override));
  assert.equal(parsed.gateOpen, true);
  // 門でないタイルは開閉できない
  const dirt = place(null, withItems({ dirt_block: 1 }), ME_KEY, grassAt, "dirt_block");
  assert.equal(T.applyToggleGate(dirt.override, dirt.profile, map, ME_KEY, grassAt.x, grassAt.y, NOW).ok, false);
});

test("actionForTile: 門は開閉、所有者＋道具なら採掘、橋は水でも設置候補になる", () => {
  const p = withItems({ wooden_gate: 1, bridge_block: 1 });
  const placed = place(null, p, ME_KEY, grassAt, "wooden_gate");
  const gateView = placed.view;
  assert.equal(T.actionForTile(gateView, null)?.action, "toggle_gate");
  assert.equal(T.actionForTile(gateView, { tool: "pickaxe" })?.action, "mine_block");
  // 他人の門は道具を持っていても開閉（採掘にはならない）
  const otherView = T.tileView(map, { [T.tileKey(grassAt.x, grassAt.y)]: placed.override }, grassAt.x, grassAt.y, NOW, "discord:699999999999999999");
  assert.equal(T.actionForTile(otherView, { tool: "pickaxe" })?.action, "toggle_gate");
  // 橋は水タイルでも設置候補。通常ブロックは候補にならない
  const waterView = T.tileView(map, {}, waterAt.x, waterAt.y, NOW, ME_KEY);
  assert.equal(T.actionForTile(waterView, { blockId: "bridge_block" })?.action, "place_block");
  assert.equal(T.actionForTile(waterView, { blockId: "dirt_block" }), null);
});

test("配線: ハザード送信は無く、クライアントの床・滑りは配線されている", () => {
  const route = fs.readFileSync(path.join(rootDir, "app/api/worldbox/vitals/route.ts"), "utf8");
  assert.ok(!route.includes('"hazard"'), "vitals ルートに hazard が残っている");
  assert.ok(!route.includes("applyHazardDamage"));
  const tilesRoute = fs.readFileSync(path.join(rootDir, "app/api/worldbox/tiles/route.ts"), "utf8");
  assert.match(tilesRoute, /applyToggleGate/);
  const client = fs.readFileSync(path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"), "utf8");
  assert.ok(!client.includes("postHazard"), "クライアントにハザード送信が残っている");
  assert.match(client, /slideVel/);
  assert.match(client, /onFloor !== "bridge_block"/);
  assert.match(client, /floorSpeedMultiplier/);
  assert.match(client, /slime_block/);
});
