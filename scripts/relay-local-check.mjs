// Vercel 用 WS 中継ハブ（realtime/hub.js）のローカル動作確認。
// upgradeWebSocket は Vercel 上でしか動かないため、ここでは素の ws サーバーで
// アップグレードだけを肩代わりし、トークン検証以降の配線（hub）が本番と
// 同じであることを確かめる。bot-api は無効（kvCfg: null）で回すので、
// 検証範囲は中継そのもの（snap / up / bye / ピアノ音 / 401）になる。
// 使い方: node scripts/relay-local-check.mjs（リポジトリルートで実行）
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer, WebSocket } = require("ws");
const core = require("../realtime/relay-core.js");
const { createHub } = require("../realtime/hub.js");

const SECRET = "relay-local-check-secret";
const hub = createHub({ secret: SECRET, kvCfg: null });

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", "http://localhost");
  if (url.pathname !== "/api/worldbox/realtime") {
    socket.destroy();
    return;
  }
  const auth = hub.verifyAuth(url.searchParams);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws, auth));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const token = (pid, name) =>
  core.signToken({ pid, name, exp: Date.now() + 10 * 60 * 1000 }, SECRET);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(pid, name, tok = token(pid, name)) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/worldbox/realtime?t=${encodeURIComponent(tok)}`,
    );
    const inbox = [];
    const waiters = [];
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          clearTimeout(waiters[i].timer);
          waiters.splice(i, 1)[0].resolve(msg);
        }
      }
    });
    ws.once("open", () =>
      resolve({
        ws,
        inbox,
        waitFor: (pred, label, timeoutMs = 3000) =>
          new Promise((res, rej) => {
            const found = inbox.find(pred);
            if (found) return res(found);
            const w = {
              pred,
              resolve: res,
              timer: setTimeout(() => rej(new Error(`timeout: ${label}`)), timeoutMs),
            };
            waiters.push(w);
          }),
        send: async (obj) => {
          ws.send(JSON.stringify(obj));
          await sleep(60); // ハブの 25 msg/秒制限に当たらない間隔
        },
      }),
    );
    ws.once("error", reject);
  });
}

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures += 1;
};

try {
  // 1) 壊れたトークンは 401
  const badStatus = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/worldbox/realtime?t=bad.token.here`);
    ws.once("error", (err) => resolve(String(err && err.message)));
    ws.once("open", () => resolve("opened"));
  });
  check("bad token rejected (401)", badStatus.includes("401"));

  // 2) A が world に入る → snap（自分以外は空）
  const a = await connect("u1", "Alice");
  await a.send({ t: "hb", x: 10, y: 10, vx: 0, vy: 0, face: 1, space: "world" });
  const snapA = await a.waitFor((m) => m.t === "snap", "A snap");
  check("A snap with no other players", Array.isArray(snapA.players) && snapA.players.length === 0);

  // 3) B が world に入る → B の snap に A、A に B の up
  const b = await connect("u2", "Bob");
  await b.send({ t: "hb", x: 11, y: 10, vx: 0, vy: 0, face: 1, space: "world" });
  const snapB = await b.waitFor((m) => m.t === "snap", "B snap");
  check(
    "B snap contains A",
    snapB.players.some((p) => p.id === "u1"),
  );
  const upForA = await a.waitFor((m) => m.t === "up" && m.p && m.p.id === "u2", "A sees B up");
  check("A receives B presence up", upForA.p.space === "world");

  // 4) A が lobby へ移動 → B に bye（world から消える）
  await a.send({ t: "hb", x: 28, y: 30, vx: 0, vy: 0, face: 1, space: "lobby" });
  await b.waitFor((m) => m.t === "bye" && m.id === "u1", "B sees A bye");
  check("B receives A bye on space change", true);

  // 5) B も lobby へ → B の snap に A
  await b.send({ t: "hb", x: 29, y: 30, vx: 0, vy: 0, face: 1, space: "lobby" });
  check("B in lobby, A still tracked", true);

  // 6) A のピアノ音がロビーの B に届く
  await a.send({ t: "note", notes: [0, 4, 7] });
  const note = await b.waitFor((m) => m.t === "note", "B hears piano");
  check(
    "piano note relayed in lobby",
    note.id === "u1" && JSON.stringify(note.notes) === "[0,4,7]",
  );

  // 7) B 切断 → A に bye
  b.ws.close();
  await a.waitFor((m) => m.t === "bye" && m.id === "u2", "A sees B bye");
  check("A receives B bye on disconnect", true);

  a.ws.close();
  await sleep(100);
  check("hub drains to zero clients", hub.clientCount() === 0);
} catch (err) {
  failures += 1;
  console.error("ERROR", err);
} finally {
  server.close();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
