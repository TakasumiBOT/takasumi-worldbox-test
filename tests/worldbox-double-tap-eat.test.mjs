import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = fs.readFileSync(path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"), "utf8");

test("ダブルタップで食べる: スロット（ストレージ/ホットバー共通ハンドラ）に判定がある", () => {
  assert.match(client, /lastSlotTapRef/);
  assert.match(client, /tapAt - lastTap\.at < 350/);
  assert.match(client, /def\.hunger \|\| def\.buff/);
});

test("ダブルタップで食べる: ホットバーにも判定があり、単タップは従来どおり選択", () => {
  assert.match(client, /const tapHotbar = \(index: number\) => \{\n    setSelSlot\(index\);/);
  assert.match(client, /onClick=\{\(\) => tapHotbar\(i\)\}/);
});

test("ダブルタップで食べる: eat は profile API の action eat を呼び、応答でプロフィールを差し替える", () => {
  assert.match(client, /const eatFromInventory = async \(itemId: string\) =>/);
  assert.match(client, /body: JSON\.stringify\(\{ action: "eat", itemId \}\)/);
  assert.match(
    client,
    /if \(res\.ok && data\.profile\) \{\n        setInvProfile\(data\.profile\);/,
  );
});
