import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const core = require("../realtime/relay-core.js");
const watch = require("../realtime/watch-core.js");

function loadTsModule(rel, requireStub) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const ctx = vm.createContext({
    module: mod,
    exports: mod.exports,
    console,
    require: requireStub,
    Math,
    JSON,
    Set,
    Map,
    Date,
    Number,
    String,
    Array,
    Object,
    Promise,
    Error,
    Symbol,
    Reflect,
    globalThis: {},
  });
  vm.runInContext(`(function(module, exports, require){ ${js} })(module, exports, require);`, ctx);
  return mod.exports;
}

const presence = loadTsModule("../lib/worldbox/player/presence.ts", () => ({}));

test("presenceKvValue は putPresence 互換: parsePresenceEntry で読み戻せる", () => {
  const entry = {
    id: watch.presenceIdFor("discord:123"),
    name: "でし",
    x: 10.5,
    y: 20.25,
    vx: 1,
    vy: 0,
    face: "left",
    space: "world",
    role: "miner",
    rank: 3,
    party: "party:9",
    sit: true,
    ts: 1_700_000_000_000,
  };
  const value = core.presenceKvValue(entry);
  const parsed = presence.parsePresenceEntry(watch.presenceIdFor("discord:123"), value);
  assert.ok(parsed);
  assert.equal(parsed.id, entry.id);
  assert.equal(parsed.name, "でし");
  assert.equal(parsed.x, 10.5);
  assert.equal(parsed.y, 20.25);
  assert.equal(parsed.space, "world");
  assert.equal(parsed.role, "miner");
  assert.equal(parsed.rank, 3);
  assert.equal(parsed.party, "party:9");
  assert.equal(parsed.sit, true);
  assert.equal(parsed.ts, 1_700_000_000_000);
  const noSit = JSON.parse(core.presenceKvValue({ ...entry, sit: undefined }));
  assert.equal("sit" in noSit, false);
});

test("sanitize は sit を通す（REST の sanitizeHeartbeat と同形）", () => {
  const room = core.createRoom();
  const seated = core.acceptHeartbeat(
    room,
    "p1",
    "A",
    { x: 1, y: 1, space: "lobby", sit: true },
    1000,
  );
  assert.equal(seated.sit, true);
  const standing = core.acceptHeartbeat(room, "p2", "B", { x: 1, y: 1, space: "lobby" }, 1000);
  assert.equal("sit" in standing, false);
});

test("planPresenceWrite: 初回・遷移・ジャンプは即時、移動1秒/静止2秒に間引く", () => {
  const agg = core.createAggregator();
  const base = { x: 10, y: 10, vx: 0, vy: 0, space: "world" };
  assert.equal(core.planPresenceWrite(agg, "p", base, 0), true, "初回は即時");
  assert.equal(core.planPresenceWrite(agg, "p", base, 1500), false);
  assert.equal(core.planPresenceWrite(agg, "p", base, 2000), true);
  assert.equal(core.planPresenceWrite(agg, "p", { ...base, x: 10.4, vx: 1 }, 2500), false);
  assert.equal(core.planPresenceWrite(agg, "p", { ...base, x: 10.4, vx: 1 }, 3000), true);
  assert.equal(core.planPresenceWrite(agg, "p", { ...base, x: 10.4, space: "cave" }, 3100), true);
  assert.equal(core.planPresenceWrite(agg, "p", { ...base, x: 20, space: "cave" }, 3200), true);
  assert.equal(
    core.planPresenceWrite(agg, "p", { ...base, x: 20, space: "cave" }, 3300, true),
    true,
  );
  core.forgetPresenceWrite(agg, "p");
  assert.equal(core.planPresenceWrite(agg, "p", base, 3400), true, "忘却後は初回扱い");
});

test("トークンは所有者キー（ok）を運ぶ。旧トークンでは ok は null", () => {
  const secret = "phase2-secret";
  const now = 1_000_000;
  const token = core.signToken(
    { pid: "p1", name: "A", ok: "discord:123", exp: now + 60_000 },
    secret,
  );
  const auth = core.verifyToken(token, secret, now);
  assert.equal(auth.pid, "p1");
  assert.equal(auth.ok, "discord:123");
  const legacy = core.signToken({ pid: "p2", name: "B", exp: now + 60_000 }, secret);
  assert.equal(core.verifyToken(legacy, secret, now).ok, null);
});

test("配線: トークン発行・relay 集約・クライアントの停止条件", () => {
  const tokenTs = readFileSync(
    new URL("../lib/worldbox/core/realtime-token.ts", import.meta.url),
    "utf8",
  );
  assert.ok(tokenTs.includes("ok: sessionOwnerKey(session)"), "トークンに所有者キーが無い");
  const server = readFileSync(new URL("../realtime-server.js", import.meta.url), "utf8");
  assert.match(
    server,
    /kvSet\(kvCfg,\s*"worldbox_presence",\s*info\.ok/,
    "relay が bot_kv プレゼンスへ書いていない",
  );
  assert.ok(server.includes('t: "hello", now: Date.now(), agg: 1'), "集約の合図が無い");
  const client = readFileSync(
    new URL("../app/games/worldbox/WorldBoxClient.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    client.includes("if (!rtAggOn && (movedDist > 4"),
    "REST ハートビートの停止条件が集約合図に紐付いていない",
  );
  assert.ok(client.includes("rtAggOn = false;"), "切断時に REST へ復帰していない");
  assert.ok(client.includes('msg.t === "hello" && msg.agg === 1'), "合図の受信処理が無い");
});
