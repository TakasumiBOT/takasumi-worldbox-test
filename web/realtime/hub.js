"use strict";
// WORLD BOX リアルタイム中継の「インスタンス内ハブ」（Vercel 用）。
//
// 本家 Pi では realtime-server.js が Next の前段に常駐して同じ配線を担う。
// ここはその配線を、Vercel Functions の1インスタンスの中で動く形に写したもの:
// - アップグレードとトークン検証はルート（app/api/worldbox/realtime/route.ts）が
//   行い、認証済みの接続を handleConnection(ws, auth) へ渡す。
// - 部屋・接続・集約・watch の状態はこのハブ（= 1インスタンス）の中だけにある。
//   インスタンスを跨いだ配信はしない（状態の正は bot_kv で、跨げない相手は
//   クライアントの REST ポーリングが拾う。本家の Phase 0〜2 と同じ劣化形）。
// - タイマーは最初の接続で起動し、最後の切断で止める（常駐前提にしない）。
// 中継の純粋ロジックは relay-core.js / watch-core.js を本家とそのまま共有する。
const core = require("./relay-core.js");
const botkv = require("./botkv.js");
const watchCore = require("./watch-core.js");

/** プレゼンス値（JSON）→ { x, y, space, ts }。壊れていれば null。 */
function parsePresenceBaseline(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.ts !== "number") return null;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.ts)) return null;
    return { x: v.x, y: v.y, space: typeof v.space === "string" ? v.space : "world", ts: v.ts };
  } catch {
    return null;
  }
}

/** セーブ値（JSON）→ { x, y, space }（ts 無し）。壊れていれば null。 */
function parseSaveBaseline(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.x !== "number" || typeof v.y !== "number") return null;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return { x: v.x, y: v.y, space: typeof v.space === "string" ? v.space : "world" };
  } catch {
    return null;
  }
}

function createHub(options = {}) {
  const secret =
    options.secret !== undefined
      ? options.secret
      : process.env.DISCORD_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET || "";
  /** bot-api の設定（未設定なら null = relay の kv 機能は無効）。 */
  const kvCfg = options.kvCfg !== undefined ? options.kvCfg : botkv.botKvConfig();

  const room = core.createRoom();
  /** ws -> { pid, name, ok, space, joined, lastMsgAt, alive, lastEntry, baseline, pendingHbs } */
  const clients = new Map();
  const aggregator = core.createAggregator();
  const aggState = { on: Boolean(kvCfg), failStreak: 0 };
  let timers = null;

  function broadcast(space, exceptWs, obj) {
    const text = JSON.stringify(obj);
    for (const [ws, info] of clients) {
      if (ws === exceptWs || info.space !== space || ws.readyState !== 1) continue;
      try {
        ws.send(text);
      } catch { /* noop */ }
    }
  }

  function sendTo(predicate, obj) {
    const text = JSON.stringify(obj);
    for (const [ws, info] of clients) {
      if (ws.readyState !== 1 || !predicate(info)) continue;
      try {
        ws.send(text);
      } catch { /* noop */ }
    }
  }

  /** bot_kv から外部基準を読む。読めなければ null（= 照合なしで受け入れる）。 */
  async function loadExternalBaseline(ownerKey) {
    if (!kvCfg || !ownerKey) return null;
    try {
      const pres = parsePresenceBaseline(await botkv.kvGet(kvCfg, "worldbox_presence", ownerKey));
      if (pres) return pres;
      return parseSaveBaseline(await botkv.kvGet(kvCfg, "worldbox_save", ownerKey));
    } catch {
      return null;
    }
  }

  const broadcastAggState = () => {
    const text = JSON.stringify({ t: "agg", on: aggState.on });
    for (const [ws] of clients) {
      if (ws.readyState !== 1) continue;
      try {
        ws.send(text);
      } catch { /* noop */ }
    }
  };

  const writePresenceKv = (info, entry, force) => {
    if (!kvCfg || !info.ok) return;
    if (!core.planPresenceWrite(aggregator, info.pid, entry, Date.now(), force)) return;
    botkv.kvSet(kvCfg, "worldbox_presence", info.ok, core.presenceKvValue(entry)).then(
      () => {
        if (aggState.failStreak >= 3) {
          aggState.failStreak = 0;
          aggState.on = true;
          broadcastAggState();
        } else {
          aggState.failStreak = 0;
        }
      },
      (err) => {
        aggState.failStreak += 1;
        if (aggState.failStreak === 1) {
          console.error("[realtime] presence kv write failed:", err && err.message);
        }
        if (aggState.failStreak >= 3 && aggState.on) {
          aggState.on = false;
          broadcastAggState();
        }
      },
    ).catch(() => { /* noop */ });
  };

  /** ハートビート1件の処理（中継・集約書き込み・配信）。却下された申告は
   * 保存せず、送り主へ保管位置（jump）を返してそこへ戻させる。 */
  const handleHeartbeat = (ws, info, msg, now) => {
    const entry = core.acceptHeartbeat(room, info.pid, info.name, msg, now, info.baseline);
    if (!entry) return;
    if (entry.rejected) {
      try {
        ws.send(JSON.stringify({ t: "jump", x: entry.x, y: entry.y, space: entry.space }));
      } catch { /* noop */ }
      return;
    }
    info.lastEntry = entry;
    writePresenceKv(info, entry, false);
    const prevSpace = info.space;
    info.space = entry.space;
    if (prevSpace && prevSpace !== entry.space) {
      broadcast(prevSpace, ws, { t: "bye", id: info.pid });
    }
    if (!info.joined) {
      info.joined = true;
      try {
        ws.send(JSON.stringify({ t: "snap", now, players: core.snapshot(room, entry.space, info.pid, now) }));
      } catch { /* noop */ }
    }
    broadcast(entry.space, ws, { t: "up", now, p: entry });
  };

  // ---- watch の宛先解決（本家 realtime-server.js と同一） ----
  const routeWatchChanges = (kind, changes, prev) => {
    if (changes.length === 0) return;
    if (kind === "tiles" || kind === "mobs" || kind === "objects" || kind === "fishing") {
      sendTo(() => true, { t: "kv", kind, changes });
    } else if (kind === "board") {
      for (const c of changes) {
        if (c.key === "messages") sendTo(() => true, { t: "kv", kind: "board", value: c.value });
      }
    } else if (kind === "nations") {
      sendTo(() => true, { t: "sync", kind: "nations" });
    } else if (kind === "requests") {
      sendTo(() => true, { t: "sync", kind: "requests" });
    } else if (kind === "guildShop") {
      sendTo(() => true, { t: "sync", kind: "guildShop" });
    } else if (kind === "chat") {
      const scopes = new Map();
      for (const c of changes) {
        const scope = watchCore.chatKeyScope(c.key);
        if (scope) scopes.set(c.key, scope);
      }
      for (const scope of scopes.values()) {
        sendTo(
          (info) => info.space === scope.space,
          { t: "sync", kind: "chat", channel: scope.channel, space: scope.space },
        );
      }
    } else if (kind === "unionChat") {
      const guilds = new Set();
      for (const c of changes) {
        const gid = watchCore.unionBoardGuildId(c.key);
        if (gid) guilds.add(gid);
      }
      for (const guildId of guilds) {
        sendTo(() => true, { t: "sync", kind: "chat", channel: "union", guildId });
      }
    } else if (kind === "party") {
      const pids = new Set();
      for (const c of changes) {
        for (const pid of watchCore.partyTargetPids(c.key, c.value)) pids.add(pid);
        if (prev && prev.has(c.key)) {
          for (const pid of watchCore.partyTargetPids(c.key, prev.get(c.key))) pids.add(pid);
        }
      }
      if (pids.size > 0) sendTo((info) => pids.has(info.pid), { t: "sync", kind: "party" });
    } else if (kind === "instances") {
      const spaces = new Set();
      const prefixes = new Set();
      const pids = new Set();
      for (const c of changes) {
        const scope = watchCore.instanceKeyScope(c.key);
        if (!scope) continue;
        if (scope.space) spaces.add(scope.space);
        if (scope.spacePrefix) prefixes.add(scope.spacePrefix);
        if (scope.pid) pids.add(scope.pid);
      }
      if (spaces.size > 0 || prefixes.size > 0) {
        sendTo(
          (info) => !!info.space && (spaces.has(info.space) || [...prefixes].some((p) => info.space.startsWith(p))),
          { t: "sync", kind: "instances" },
        );
      }
      if (pids.size > 0) sendTo((info) => pids.has(info.pid), { t: "sync", kind: "instances" });
    } else if (kind === "economy") {
      const pids = new Set();
      for (const c of changes) {
        const prevValue = prev && prev.has(c.key) ? prev.get(c.key) : null;
        for (const pid of watchCore.economyTargetPids(prevValue, c.value)) pids.add(pid);
      }
      if (pids.size > 0) sendTo((info) => pids.has(info.pid), { t: "sync", kind: "economy" });
    }
  };

  function startTimers() {
    if (timers) return;
    const t = { watch: [] };
    // 死活監視（30秒ごとに ping、応答が無ければ切る）
    t.liveness = setInterval(() => {
      for (const [ws, info] of clients) {
        if (!info.alive) {
          try {
            if (typeof ws.terminate === "function") ws.terminate();
            else ws.close();
          } catch { /* noop */ }
          continue;
        }
        info.alive = false;
        try {
          if (typeof ws.ping === "function") ws.ping();
        } catch { /* noop */ }
      }
    }, 30_000);
    // 鮮度切れの掃除（切断通知が漏れた場合の保険）
    t.prune = setInterval(() => {
      const now = Date.now();
      for (const gone of core.pruneRoom(room, now)) {
        broadcast(gone.space, null, { t: "bye", id: gone.id });
      }
    }, 5_000);
    // 時計同期と生存通知の定期 tick（Phase 0 の前提）
    t.tick = setInterval(() => {
      const text = JSON.stringify({ t: "tick", now: Date.now() });
      for (const [ws] of clients) {
        if (ws.readyState !== 1) continue;
        try {
          ws.send(text);
        } catch { /* noop */ }
      }
    }, 15_000);
    // watch: bot_kv のサーバー側一括監視と差分配信（Phase 1）
    if (kvCfg) {
      watchCore.WATCH_PLAN.forEach((plan, idx) => {
        const state = { prev: null, busy: false, failed: false };
        const run = async () => {
          if (state.busy) return;
          state.busy = true;
          try {
            const next = await botkv.kvList(kvCfg, plan.namespace);
            const changes = watchCore.diffKv(state.prev, next);
            routeWatchChanges(plan.kind, changes, state.prev);
            state.prev = next;
            state.failed = false;
          } catch (err) {
            if (!state.failed) {
              state.failed = true;
              console.error(`[realtime] watch ${plan.namespace} failed:`, err && err.message);
            }
          } finally {
            state.busy = false;
          }
        };
        const w = { timeout: null, interval: null };
        w.timeout = setTimeout(() => {
          void run();
          w.interval = setInterval(() => void run(), plan.intervalMs);
        }, 500 + idx * 300);
        t.watch.push(w);
      });
    }
    timers = t;
  }

  function stopTimers() {
    if (!timers) return;
    clearInterval(timers.liveness);
    clearInterval(timers.prune);
    clearInterval(timers.tick);
    for (const w of timers.watch) {
      if (w.timeout) clearTimeout(w.timeout);
      if (w.interval) clearInterval(w.interval);
    }
    timers = null;
  }

  /** クエリパラメータ（t / tab / tabAt）から接続認証を解決する。本家の
   * アップグレード時検証と同一。認証できなければ null。 */
  function verifyAuth(searchParams) {
    const auth = core.verifyToken(searchParams.get("t") || "", secret, Date.now());
    if (!auth) return null;
    const tabParam = searchParams.get("tab");
    const tabAtParam = Number(searchParams.get("tabAt"));
    auth.tab = typeof tabParam === "string" && tabParam.length > 0 ? tabParam.slice(0, 64) : undefined;
    auth.tabAt = Number.isFinite(tabAtParam) && tabAtParam > 0 ? tabAtParam : undefined;
    return auth;
  }

  /** 認証済みの接続をハブへ迎え入れる（本家の connection ハンドラと同一配線）。 */
  function handleConnection(ws, auth) {
    const info = {
      pid: auth.pid, name: auth.name, ok: auth.ok ?? null,
      space: null, joined: false, lastMsgAt: 0, alive: true,
      lastEntry: null, baseline: undefined, pendingHbs: [],
    };
    clients.set(ws, info);
    if (clients.size === 1) startTimers();
    // タブ世代（同一アカウントの分身防止）
    const admit = core.admitTab(room, auth.pid, auth.tab, auth.tabAt);
    if (admit.verdict === "reject") {
      clients.delete(ws);
      if (clients.size === 0) stopTimers();
      try {
        ws.close(4001, "tab_superseded");
      } catch { /* noop */ }
      return;
    }
    if (admit.evict) {
      for (const [otherWs, otherInfo] of clients) {
        if (otherWs !== ws && otherInfo.pid === auth.pid) {
          try {
            otherWs.close(4001, "tab_superseded");
          } catch { /* noop */ }
        }
      }
    }
    // 移動連続性の外部基準（B4）: 接続時に bot_kv から1回だけ読む
    if (kvCfg && info.ok) {
      loadExternalBaseline(info.ok).then((b) => {
        if (!clients.has(ws)) return;
        info.baseline = b;
        const queued = info.pendingHbs.splice(0);
        for (const q of queued) handleHeartbeat(ws, info, q.msg, q.now);
      });
    } else {
      info.baseline = null;
    }
    // プレゼンス集約の合図（Phase 2）
    if (aggState.on && info.ok) {
      try {
        ws.send(JSON.stringify({ t: "hello", now: Date.now(), agg: 1 }));
      } catch { /* noop */ }
    }
    ws.on("pong", () => {
      info.alive = true;
    });
    ws.on("message", (data) => {
      const now = Date.now();
      if (now - info.lastMsgAt < 40) return; // 1接続あたり 25 msg/秒まで
      info.lastMsgAt = now;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg && msg.t === "note") {
        // ピアノの音: ロビーにいる奏者の音だけを、同じロビーの全員へ中継する
        const notes = core.sanitizePianoNotes(msg.notes);
        if (notes && info.space === "lobby") {
          broadcast("lobby", ws, { t: "note", notes, id: info.pid });
        }
        return;
      }
      if (!msg || msg.t !== "hb") return;
      if (info.baseline === undefined) {
        info.pendingHbs.push({ msg, now });
        return;
      }
      handleHeartbeat(ws, info, msg, now);
    });
    const onGone = () => {
      if (!clients.delete(ws)) return;
      if (clients.size === 0) stopTimers();
      for (const otherInfo of clients.values()) {
        if (otherInfo.pid === info.pid) return;
      }
      if (info.lastEntry && info.ok) {
        writePresenceKv(info, { ...info.lastEntry, ts: Date.now() }, true);
      }
      core.forgetPresenceWrite(aggregator, info.pid);
      for (const space of core.removePlayer(room, info.pid)) {
        broadcast(space, ws, { t: "bye", id: info.pid });
      }
    };
    ws.on("close", onGone);
    ws.on("error", onGone);
  }

  return {
    verifyAuth,
    handleConnection,
    clientCount: () => clients.size,
  };
}

let sharedHub = null;
/** ルート用の共有ハブ（インスタンス内で1つ）。 */
function getHub() {
  if (!sharedHub) sharedHub = createHub();
  return sharedHub;
}

module.exports = { createHub, getHub };
