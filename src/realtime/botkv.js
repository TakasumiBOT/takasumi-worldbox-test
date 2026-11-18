"use strict";

function botKvConfig(env = process.env) {
  const base = String(env.BOT_API_BASE_URL || "").replace(/\/$/, "");
  const key = env.BOT_API_KEY || "";
  if (base && key) return { base, key };
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  return databaseUrl ? { databaseUrl } : null;
}

const dbPools = new Map();

function getDbPool(databaseUrl) {
  let pool = dbPools.get(databaseUrl);
  if (pool) return pool;
  let host = "";
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    const { Pool, neonConfig } = require("@neondatabase/serverless");
    if (typeof globalThis.WebSocket === "undefined") {
      try {
        neonConfig.webSocketConstructor = require("ws");
      } catch {
        /* noop */
      }
    }
    pool = new Pool({ connectionString: databaseUrl });
  } else {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: databaseUrl });
  }
  dbPools.set(databaseUrl, pool);
  return pool;
}

function parseJsonValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function kvQuery(cfg, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.base}/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`bot api returned ${res.status}`);
  const result = await res.json();
  return Array.isArray(result?.data) ? result.data : [];
}

async function kvList(cfg, namespace, fetchImpl = fetch) {
  if (cfg && typeof cfg.kvList === "function") return cfg.kvList(namespace);
  if (cfg && cfg.databaseUrl) {
    const pool = getDbPool(cfg.databaseUrl);
    const { rows } = await pool.query(
      'SELECT "key", "value"::text AS "value" FROM "public"."bot_kv" WHERE "namespace" = $1 LIMIT 10000',
      [namespace],
    );
    const map = new Map();
    for (const row of rows) map.set(String(row.key), parseJsonValue(row.value));
    return map;
  }
  const rows = await kvQuery(
    cfg,
    {
      table: "bot_kv",
      action: "select",
      columns: "key,value",
      filters: [{ column: "namespace", op: "eq", value: namespace }],
      limit: 10_000,
    },
    fetchImpl,
  );
  const map = new Map();
  for (const row of rows) map.set(String(row.key), row.value ?? null);
  return map;
}

async function kvGet(cfg, namespace, key, fetchImpl = fetch) {
  if (cfg && typeof cfg.kvGet === "function") return cfg.kvGet(namespace, key);
  if (cfg && cfg.databaseUrl) {
    const pool = getDbPool(cfg.databaseUrl);
    const { rows } = await pool.query(
      'SELECT "key", "value"::text AS "value" FROM "public"."bot_kv" WHERE "namespace" = $1 AND "key" = $2 LIMIT 1',
      [namespace, key],
    );
    if (rows.length === 0) return null;
    return parseJsonValue(rows[0].value);
  }
  const rows = await kvQuery(
    cfg,
    {
      table: "bot_kv",
      action: "select",
      columns: "key,value",
      filters: [
        { column: "namespace", op: "eq", value: namespace },
        { column: "key", op: "eq", value: key },
      ],
      limit: 1,
    },
    fetchImpl,
  );
  if (rows.length === 0) return null;
  return rows[0].value ?? null;
}

async function kvSet(cfg, namespace, key, value, fetchImpl = fetch) {
  if (cfg && typeof cfg.kvSet === "function") return cfg.kvSet(namespace, key, value);
  if (cfg && cfg.databaseUrl) {
    const pool = getDbPool(cfg.databaseUrl);
    const serialized = value === null || value === undefined ? null : JSON.stringify(value);
    await pool.query(
      'INSERT INTO "public"."bot_kv" ("namespace", "key", "value", "updated_at") VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT ("namespace", "key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = EXCLUDED."updated_at"',
      [namespace, key, serialized, new Date().toISOString()],
    );
    return;
  }
  await kvQuery(
    cfg,
    {
      table: "bot_kv",
      action: "upsert",
      values: { namespace, key, value, updated_at: new Date().toISOString() },
      on_conflict: "namespace,key",
    },
    fetchImpl,
  );
}

async function kvDelete(cfg, namespace, key, fetchImpl = fetch) {
  if (cfg && typeof cfg.kvDelete === "function") return cfg.kvDelete(namespace, key);
  if (cfg && cfg.databaseUrl) {
    const pool = getDbPool(cfg.databaseUrl);
    await pool.query('DELETE FROM "public"."bot_kv" WHERE "namespace" = $1 AND "key" = $2', [
      namespace,
      key,
    ]);
    return;
  }
  await kvQuery(
    cfg,
    {
      table: "bot_kv",
      action: "delete",
      filters: [
        { column: "namespace", op: "eq", value: namespace },
        { column: "key", op: "eq", value: key },
      ],
    },
    fetchImpl,
  );
}

module.exports = { botKvConfig, kvList, kvGet, kvSet, kvDelete };
