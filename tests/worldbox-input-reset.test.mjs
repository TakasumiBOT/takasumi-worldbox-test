import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.join(import.meta.dirname, "..");
const client = fs.readFileSync(path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"), "utf8");

test("input-reset: フォーカス喪失とタブ非表示で移動入力がクリアされる", () => {
  assert.match(client, /const clearMoveInput = \(\) => \{/);
  assert.match(client, /keys\.clear\(\)/);
  assert.match(client, /dashKey = null/);
  assert.match(client, /joy\.active = false/);
  assert.match(client, /window\.addEventListener\("blur", clearMoveInput\)/);
  assert.match(client, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(client, /if \(document\.hidden\) clearMoveInput\(\)/);
});

test("input-reset: クリーンアップでリスナーが外される", () => {
  assert.match(client, /window\.removeEventListener\("blur", clearMoveInput\)/);
  assert.match(client, /document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
});
