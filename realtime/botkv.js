"use strict";

function botKvConfig(env = process.env) {
  const base = String(env.BOT_API_BASE_URL || "").replace(/\/$/, "");
  const key = env.BOT_API_KEY || "";
  return base && key ? { base, key } : null;
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
