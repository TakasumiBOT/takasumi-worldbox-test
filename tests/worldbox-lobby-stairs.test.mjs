import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src/lib");
const require = createRequire(import.meta.url);
const relay = require(path.join(rootDir, "src/realtime", "relay-core.js"));

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const rngUrl = dataUrl(transpile("worldbox/core/rng.ts"));
const mapgenUrl = dataUrl(
  transpile("worldbox/world/mapgen.ts").replaceAll('"../core/rng"', JSON.stringify(rngUrl)),
);
const lobbyUrl = dataUrl(
  transpile("worldbox/world/lobby.ts").replaceAll('"./mapgen"', JSON.stringify(mapgenUrl)),
);
const lobby = await import(lobbyUrl);
const tentUrl = dataUrl(
  transpile("worldbox/world/tent.ts")
    .replaceAll('"./mapgen"', JSON.stringify(mapgenUrl))
    .replaceAll('"./lobby"', JSON.stringify(lobbyUrl)),
);
const floorsUrl = dataUrl(
  transpile("worldbox/world/lobby-floors.ts")
    .replaceAll('"./mapgen"', JSON.stringify(mapgenUrl))
    .replaceAll('"./lobby"', JSON.stringify(lobbyUrl)),
);
const floors = await import(floorsUrl);
const saveUrl = dataUrl(
  transpile("worldbox/core/save.ts")
    .replaceAll('"../world/lobby"', JSON.stringify(lobbyUrl))
    .replaceAll('"../world/tent"', JSON.stringify(tentUrl))
    .replaceAll('"../world/mapgen"', JSON.stringify(mapgenUrl)),
);
const save = await import(saveUrl);

function walkableTiles(data) {
  const out = new Set();
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const id = data.tiles[y * data.width + x];
      if (id !== 0 && id !== 1 && !data.blocked.has(`${x},${y}`)) out.add(`${x},${y}`);
    }
  }
  return out;
}
function reachableFrom(data, sx, sy) {
  const walk = walkableTiles(data);
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      const k = `${nx},${ny}`;
      if (walk.has(k) && !seen.has(k)) {
        seen.add(k);
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}
const tileOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
const keyOf = (p) => `${p.x},${p.y}`;

test("stairs: 1F の 2F への階段はギルドショップ区画にあり、歩行可能で着地点と対になる", () => {
  const data = lobby.buildLobby();
  const walk = walkableTiles(data);
  for (const s of lobby.LOBBY_STAIRS_2F) {
    assert.ok(walk.has(keyOf(s)), `1F の階段 ${keyOf(s)} が歩行不可`);
    const obj = data.objects.find((o) => o.x === s.x && o.y === s.y);
    assert.ok(
      obj && obj.sprite === "stairs" && obj.solid === false,
      `1F の階段 ${keyOf(s)} のオブジェクトが無い/固体`,
    );
  }
  const reach = reachableFrom(
    data,
    tileOf(lobby.LOBBY_UP_LANDING).x,
    tileOf(lobby.LOBBY_UP_LANDING).y,
  );
  for (const s of lobby.LOBBY_STAIRS_2F)
    assert.ok(reach.has(keyOf(s)), `階段 ${keyOf(s)} に着地点から行けない`);
  const landing = tileOf(lobby.LOBBY_2F_LANDING);
  assert.ok(walk.has(keyOf(landing)), "1F の着地点が歩行不可");
  assert.ok(reach.has(keyOf(landing)), "1F の着地点に着地点群から行けない");
  assert.equal(landing.y, lobby.LOBBY_STAIRS_2F[0].y + 1, "着地点が階段の前（南）でない");
  assert.ok(
    !lobby.LOBBY_STAIRS_2F.some((s) => s.x === landing.x && s.y === landing.y),
    "着地点が階段タイルと重なる",
  );
  for (const s of lobby.LOBBY_STAIRS_2F) {
    assert.ok(
      !lobby.LOBBY_STAIRS_UP.some((t) => t.x === s.x && t.y === s.y),
      "擬似2F への階段と重なる",
    );
    assert.ok(
      !lobby.LOBBY_STAIRS_DOWN.some((t) => t.x === s.x && t.y === s.y),
      "擬似2F からの階段と重なる",
    );
    assert.ok(
      !(lobby.LOBBY_WARP_PAD.x === s.x && lobby.LOBBY_WARP_PAD.y === s.y),
      "ワープパッドと重なる",
    );
  }
});

test("stairs: floorWarpAt は 1F⇄2F⇄3F の階段だけを対応付け、他は null", () => {
  for (const s of lobby.LOBBY_STAIRS_2F) {
    assert.deepEqual(floors.floorWarpAt("lobby", s.x, s.y), {
      to: "lobby2",
      entry: floors.LOBBY2_ENTRY,
    });
  }
  for (const s of floors.LOBBY2_STAIRS_DOWN) {
    assert.deepEqual(floors.floorWarpAt("lobby2", s.x, s.y), {
      to: "lobby",
      entry: lobby.LOBBY_2F_LANDING,
    });
  }
  for (const s of floors.LOBBY2_STAIRS_UP) {
    assert.deepEqual(floors.floorWarpAt("lobby2", s.x, s.y), {
      to: "lobby3",
      entry: floors.LOBBY3_ENTRY,
    });
  }
  for (const s of floors.LOBBY3_STAIRS_DOWN) {
    assert.deepEqual(floors.floorWarpAt("lobby3", s.x, s.y), {
      to: "lobby2",
      entry: floors.LOBBY2_UP_LANDING,
    });
  }
  assert.equal(floors.floorWarpAt("lobby", lobby.LOBBY_ENTRY.x, lobby.LOBBY_ENTRY.y), null);
  for (const s of lobby.LOBBY_STAIRS_UP)
    assert.equal(floors.floorWarpAt("lobby", s.x, s.y), null, "擬似2F の階段が階移動になっている");
  for (const s of lobby.LOBBY_STAIRS_DOWN)
    assert.equal(floors.floorWarpAt("lobby", s.x, s.y), null, "擬似2F の階段が階移動になっている");
  assert.equal(
    floors.floorWarpAt("lobby", lobby.LOBBY_WARP_PAD.x, lobby.LOBBY_WARP_PAD.y),
    null,
    "ワープパッドが階移動になっている",
  );
  assert.equal(floors.floorWarpAt("lobby2", 20, 14), null);
  assert.equal(floors.floorWarpAt("lobby3", 16, 13), null);
  assert.equal(
    floors.floorWarpAt("world", lobby.LOBBY_STAIRS_2F[0].x, lobby.LOBBY_STAIRS_2F[0].y),
    null,
  );
  assert.equal(
    floors.floorWarpAt("tent", floors.LOBBY2_STAIRS_DOWN[0].x, floors.LOBBY2_STAIRS_DOWN[0].y),
    null,
  );
});

test("stairs: 着地点は行き先の階段の前で歩行可能、かつその階の階段タイルではない", () => {
  const datas = {
    lobby: lobby.buildLobby(),
    lobby2: floors.buildLobby2(),
    lobby3: floors.buildLobby3(),
  };
  const stairsOf = {
    lobby: [...lobby.LOBBY_STAIRS_UP, ...lobby.LOBBY_STAIRS_DOWN, ...lobby.LOBBY_STAIRS_2F],
    lobby2: [...floors.LOBBY2_STAIRS_DOWN, ...floors.LOBBY2_STAIRS_UP],
    lobby3: [...floors.LOBBY3_STAIRS_DOWN],
  };
  const trips = [
    { from: "lobby", at: lobby.LOBBY_STAIRS_2F[0] },
    { from: "lobby2", at: floors.LOBBY2_STAIRS_DOWN[0] },
    { from: "lobby2", at: floors.LOBBY2_STAIRS_UP[0] },
    { from: "lobby3", at: floors.LOBBY3_STAIRS_DOWN[0] },
  ];
  for (const trip of trips) {
    const warp = floors.floorWarpAt(trip.from, trip.at.x, trip.at.y);
    assert.ok(warp, `${trip.from} (${trip.at.x},${trip.at.y}) の遷移が無い`);
    const dest = datas[warp.to];
    const landing = tileOf(warp.entry);
    assert.ok(
      walkableTiles(dest).has(keyOf(landing)),
      `${warp.to} の着地点 ${keyOf(landing)} が歩行不可`,
    );
    assert.ok(
      !stairsOf[warp.to].some((s) => s.x === landing.x && s.y === landing.y),
      `${warp.to} の着地点がその階の階段タイルと重なる（着地で再発火する）`,
    );
    const reach = reachableFrom(dest, landing.x, landing.y);
    for (const s of stairsOf[warp.to]) {
      if (
        warp.to === "lobby" &&
        !(s.x === lobby.LOBBY_STAIRS_2F[0].x || s.x === lobby.LOBBY_STAIRS_2F[1].x)
      )
        continue;
      if (warp.to === "lobby" && s.y !== lobby.LOBBY_STAIRS_2F[0].y) continue;
      assert.ok(reach.has(keyOf(s)), `${warp.to} の着地点から階段 ${keyOf(s)} へ戻れない`);
    }
  }
});

test("stairs: 1F→2F→3F→2F→1F の往復でセーブが空間と座標を保持する", () => {
  const worldReturn = { x: 512.5, y: 512.5 };
  const roundTrip = (space, x, y) =>
    save.parseSave(save.serializeSave({ space, x, y, worldReturn }));
  let state = {
    space: "lobby",
    x: lobby.LOBBY_STAIRS_2F[0].x + 0.5,
    y: lobby.LOBBY_STAIRS_2F[0].y + 0.5,
  };
  let warp = floors.floorWarpAt(state.space, Math.floor(state.x), Math.floor(state.y));
  state = { space: warp.to, x: warp.entry.x, y: warp.entry.y };
  let restored = roundTrip(state.space, state.x, state.y);
  assert.deepEqual(
    [restored.space, restored.x, restored.y],
    ["lobby2", floors.LOBBY2_ENTRY.x, floors.LOBBY2_ENTRY.y],
  );
  assert.deepEqual(restored.worldReturn, worldReturn, "階移動で worldReturn が壊れた");
  state = {
    space: "lobby2",
    x: floors.LOBBY2_STAIRS_UP[1].x + 0.5,
    y: floors.LOBBY2_STAIRS_UP[1].y + 0.5,
  };
  warp = floors.floorWarpAt(state.space, Math.floor(state.x), Math.floor(state.y));
  state = { space: warp.to, x: warp.entry.x, y: warp.entry.y };
  restored = roundTrip(state.space, state.x, state.y);
  assert.deepEqual(
    [restored.space, restored.x, restored.y],
    ["lobby3", floors.LOBBY3_ENTRY.x, floors.LOBBY3_ENTRY.y],
  );
  state = {
    space: "lobby3",
    x: floors.LOBBY3_STAIRS_DOWN[0].x + 0.5,
    y: floors.LOBBY3_STAIRS_DOWN[0].y + 0.5,
  };
  warp = floors.floorWarpAt(state.space, Math.floor(state.x), Math.floor(state.y));
  state = { space: warp.to, x: warp.entry.x, y: warp.entry.y };
  restored = roundTrip(state.space, state.x, state.y);
  assert.deepEqual(
    [restored.space, restored.x, restored.y],
    ["lobby2", floors.LOBBY2_UP_LANDING.x, floors.LOBBY2_UP_LANDING.y],
  );
  state = {
    space: "lobby2",
    x: floors.LOBBY2_STAIRS_DOWN[0].x + 0.5,
    y: floors.LOBBY2_STAIRS_DOWN[0].y + 0.5,
  };
  warp = floors.floorWarpAt(state.space, Math.floor(state.x), Math.floor(state.y));
  state = { space: warp.to, x: warp.entry.x, y: warp.entry.y };
  restored = roundTrip(state.space, state.x, state.y);
  assert.deepEqual(
    [restored.space, restored.x, restored.y],
    ["lobby", lobby.LOBBY_2F_LANDING.x, lobby.LOBBY_2F_LANDING.y],
  );
  assert.deepEqual(restored.worldReturn, worldReturn, "往復で worldReturn が壊れた");
});

test("relay: lobby2/lobby3 を空間として保持し、未知の階はワールドに寄せる", () => {
  assert.equal(relay.sanitizeSpace("lobby2"), "lobby2");
  assert.equal(relay.sanitizeSpace("lobby3"), "lobby3");
  assert.equal(relay.sanitizeSpace("lobby"), "lobby");
  assert.equal(relay.sanitizeSpace("lobby4"), "world");
  assert.deepEqual(relay.boundsForSpace("lobby2"), { minX: 0, maxX: 40, minY: 0, maxY: 28 });
  assert.deepEqual(relay.boundsForSpace("lobby3"), { minX: 0, maxX: 32, minY: 0, maxY: 24 });
});

test("relay: 2F/3F のハートビートは階の範囲へ丸められ、空間ごとに分離される", () => {
  const room = relay.createRoom();
  const now = 1_000_000;
  const e2 = relay.acceptHeartbeat(
    room,
    "p2",
    "floor2",
    { x: 999, y: -5, vx: 0, vy: 0, face: 1, space: "lobby2" },
    now,
  );
  assert.equal(e2.space, "lobby2");
  assert.deepEqual([e2.x, e2.y], [40, 0]);
  relay.acceptHeartbeat(
    room,
    "p3",
    "floor3",
    { x: 16, y: 13, vx: 0, vy: 0, face: 1, space: "lobby3" },
    now,
  );
  assert.deepEqual(
    relay.snapshot(room, "lobby2", "self", now).map((e) => e.id),
    ["p2"],
  );
  assert.deepEqual(
    relay.snapshot(room, "lobby3", "self", now).map((e) => e.id),
    ["p3"],
  );
  assert.deepEqual(relay.snapshot(room, "lobby", "self", now), []);
  relay.acceptHeartbeat(
    room,
    "p2",
    "floor2",
    { x: 15, y: 5, vx: 0, vy: 0, face: 1, space: "lobby3" },
    now + 1000,
  );
  assert.deepEqual(relay.snapshot(room, "lobby2", "self", now + 1000), []);
  assert.deepEqual(
    relay
      .snapshot(room, "lobby3", "self", now + 1000)
      .map((e) => e.id)
      .sort(),
    ["p2", "p3"],
  );
});

test("client: 階データが indoorData / 境界 / 描画へ配線され、階段はフェード遷移で実行される", () => {
  const client = fs.readFileSync(
    path.join(rootDir, "src/app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.match(
    client,
    /space === "lobby2"\s*\? buildLobby2\(\)\s*: space === "lobby3"\s*\? buildLobby3\(\)/,
    "indoorData が 2F/3F を返していない",
  );
  assert.match(
    client,
    /space === "lobby2"\s*\? rectBounds\(LOBBY2_W,\s*LOBBY2_H\)/,
    "2F の境界が無い",
  );
  assert.match(
    client,
    /space === "lobby3"\s*\? rectBounds\(LOBBY3_W,\s*LOBBY3_H\)/,
    "3F の境界が無い",
  );
  assert.match(
    client,
    /space === "lobby2"\s*\? lobby2TileAt\(indoor\.tiles,\s*tx,\s*ty\)/,
    "2F の床描画が lobbyTileAt のまま",
  );
  assert.match(
    client,
    /space === "lobby3"\s*\? lobby3TileAt\(indoor\.tiles,\s*tx,\s*ty\)/,
    "3F の床描画が lobbyTileAt のまま",
  );
  assert.match(client, /floorWarpAt\(space, tx, ty\)/, "階段判定（floorWarpAt）が配線されていない");
  assert.match(client, /const doFloorWarp = /, "階移動の実行（doFloorWarp）が無い");
  assert.match(
    client,
    /doFloorWarp\(floorWarp\.to, floorWarp\.entry\)/,
    "階段判定の結果が実行へ渡っていない",
  );
  const start = client.indexOf("const doFloorWarp");
  const body = client.slice(start, start + 900);
  assert.ok(
    body.includes("beginTransition(() => {") || body.includes("beginTransition(() =>\n"),
    "doFloorWarp が beginTransition を使っていない（ハードカットになる）",
  );
  assert.ok(body.includes("setSpaceUi(target)"), "doFloorWarp が空間 state を切り替えていない");
  assert.ok(body.includes("placePlayer(entry.x, entry.y)"), "doFloorWarp が着地点へ置いていない");
  assert.match(
    client,
    /space === "lobby2"\s*\? "ラウンジ"\s*: space === "lobby3"\s*\? "展望デッキ"/,
    "復帰時の階の文言が無い",
  );
  assert.match(client, /if \(space !== "lobby"\) return;/, "1F 導線が他階でも発火しうる");
});
