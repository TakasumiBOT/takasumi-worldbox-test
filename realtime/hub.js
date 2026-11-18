"use strict";
const fs = require("node:fs");
const path = require("node:path");
const core = require("./relay-core.js");
const botkv = require("./botkv.js");
const watchCore = require("./watch-core.js");

function readDeploySecret(baseDir) {
  try {
    const src = fs.readFileSync(path.join(baseDir, "lib", "deploy-config.ts"), "utf8");
    const match = src.match(/discordClientSecret:\s*"([^"]*)"/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function parsePresenceBaseline(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.x !== "number" || typeof v.y !== "number" || typeof v.ts !== "number")
      return null;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.ts)) return null;
    return { x: v.x, y: v.y, space: typeof v.space === "string" ? v.space : "world", ts: v.ts };
  } catch {
    return null;
  }
}

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
      : process.env.DISCORD_SESSION_SECRET ||
        process.env.DISCORD_CLIENT_SECRET ||
        readDeploySecret(path.join(__dirname, ".."));
  const kvCfg = options.kvCfg !== undefined ? options.kvCfg : botkv.botKvConfig();

  const room = core.createRoom();
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
      } catch {
        /* noop */
      }
    }
  }

  function sendTo(predicate, obj) {
    const text = JSON.stringify(obj);
    for (const [ws, info] of clients) {
      if (ws.readyState !== 1 || !predicate(info)) continue;
      try {
        ws.send(text);
      } catch {
        /* noop */
      }
    }
  }

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
      } catch {
        /* noop */
      }
    }
  };

  const writePresenceKv = (info, entry, force) => {
    if (!kvCfg || !info.ok) return;
    if (!core.planPresenceWrite(aggregator, info.pid, entry, Date.now(), force)) return;
    botkv
      .kvSet(kvCfg, "worldbox_presence", info.ok, core.presenceKvValue(entry))
      .then(
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
      )
      .catch(() => {
        /* noop */
      });
  };

  const handleHeartbeat = (ws, info, msg, now) => {
    const entry = core.acceptHeartbeat(
      room,
      info.pid,
      info.name,
      msg,
      now,
      info.baseline,
      info.avatar,
    );
    if (!entry) return;
    if (entry.rejected) {
      try {
        ws.send(JSON.stringify({ t: "jump", x: entry.x, y: entry.y, space: entry.space }));
      } catch {
        /* noop */
      }
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
        ws.send(
          JSON.stringify({
            t: "snap",
            now,
            players: core.snapshot(room, entry.space, info.pid, now),
          }),
        );
      } catch {
        /* noop */
      }
    }
    broadcast(entry.space, ws, { t: "up", now, p: entry });
  };

  const routeWatchChanges = (kind, changes, prev) => {
    if (changes.length === 0) return;
    if (kind === "tiles" || kind === "objects" || kind === "fishing") {
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
        sendTo((info) => info.space === scope.space, {
          t: "sync",
          kind: "chat",
          channel: scope.channel,
          space: scope.space,
        });
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
          (info) =>
            !!info.space &&
            (spaces.has(info.space) || [...prefixes].some((p) => info.space.startsWith(p))),
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
    t.liveness = setInterval(() => {
      for (const [ws, info] of clients) {
        if (!info.alive) {
          try {
            if (typeof ws.terminate === "function") ws.terminate();
            else ws.close();
          } catch {
            /* noop */
          }
          continue;
        }
        info.alive = false;
        try {
          if (typeof ws.ping === "function") ws.ping();
        } catch {
          /* noop */
        }
      }
    }, 30_000);
    t.prune = setInterval(() => {
      const now = Date.now();
      for (const gone of core.pruneRoom(room, now)) {
        broadcast(gone.space, null, { t: "bye", id: gone.id });
      }
    }, 5_000);
    t.tick = setInterval(() => {
      const text = JSON.stringify({ t: "tick", now: Date.now() });
      for (const [ws] of clients) {
        if (ws.readyState !== 1) continue;
        try {
          ws.send(text);
        } catch {
          /* noop */
        }
      }
    }, 15_000);
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
        w.timeout = setTimeout(
          () => {
            void run();
            w.interval = setInterval(() => void run(), plan.intervalMs);
          },
          500 + idx * 300,
        );
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

  function verifyAuth(searchParams) {
    const auth = core.verifyToken(searchParams.get("t") || "", secret, Date.now());
    if (!auth) return null;
    const tabParam = searchParams.get("tab");
    const tabAtParam = Number(searchParams.get("tabAt"));
    auth.tab =
      typeof tabParam === "string" && tabParam.length > 0 ? tabParam.slice(0, 64) : undefined;
    auth.tabAt = Number.isFinite(tabAtParam) && tabAtParam > 0 ? tabAtParam : undefined;
    return auth;
  }

  function handleConnection(ws, auth) {
    const info = {
      pid: auth.pid,
      name: auth.name,
      ok: auth.ok ?? null,
      avatar: auth.av ?? null,
      space: null,
      joined: false,
      lastMsgAt: 0,
      alive: true,
      lastEntry: null,
      baseline: undefined,
      pendingHbs: [],
    };
    clients.set(ws, info);
    if (clients.size === 1) startTimers();
    const admit = core.admitTab(room, auth.pid, auth.tab, auth.tabAt);
    if (admit.verdict === "reject") {
      clients.delete(ws);
      if (clients.size === 0) stopTimers();
      try {
        ws.close(4001, "tab_superseded");
      } catch {
        /* noop */
      }
      return;
    }
    if (admit.evict) {
      for (const [otherWs, otherInfo] of clients) {
        if (otherWs !== ws && otherInfo.pid === auth.pid) {
          try {
            otherWs.close(4001, "tab_superseded");
          } catch {
            /* noop */
          }
        }
      }
    }
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
    if (aggState.on && info.ok) {
      try {
        ws.send(JSON.stringify({ t: "hello", now: Date.now(), agg: 1 }));
      } catch {
        /* noop */
      }
    }
    ws.on("pong", () => {
      info.alive = true;
    });
    ws.on("message", (data) => {
      const now = Date.now();
      if (now - info.lastMsgAt < 40) return;
      info.lastMsgAt = now;
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg && msg.t === "note") {
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
function getHub(options) {
  if (!sharedHub) sharedHub = createHub(options);
  return sharedHub;
}

module.exports = { createHub, getHub };
