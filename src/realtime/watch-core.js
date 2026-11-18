"use strict";

const WATCH_PLAN = [
  { namespace: "worldbox_chat", kind: "chat", intervalMs: 2_000 },
  { namespace: "worldbox_union_board", kind: "unionChat", intervalMs: 2_000 },
  { namespace: "worldbox_party", kind: "party", intervalMs: 2_000 },
  { namespace: "worldbox_requests", kind: "requests", intervalMs: 2_000 },
  { namespace: "worldbox_tiles", kind: "tiles", intervalMs: 2_000 },
  { namespace: "worldbox_board", kind: "board", intervalMs: 5_000 },
  { namespace: "worldbox_nations", kind: "nations", intervalMs: 5_000 },
  { namespace: "worldbox_instances", kind: "instances", intervalMs: 2_000 },
  { namespace: "worldbox_economy", kind: "economy", intervalMs: 2_000 },
  { namespace: "worldbox_objects", kind: "objects", intervalMs: 2_000 },
  { namespace: "worldbox_fishing", kind: "fishing", intervalMs: 2_000 },
  { namespace: "worldbox_guild_shop", kind: "guildShop", intervalMs: 5_000 },
];

function normalizeValue(value) {
  if (typeof value === "string") return `s:${value}`;
  return `j:${JSON.stringify(value) ?? "null"}`;
}

function diffKv(prev, next) {
  if (!prev) return [];
  const changes = [];
  for (const [key, value] of next) {
    if (!prev.has(key) || normalizeValue(prev.get(key)) !== normalizeValue(value)) {
      changes.push({ key, value });
    }
  }
  for (const key of prev.keys()) {
    if (!next.has(key)) changes.push({ key, value: null });
  }
  return changes;
}

function presenceIdFor(ownerKey) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ownerKey.length; i++) {
    h ^= ownerKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function parseJsonLoose(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function partyTargetPids(key, value) {
  const pids = new Set();
  if (key.startsWith("member:") || key.startsWith("invite:")) {
    pids.add(presenceIdFor(key.slice(key.indexOf(":") + 1)));
    return pids;
  }
  const party = parseJsonLoose(value);
  if (!party || typeof party !== "object") return pids;
  const keys = new Set();
  if (typeof party.leaderKey === "string") keys.add(party.leaderKey);
  for (const m of Array.isArray(party.members) ? party.members : []) {
    if (m && typeof m.ownerKey === "string") keys.add(m.ownerKey);
  }
  for (const inv of Array.isArray(party.invites) ? party.invites : []) {
    if (inv && typeof inv.toKey === "string") keys.add(inv.toKey);
  }
  for (const k of keys) pids.add(presenceIdFor(k));
  return pids;
}

function chatKeyScope(key) {
  const m = /^(proximity|global):(.+)$/.exec(key);
  if (!m) return null;
  return { channel: m[1], space: m[2] };
}

function unionBoardGuildId(key) {
  const m = /^union:(.+)$/.exec(key);
  return m ? m[1] : null;
}

function economyTargetPids(prevValue, nextValue) {
  const pids = new Set();
  const next = parseJsonLoose(nextValue);
  if (!next || typeof next !== "object") return pids;
  if (next.status !== "done" && next.status !== "failed") return pids;
  const prev = parseJsonLoose(prevValue);
  if (prev && typeof prev === "object" && prev.status === next.status) return pids;
  const ownerKeys = new Set();
  if (typeof next.userKey === "string") ownerKeys.add(next.userKey);
  if (typeof next.discordId === "string") ownerKeys.add(`discord:${next.discordId}`);
  if (typeof next.toDiscordId === "string") ownerKeys.add(`discord:${next.toDiscordId}`);
  if (typeof next.fromDiscordId === "string") ownerKeys.add(`discord:${next.fromDiscordId}`);
  for (const k of ownerKeys) pids.add(presenceIdFor(k));
  return pids;
}

function instanceKeyScope(key) {
  if (typeof key !== "string" || key.startsWith("dungeonclear:")) return null;
  const hash = key.indexOf("#");
  const head = hash >= 0 ? key.slice(0, hash) : key;
  const tail = hash >= 0 ? key.slice(hash + 1) : "";
  const dm = /^dungeon:(-?\d+),(-?\d+):\d+$/.exec(head);
  if (dm) return { spacePrefix: `dungeon:${dm[1]},${dm[2]}:` };
  if (tail) return { pid: presenceIdFor(tail) };
  if (/^(cave|ruins):-?\d+,-?\d+:\d+$/.test(head)) return { space: head };
  return null;
}

module.exports = {
  WATCH_PLAN,
  normalizeValue,
  diffKv,
  presenceIdFor,
  partyTargetPids,
  chatKeyScope,
  unionBoardGuildId,
  economyTargetPids,
  instanceKeyScope,
};
