import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const rootDir = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const core = require(path.join(rootDir, "realtime", "relay-core.js"));

const NOW = 1_700_000_000_000;
const hb = (x, y, extra = {}) => ({ x, y, vx: 0, vy: 0, face: 1, space: "world", ...extra });

test("relay: ハートビートは整形され、範囲と速度が丸められる", () => {
  const room = core.createRoom();
  const e = core.acceptHeartbeat(room, "p1", "名前", hb(2000, -1500, { vx: 99, face: -1 }), NOW);
  assert.equal(e.x, 2000);
  assert.equal(e.y, -1500);
  assert.equal(e.vx, 16);
  assert.equal(e.face, -1);
  assert.equal(e.id, "p1");
  assert.equal(e.ts, NOW);
  const farRoom = core.createRoom();
  const far = core.acceptHeartbeat(farRoom, "p1", "n", hb(2_000_000, -2_000_000), NOW);
  assert.equal(far.x, core.WORLD_COORD_LIMIT);
  assert.equal(far.y, -core.WORLD_COORD_LIMIT);
  assert.equal(core.acceptHeartbeat(room, "p1", "n", { x: "a", y: 1 }, NOW), null);
  assert.equal(core.acceptHeartbeat(room, "p1", "n", null, NOW), null);
});

test("relay: インスタンス空間は潰さず、空間ごとに分離する", () => {
  const room = core.createRoom();
  core.acceptHeartbeat(room, "c1", "洞窟", hb(10, 10, { space: "cave:100,200:0" }), NOW);
  core.acceptHeartbeat(room, "w1", "地上", hb(10, 10, { space: "world" }), NOW);
  core.acceptHeartbeat(room, "d1", "迷宮", hb(5, 5, { space: "dungeon:0,0:1" }), NOW);
  assert.deepEqual(
    core.snapshot(room, "cave:100,200:0", "x", NOW).map((p) => p.id),
    ["c1"],
  );
  assert.deepEqual(
    core.snapshot(room, "world", "x", NOW).map((p) => p.id),
    ["w1"],
  );
  assert.deepEqual(
    core.snapshot(room, "dungeon:0,0:1", "x", NOW).map((p) => p.id),
    ["d1"],
  );
  assert.equal(core.snapshot(room, "cave:100,200:1", "x", NOW).length, 0);
  core.acceptHeartbeat(room, "c1", "洞窟", hb(1, 1, { space: "cave:100,200:1" }), NOW);
  assert.equal(core.snapshot(room, "cave:100,200:0", "x", NOW).length, 0);
  assert.deepEqual(
    core.snapshot(room, "cave:100,200:1", "x", NOW).map((p) => p.id),
    ["c1"],
  );
});

test("relay: 役職・ランク・パーティを通し、インスタンスの境界で丸める", () => {
  const room = core.createRoom();
  const e = core.acceptHeartbeat(
    room,
    "p1",
    "P",
    hb(999, 999, { space: "cave:0,0:0", role: "guard", rank: 7, party: "pk-1" }),
    NOW,
  );
  assert.equal(e.space, "cave:0,0:0");
  assert.equal(e.x, 64);
  assert.equal(e.y, 64);
  assert.equal(e.role, "guard");
  assert.equal(e.rank, 5);
  assert.equal(e.party, "pk-1");
  const sitting = core.acceptHeartbeat(room, "p9", "P", hb(2, 2, { sit: true }), NOW);
  assert.equal(sitting.sit, true);
  const standing = core.acceptHeartbeat(room, "p8", "P", hb(2, 2, { sit: "yes" }), NOW);
  assert.equal(standing.sit, undefined);
  const bad = core.acceptHeartbeat(room, "p2", "P", hb(1, 1, { role: "nope", rank: "x" }), NOW);
  assert.equal(bad.role, "free");
  assert.equal(bad.rank, 1);
  assert.equal(bad.party, "");
  const r = core.acceptHeartbeat(room, "p3", "P", hb(100, 100, { space: "ruins:0,0:0" }), NOW);
  assert.equal(r.x, 48);
  const d = core.acceptHeartbeat(room, "p4", "P", hb(100, 100, { space: "dungeon:0,0:0" }), NOW);
  assert.equal(d.x, 52);
});

test("relay: 移動連続性を満たさない申告は却下され、保管位置が返る", () => {
  const room = core.createRoom();
  core.acceptHeartbeat(room, "p1", "P", hb(0, 0), NOW);
  const rejected = core.acceptHeartbeat(room, "p1", "P", hb(100, 0), NOW + 1000);
  assert.deepEqual(rejected, { rejected: true, x: 0, y: 0, space: "world" });
  assert.equal(core.snapshot(room, "world", "x", NOW + 1000).find((p) => p.id === "p1").x, 0);
  const moved = core.acceptHeartbeat(room, "p1", "P", hb(7, 0), NOW + 1000);
  assert.equal(moved.x, 7);
  assert.equal(moved.rejected, undefined);
});

test("relay: 外部基準（プレゼンス/セーブ）で初回ハートビートを照合する", () => {
  const room = core.createRoom();
  const base = { x: 10, y: 10, space: "world", ts: NOW };
  assert.deepEqual(core.acceptHeartbeat(room, "p2", "P", hb(200, 10), NOW + 1000, base), {
    rejected: true,
    x: 10,
    y: 10,
    space: "world",
  });
  const entered = core.acceptHeartbeat(
    room,
    "p2",
    "P",
    hb(5, 5, { space: "lobby" }),
    NOW + 1000,
    base,
  );
  assert.equal(entered.space, "lobby");
  const room2 = core.createRoom();
  const saveBase = { x: 50, y: 50, space: "world" };
  assert.equal(core.acceptHeartbeat(room2, "p3", "P", hb(60, 50), NOW, saveBase).x, 60);
  assert.deepEqual(core.acceptHeartbeat(room2, "p3", "P", hb(200, 50), NOW, saveBase), {
    rejected: true,
    x: 60,
    y: 50,
    space: "world",
  });
  const room3 = core.createRoom();
  assert.equal(core.acceptHeartbeat(room3, "p4", "P", hb(999, 999), NOW, null).x, 999);
  assert.equal(core.MAX_MOVE_SPEED, 10);
  assert.equal(core.MOVEMENT_RESET_MS, 30_000);
  assert.equal(core.SAVE_FALLBACK_MAX_TILES, 12);
});

test("配線: 中継が外部基準を読み、却下を jump で返す", () => {
  const wrapper = fs.readFileSync(path.join(rootDir, "realtime-server.js"), "utf8");
  assert.ok(wrapper.includes("loadExternalBaseline"), "外部基準の読み取りが無い");
  assert.ok(wrapper.includes("pendingHbs"), "基準解決前のため置きが無い");
  assert.ok(wrapper.includes('t: "jump"'), "却下の jump 通知が無い");
  assert.ok(wrapper.includes("handleHeartbeat"), "ハートビート処理の集約が無い");
  const botkv = fs.readFileSync(path.join(rootDir, "realtime", "botkv.js"), "utf8");
  assert.ok(botkv.includes("kvGet"), "kvGet が無い");
  const client = fs.readFileSync(
    path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(client.includes('msg.t === "jump"'), "クライアントが jump を受けていない");
  assert.ok(client.includes("snapBackToServer"), "保管位置への復帰が無い");
});

test("relay: スナップショットは他者だけ・新鮮なものだけ・上限まで", () => {
  const room = core.createRoom();
  core.acceptHeartbeat(room, "me", "私", hb(1, 1), NOW);
  core.acceptHeartbeat(room, "a", "A", hb(2, 2), NOW);
  core.acceptHeartbeat(room, "old", "古", hb(3, 3), NOW - core.FRESH_MS - 1);
  core.acceptHeartbeat(room, "lob", "L", hb(4, 4, { space: "lobby" }), NOW);
  const snap = core.snapshot(room, "world", "me", NOW);
  assert.deepEqual(
    snap.map((p) => p.id),
    ["a"],
  );
  const lobSnap = core.snapshot(room, "lobby", "me", NOW);
  assert.deepEqual(
    lobSnap.map((p) => p.id),
    ["lob"],
  );
});

test("relay: 空間移動で旧空間から消え、削除と掃除が効く", () => {
  const room = core.createRoom();
  core.acceptHeartbeat(room, "p1", "P", hb(1, 1), NOW);
  core.acceptHeartbeat(room, "p1", "P", hb(2, 2, { space: "lobby" }), NOW);
  assert.equal(core.snapshot(room, "world", "x", NOW).length, 0);
  assert.equal(core.snapshot(room, "lobby", "x", NOW).length, 1);
  assert.deepEqual(core.removePlayer(room, "p1"), ["lobby"]);
  core.acceptHeartbeat(room, "p2", "P2", hb(5, 5), NOW);
  const pruned = core.pruneRoom(room, NOW + core.FRESH_MS + 1);
  assert.deepEqual(pruned, [{ id: "p2", space: "world" }]);
});

test("relay token: 署名と検証（改竄・期限切れ・鍵違いを弾く）", () => {
  const secret = "test-secret";
  const token = core.signToken({ pid: "abcd1234", name: "誰か", exp: NOW + 60_000 }, secret);
  assert.deepEqual(core.verifyToken(token, secret, NOW), {
    pid: "abcd1234",
    name: "誰か",
    ok: null,
    av: null,
  });
  assert.equal(core.verifyToken(token, "other-secret", NOW), null);
  assert.equal(core.verifyToken(token, secret, NOW + 120_000), null, "期限切れを通した");
  const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
  assert.equal(core.verifyToken(tampered, secret, NOW), null, "改竄を通した");
  assert.equal(core.verifyToken("v1.bad.bad", secret, NOW), null);
  assert.equal(core.verifyToken(token, "", NOW), null);
});

test("配線: ラッパー・デプロイ・トークンルート・クライアント", () => {
  const wrapper = fs.readFileSync(path.join(rootDir, "realtime-server.js"), "utf8");
  assert.ok(
    wrapper.includes('"/api/worldbox/realtime"') || wrapper.includes("REALTIME_PATH"),
    "中継パスが無い",
  );
  assert.ok(wrapper.includes("next-server.js"), "Next 本体を内包していない");
  assert.ok(wrapper.includes("verifyToken"), "トークン検証が無い");
  const deploy = fs.readFileSync(path.join(rootDir, "deploy/pi/deploy.sh"), "utf8");
  assert.ok(
    deploy.includes('mv "$RELEASE/server.js" "$RELEASE/next-server.js"'),
    "デプロイでラッパーが設置されない",
  );
  assert.ok(
    deploy.includes('cp -a "$BUILD/realtime-server.js" "$RELEASE/server.js"'),
    "ラッパーのコピーが無い",
  );
  assert.ok(deploy.includes("node_modules/ws"), "ws のコピーが無い");
  const route = fs.readFileSync(
    path.join(rootDir, "app/api/worldbox/realtime-token/route.ts"),
    "utf8",
  );
  assert.ok(route.includes("issueRealtimeToken"), "トークン発行ルートが無い");
  const client = fs.readFileSync(
    path.join(rootDir, "app/games/worldbox/WorldBoxClient.tsx"),
    "utf8",
  );
  assert.ok(
    client.includes("/api/worldbox/realtime-token"),
    "クライアントがトークンを取りに行かない",
  );
  assert.ok(client.includes("/api/worldbox/realtime?t="), "クライアントが中継へ繋がない");
  assert.ok(client.includes("sendWsHeartbeat"), "WS ハートビートが無い");
  assert.ok(client.includes('msg.t === "up"'), "中継の更新適用が無い");
  assert.ok(client.includes('msg.t === "bye"'), "中継の退室適用が無い");
  assert.ok(client.includes("sendHeartbeat()"), "REST フォールバックが消えている");
  assert.ok(client.includes("pollOthers"), "ポーリングが消えている");
  assert.ok(client.includes("lastRestHeartbeatAt"), "REST 併送の間隔管理が無い");
  assert.ok(client.includes("wsSeenAt"), "WS 経由の鮮度が欠落グレースに無い");
  assert.ok(client.includes("isOtherPartyInDungeon"), "WS 側のダンジョンパーティ分離が無い");
});

test("relay: createHub は env 未設定時でも deploy-config の秘密鍵でトークンを検証できる", () => {
  const { createHub } = require(path.join(rootDir, "realtime", "hub.js"));
  const cfgSrc = fs.readFileSync(path.join(rootDir, "lib", "deploy-config.ts"), "utf8");
  const match = cfgSrc.match(/discordClientSecret:\s*"([^"]*)"/);
  assert.ok(match && match[1]);
  const savedSession = process.env.DISCORD_SESSION_SECRET;
  const savedClient = process.env.DISCORD_CLIENT_SECRET;
  delete process.env.DISCORD_SESSION_SECRET;
  delete process.env.DISCORD_CLIENT_SECRET;
  try {
    const hub = createHub({ kvCfg: null });
    const token = core.signToken({ pid: "p1", name: "Tester", exp: Date.now() + 60_000 }, match[1]);
    const auth = hub.verifyAuth(new URLSearchParams({ t: token }));
    assert.equal(auth?.pid, "p1");
  } finally {
    if (savedSession !== undefined) process.env.DISCORD_SESSION_SECRET = savedSession;
    if (savedClient !== undefined) process.env.DISCORD_CLIENT_SECRET = savedClient;
  }
});
