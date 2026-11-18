import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.join(import.meta.dirname, "..");
const client = fs.readFileSync(
  path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
  "utf8",
);
const economy = fs.readFileSync(
  path.join(rootDir, "src/app/games/worldbox/WorldBoxEconomyPanel.tsx"),
  "utf8",
);

function near(src, marker, needle, limit = 1200) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `marker が無い: ${marker}`);
  return src.slice(i, i + limit).includes(needle);
}

test("旧建築パネル: showNations パネルは撤去済み（中身はプレハブ建物だけだった）", () => {
  assert.ok(!client.includes("showNations"), "旧建築パネルが残っている");
  assert.ok(!client.includes("setShowNations"), "旧建築パネルの状態が残っている");
});

test("経済パネル: onClose を受け取り全状態に閉じるボタンがある", () => {
  assert.match(economy, /onClose: \(\) => void/);
  assert.match(economy, /onClick=\{onClose\}/);
  assert.match(economy, /panelHead\("読み込み中…"\)/);
  assert.ok(
    near(client, "{showEconomy &&", "onClose={() => setShowEconomy(false)}", 400),
    "クライアントが経済パネルへ onClose を渡していない",
  );
});

test("≡ メニューはパネルより手前に出る（開閉の一本化ルートを塞がない）", () => {
  assert.match(client, /minWidth: 44,\s*zIndex: 7/);
  assert.match(client, /color: "#fff",\s*zIndex: 8/);
});

test("Esc で開いているパネルとメニューを全部閉じる", () => {
  assert.ok(near(client, 'e.key !== "Escape"', "setShowEconomy(false)", 600));
  assert.ok(near(client, 'e.key !== "Escape"', "setMenuOpen(false)", 600));
});

test("既存パネルの閉じるボタンが残っている", () => {
  for (const setter of ["setStorageOpen(false)", "setBoardOpen(false)", "setMapView(false)"]) {
    assert.ok(client.includes(setter), `${setter} が無い`);
  }
  assert.ok(economy.includes('tabBtn("craft", "製造")'), "製造タブが経済パネルに無い");
});
