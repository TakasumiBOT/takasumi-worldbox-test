import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const client = await readFile(
  new URL("../app/games/worldbox/WorldBoxClient.tsx", import.meta.url),
  "utf8",
);

test("オンラインセーブは間引かれ、keepalive は即時送信される", () => {
  assert.match(client, /const wait = 3000 - \(performance\.now\(\) - lastOnlineSaveAt\)/);
  assert.match(client, /onlineSaveTimer = window\.setTimeout/);
  assert.match(client, /if \(keepalive\) \{[\s\S]{0,200}sendOnlineSave\(true\)/);
  assert.match(client, /if \(onlineSaveTimer !== null\) window\.clearTimeout\(onlineSaveTimer\)/);
});

test("キャンバスの DPR は最大1.5倍（リサイズと描画で一致）", () => {
  const hits = client.match(/Math\.min\(1\.5, window\.devicePixelRatio \|\| 1\)/g) ?? [];
  assert.equal(hits.length, 2);
});

test("地形とタイル上書きは整数スナップした同じ原点で描く", () => {
  assert.match(client, /const tileOriginX = Math\.round\(toScreenX\(tx0\)\)/);
  assert.match(client, /const tileSx = \(tx: number\) => tileOriginX \+ \(tx - tx0\) \* TILE/);
  const uses = client.match(/const sx = tileSx\(tx\);/g) ?? [];
  assert.equal(uses.length, 2);
});
