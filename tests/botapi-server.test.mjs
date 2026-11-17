// 独立環境の bot-api 互換サーバー（lib/botapi-server.ts）の検証:
// - 認証（fail-closed）と許可リスト（テーブル / 列 / 演算子 / RPC）
// - query の基本動作（upsert の往復、FILTER_REQUIRED、INVALID_VALUES）
// - 経済 RPC の意味論（pay_house の内訳、add_loss の 70/30、
//   transfer_coins の原子性と新規受取人の作成）
// DB は SQL を解釈するインメモリ fake で受ける（実 Postgres は使わない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "lib");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const dashUrl = dataUrl(transpile("dashboard-core.ts"));
const stubUrl = dataUrl("export {};");
const serverJs = transpile("botapi-server.ts")
  .replaceAll('from "./dashboard-core"', `from "${dashUrl}"`)
  .replaceAll('from "./db"', `from "${stubUrl}"`);
const api = await import(dataUrl(serverJs));

process.env.BOT_API_KEY = "test-key-123";
const AUTH = "Bearer test-key-123";

// ---------------------------------------------------------------- fake DB

const INT8_COLUMNS = {
  bot_kv: new Set(),
  users: new Set(["balance", "debt"]),
  transaction_history: new Set(["id", "amount"]),
  economy_pool_state: new Set([
    "pool",
    "treasury",
    "total_recycled",
    "total_paid",
    "total_released",
    "total_boosted",
    "lottery_boost_pending",
    "total_house_paid",
  ]),
};

const TABLE_DEFAULTS = {
  bot_kv: () => ({ updated_at: new Date() }),
  users: () => ({ balance: "0", debt: "0" }),
  transaction_history: () => ({ created_at: new Date() }),
  economy_pool_state: () => ({
    pool: "0",
    treasury: "0",
    total_recycled: "0",
    total_paid: "0",
    total_released: "0",
    total_boosted: "0",
    lottery_boost_pending: "0",
    total_house_paid: "0",
    last_release_date: null,
    updated_at: new Date(),
  }),
};

function makeFakeDb() {
  const state = {
    tables: { bot_kv: [], users: [], transaction_history: [], economy_pool_state: [] },
    historySeq: 0,
  };

  function resolveToken(token, params) {
    const clean = token.replace(/::\w+$/, "");
    if (clean.startsWith("$")) return params[Number(clean.slice(1)) - 1];
    if (/^-?\d+$/.test(clean)) return Number(clean);
    throw new Error(`fake db: bad token ${token}`);
  }

  function compareValues(table, column, rowValue, paramValue, op) {
    if (op === "LIKE" || op === "ILIKE") {
      const pattern = String(paramValue)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      const re = new RegExp(`^${pattern}$`, op === "ILIKE" ? "i" : "");
      return re.test(String(rowValue ?? ""));
    }
    let a = rowValue;
    let b = paramValue;
    const numeric =
      INT8_COLUMNS[table]?.has(column) || (/^-?\d+$/.test(String(a)) && /^-?\d+$/.test(String(b)));
    if (numeric) {
      a = BigInt(String(a ?? "0"));
      b = BigInt(String(b ?? "0"));
    } else {
      a = String(a ?? "");
      b = String(b ?? "");
    }
    switch (op) {
      case "=":
        return a === b;
      case "<>":
        return a !== b;
      case ">":
        return a > b;
      case ">=":
        return a >= b;
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      default:
        throw new Error(`fake db: unsupported op ${op}`);
    }
  }

  function evalWhere(whereSql, row, params, table) {
    for (const clause of whereSql.split(" AND ")) {
      if (clause === "FALSE") return false;
      let m = clause.match(/^"(\w+)" IS (NOT )?NULL$/);
      if (m) {
        const isNull = row[m[1]] === null || row[m[1]] === undefined;
        if (m[2] ? !isNull : isNull) return false;
        continue;
      }
      m = clause.match(/^"(\w+)" IS (TRUE|FALSE)$/);
      if (m) {
        if ((row[m[1]] === true) !== (m[2] === "TRUE")) return false;
        continue;
      }
      m = clause.match(/^"(\w+)" IN \((.+)\)$/);
      if (m) {
        const values = m[2].split(", ").map((t) => resolveToken(t, params));
        if (!values.some((v) => compareValues(table, m[1], row[m[1]], v, "="))) return false;
        continue;
      }
      m = clause.match(/^"(\w+)" (@>|=|<>|>=|<=|>|<|LIKE|ILIKE) (.+)$/);
      if (m) {
        if (m[2] === "@>") {
          const stored = JSON.parse(String(row[m[1]] ?? "null"));
          const needle = JSON.parse(String(resolveToken(m[3], params) ?? "null"));
          const contains = (s, n) => {
            if (typeof n !== "object" || n === null) return s === n;
            if (typeof s !== "object" || s === null) return false;
            return Object.entries(n).every(([k, v]) => contains(s[k], v));
          };
          if (!contains(stored, needle)) return false;
          continue;
        }
        if (!compareValues(table, m[1], row[m[1]], resolveToken(m[3], params), m[2])) return false;
        continue;
      }
      throw new Error(`fake db: unsupported clause ${clause}`);
    }
    return true;
  }

  function extractWhere(rest) {
    const m = rest.match(/ WHERE (.+?)(?= ORDER BY | LIMIT | RETURNING| FOR UPDATE|$)/);
    return m ? m[1] : null;
  }

  function execSelect(sql, params) {
    const m = sql.match(/^SELECT (.+) FROM (?:"public"\.)?"(\w+)"(.*)$/);
    const [, colList, table, rest] = m;
    let rows = [...state.tables[table]];
    const where = extractWhere(rest);
    if (where) rows = rows.filter((r) => evalWhere(where, r, params, table));
    const orderMatch = rest.match(/ ORDER BY (.+?)(?= LIMIT | FOR UPDATE|$)/);
    if (orderMatch) {
      const specs = orderMatch[1].split(", ").map((s) => {
        const sm = s.match(/^"(\w+)" (ASC|DESC)$/);
        return { column: sm[1], desc: sm[2] === "DESC" };
      });
      rows.sort((a, b) => {
        for (const spec of specs) {
          const c = compareValues(table, spec.column, a[spec.column], b[spec.column], "=")
            ? 0
            : compareValues(table, spec.column, a[spec.column], b[spec.column], "<")
              ? -1
              : 1;
          if (c !== 0) return spec.desc ? -c : c;
        }
        return 0;
      });
    }
    const limitMatch = rest.match(/ LIMIT \$(\d+) OFFSET \$(\d+)/);
    if (limitMatch) {
      const limit = params[Number(limitMatch[1]) - 1];
      const offset = params[Number(limitMatch[2]) - 1];
      rows = rows.slice(offset, offset + limit);
    }
    const cols = colList.split(", ").map((part) => part.match(/^"(\w+)"/)[1]);
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  }

  function execInsert(sql, params) {
    const m = sql.match(
      /^INSERT INTO (?:"public"\.)?"(\w+)" \(([^)]+)\) VALUES (.+?)(?= ON CONFLICT| RETURNING|$)/,
    );
    const [, table, colList, valuesSql] = m;
    const cols = colList.split(", ").map((s) => s.replace(/"/g, ""));
    const tuples = valuesSql.replace(/^\(/, "").replace(/\)$/, "").split("), (");
    const oc = sql.match(/ON CONFLICT \(([^)]+)\) DO (UPDATE SET (.+?)|NOTHING)(?= RETURNING|$)/);
    const conflictCols = oc ? oc[1].split(", ").map((s) => s.replace(/"/g, "")) : null;
    const out = [];
    for (const tuple of tuples) {
      const tokens = tuple.split(", ");
      const row = { ...TABLE_DEFAULTS[table]() };
      cols.forEach((col, i) => {
        row[col] = resolveToken(tokens[i], params);
      });
      if (table === "transaction_history" && row.id === undefined) {
        row.id = String(++state.historySeq);
      }
      if (conflictCols) {
        const existing = state.tables[table].find((r) =>
          conflictCols.every((c) => String(r[c]) === String(row[c])),
        );
        if (existing) {
          if (oc[2].startsWith("UPDATE")) {
            for (const assign of oc[3].split(", ")) {
              const am = assign.match(/^"(\w+)" = EXCLUDED\."(\w+)"$/);
              existing[am[1]] = row[am[2]];
            }
            out.push({ ...existing });
          }
          continue;
        }
      }
      state.tables[table].push(row);
      out.push({ ...row });
    }
    return sql.includes(" RETURNING ") ? out : [];
  }

  function execUpdate(sql, params) {
    const m = sql.match(/^UPDATE (?:"public"\.)?"(\w+)" SET (.+?)(?= WHERE | RETURNING|$)(.*)$/);
    const [, table, setSql, rest] = m;
    const assignments = setSql.split(", ").map((part) => {
      const am = part.match(/^"(\w+)" = (.+)$/);
      return { column: am[1], value: am[2] === "now()" ? new Date() : resolveToken(am[2], params) };
    });
    const where = extractWhere(rest);
    const out = [];
    for (const row of state.tables[table]) {
      if (where && !evalWhere(where, row, params, table)) continue;
      for (const a of assignments) row[a.column] = a.value;
      out.push({ ...row });
    }
    return sql.includes(" RETURNING ") ? out : [];
  }

  function execDelete(sql, params) {
    const m = sql.match(/^DELETE FROM (?:"public"\.)?"(\w+)"(.*)$/);
    const [, table, rest] = m;
    const where = extractWhere(rest);
    const kept = [];
    const removed = [];
    for (const row of state.tables[table]) {
      if (!where || evalWhere(where, row, params, table)) removed.push({ ...row });
      else kept.push(row);
    }
    state.tables[table] = kept;
    return removed;
  }

  async function query(text, params = []) {
    const sql = text.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT")) return execSelect(sql, params);
    if (sql.startsWith("INSERT")) return execInsert(sql, params);
    if (sql.startsWith("UPDATE")) return execUpdate(sql, params);
    if (sql.startsWith("DELETE")) return execDelete(sql, params);
    throw new Error(`fake db: unsupported SQL: ${sql}`);
  }

  const executor = {
    query,
    async transaction(fn) {
      const backupTables = Object.fromEntries(
        Object.entries(state.tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
      );
      const backupSeq = state.historySeq;
      try {
        return await fn(executor);
      } catch (error) {
        state.tables = backupTables;
        state.historySeq = backupSeq;
        throw error;
      }
    },
  };

  return {
    executor,
    state,
    seedUser(userId, balance) {
      state.tables.users.push({ user_id: userId, balance: String(balance), debt: "0" });
    },
    seedPool(pool, treasury) {
      state.tables.economy_pool_state.push({
        id: 1,
        ...TABLE_DEFAULTS.economy_pool_state(),
        pool: String(pool),
        treasury: String(treasury),
      });
    },
    poolRow() {
      return state.tables.economy_pool_state.find((r) => r.id === 1);
    },
    userRow(userId) {
      return state.tables.users.find((r) => r.user_id === userId);
    },
  };
}

async function call(db, kind, body, auth = AUTH) {
  const res = await api.processBotApiRequest(
    kind,
    typeof body === "string" ? body : JSON.stringify(body),
    auth,
    db.executor,
  );
  return { status: res.status, raw: res.body, json: JSON.parse(res.body) };
}

// ------------------------------------------------------------------ 認証

test("botapi: 認証は fail-closed（未提示・不一致・鍵未設定は 401）", async () => {
  const db = makeFakeDb();
  const body = { table: "bot_kv", action: "select" };
  assert.equal((await call(db, "query", body, null)).status, 401);
  assert.equal((await call(db, "query", body, "Bearer wrong-key")).status, 401);
  assert.equal((await call(db, "query", body, "test-key-123")).status, 401);
  const denied = await call(db, "query", body, null);
  assert.equal(denied.json.detail.code, "UNAUTHORIZED");
  const saved = process.env.BOT_API_KEY;
  delete process.env.BOT_API_KEY;
  try {
    assert.equal((await call(db, "query", body, AUTH)).status, 401);
  } finally {
    process.env.BOT_API_KEY = saved;
  }
  assert.equal((await call(db, "query", body)).status, 200);
});

test("botapi: 壊れた JSON と未知フィールドは 422", async () => {
  const db = makeFakeDb();
  assert.equal((await call(db, "query", "{not json")).status, 422);
  const res = await call(db, "query", { table: "bot_kv", action: "select", bogus: 1 });
  assert.equal(res.status, 422);
});

// ------------------------------------------------------------- 許可リスト

test("botapi: 許可外テーブルは 404 TABLE_NOT_ALLOWED", async () => {
  const db = makeFakeDb();
  for (const table of ["bump_rta_settings", "secrets", "pg_catalog"]) {
    const res = await call(db, "query", { table, action: "select" });
    assert.equal(res.status, 404, table);
    assert.equal(res.json.detail.code, "TABLE_NOT_ALLOWED");
  }
});

test("botapi: 未知の列は 400 INVALID_COLUMN（select / filter / values）", async () => {
  const db = makeFakeDb();
  let res = await call(db, "query", { table: "bot_kv", action: "select", columns: ["nope"] });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_COLUMN");
  res = await call(db, "query", {
    table: "bot_kv",
    action: "select",
    filters: [{ column: "nope", op: "eq", value: 1 }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_COLUMN");
  res = await call(db, "query", {
    table: "users",
    action: "insert",
    values: { user_id: "1", password: "x" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_COLUMN");
});

test("botapi: 未知のフィルタ演算子は 400 INVALID_OPERATOR", async () => {
  const db = makeFakeDb();
  const res = await call(db, "query", {
    table: "bot_kv",
    action: "select",
    filters: [{ column: "key", op: "regex", value: "x" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_OPERATOR");
});

test("botapi: update/delete はフィルタ必須、insert の形違いは INVALID_VALUES", async () => {
  const db = makeFakeDb();
  let res = await call(db, "query", { table: "bot_kv", action: "update", values: { value: {} } });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "FILTER_REQUIRED");
  res = await call(db, "query", { table: "bot_kv", action: "delete" });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "FILTER_REQUIRED");
  res = await call(db, "query", { table: "bot_kv", action: "insert", values: {} });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_VALUES");
  res = await call(db, "query", {
    table: "bot_kv",
    action: "insert",
    values: [{ namespace: "a", key: "k" }, { namespace: "b" }],
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_VALUES");
});

// ------------------------------------------------------------------ query

test("botapi: bot_kv の upsert → select が往復する", async () => {
  const db = makeFakeDb();
  const upsert = (value) =>
    call(db, "query", {
      table: "bot_kv",
      action: "upsert",
      on_conflict: "namespace,key",
      values: {
        namespace: "worldbox_profile",
        key: "discord:1",
        value,
        updated_at: "2026-11-17T00:00:00.000Z",
      },
    });
  assert.equal((await upsert({ coins: 5 })).status, 200);
  assert.equal((await upsert({ coins: 9 })).status, 200);
  const res = await call(db, "query", {
    table: "bot_kv",
    action: "select",
    filters: [
      { column: "namespace", op: "eq", value: "worldbox_profile" },
      { column: "key", op: "eq", value: "discord:1" },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.deepEqual(res.json.data[0].value, { coins: 9 });
  // update（フィルタ付き）と delete も通る
  const upd = await call(db, "query", {
    table: "bot_kv",
    action: "update",
    values: { value: { coins: 12 } },
    filters: [{ column: "key", op: "eq", value: "discord:1" }],
  });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.json.data[0].value, { coins: 12 });
  const del = await call(db, "query", {
    table: "bot_kv",
    action: "delete",
    filters: [{ column: "key", op: "eq", value: "discord:1" }],
  });
  assert.equal(del.status, 200);
  assert.equal(del.json.data.length, 1);
  assert.equal(db.state.tables.bot_kv.length, 0);
});

test("botapi: 大きな整数は生リテラルで往復する（番兵規約）", async () => {
  const db = makeFakeDb();
  db.seedUser("111", "9007199254740993"); // 2^53 + 1
  const res = await call(db, "query", {
    table: "users",
    action: "select",
    columns: ["user_id", "balance"],
    filters: [{ column: "user_id", op: "eq", value: "111" }],
  });
  assert.equal(res.status, 200);
  assert.ok(res.raw.includes('"balance":9007199254740993'), res.raw);
  // kv の値に埋め込まれた大きな整数もそのまま戻る
  const body =
    '{"table":"bot_kv","action":"upsert","on_conflict":"namespace,key",' +
    '"values":{"namespace":"n","key":"k","value":{"balance":9007199254740993},' +
    '"updated_at":"2026-11-17T00:00:00.000Z"}}';
  assert.equal((await call(db, "query", body)).status, 200);
  const got = await call(db, "query", {
    table: "bot_kv",
    action: "select",
    filters: [{ column: "key", op: "eq", value: "k" }],
  });
  assert.ok(got.raw.includes('"balance":9007199254740993'), got.raw);
});

// -------------------------------------------------------------------- RPC

test("botapi: 許可外 RPC は 404、引数の過不足は 400", async () => {
  const db = makeFakeDb();
  let res = await call(db, "rpc", { name: "economy_pool_steal", params: { p_amount: 1 } });
  assert.equal(res.status, 404);
  assert.equal(res.json.detail.code, "RPC_NOT_ALLOWED");
  res = await call(db, "rpc", { name: "transfer_coins", params: {} });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_RPC_PARAMS");
  res = await call(db, "rpc", {
    name: "transfer_coins",
    params: { p_sender_id: "1", p_receiver_id: "2", p_amount: 1, p_evil: 1 },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.detail.code, "INVALID_RPC_PARAMS");
});

test("botapi: pay_house はプール→国庫の順に払い内訳を返す", async () => {
  const db = makeFakeDb();
  db.seedPool(1000, 500);
  const pay = (amount) =>
    call(db, "rpc", { name: "economy_pool_pay_house", params: { p_amount: amount } });
  let res = await pay(300);
  assert.deepEqual(res.json.data, [{ paid: 300, pool_part: 300, treasury_part: 0 }]);
  assert.equal(db.poolRow().pool, "700");
  res = await pay(900);
  assert.deepEqual(res.json.data, [{ paid: 900, pool_part: 700, treasury_part: 200 }]);
  assert.equal(db.poolRow().pool, "0");
  assert.equal(db.poolRow().treasury, "300");
  assert.equal(db.poolRow().total_house_paid, "1200");
  // 残高不足なら払える分だけ
  res = await pay(1000);
  assert.deepEqual(res.json.data, [{ paid: 300, pool_part: 0, treasury_part: 300 }]);
  assert.equal(db.poolRow().total_house_paid, "1500");
});

test("botapi: refund_house は内訳どおりに戻し total_house_paid を返す", async () => {
  const db = makeFakeDb();
  db.seedPool(0, 0);
  await call(db, "rpc", { name: "economy_pool_add_loss", params: { p_amount: 1000 } });
  await call(db, "rpc", { name: "economy_pool_pay_house", params: { p_amount: 400 } });
  // pool 700→300, treasury 300, total_house_paid 400
  const res = await call(db, "rpc", {
    name: "economy_pool_refund_house",
    params: { p_pool_part: 100, p_treasury_part: 50 },
  });
  assert.equal(res.json.data, 250);
  assert.equal(db.poolRow().pool, "400");
  assert.equal(db.poolRow().treasury, "350");
  // 払い戻しが total_house_paid を超えても 0 で止まる
  const res2 = await call(db, "rpc", {
    name: "economy_pool_refund_house",
    params: { p_pool_part: 9999, p_treasury_part: 0 },
  });
  assert.equal(res2.json.data, 0);
});

test("botapi: add_loss は 70% プール / 残り国庫（端数は国庫）", async () => {
  const db = makeFakeDb();
  db.seedPool(0, 0);
  let res = await call(db, "rpc", { name: "economy_pool_add_loss", params: { p_amount: 105 } });
  assert.deepEqual(res.json.data, [{ pool_part: 73, treasury_part: 32 }]);
  assert.equal(db.poolRow().pool, "73");
  assert.equal(db.poolRow().treasury, "32");
  assert.equal(db.poolRow().total_recycled, "105");
  res = await call(db, "rpc", { name: "economy_pool_add_loss", params: { p_amount: 0 } });
  assert.deepEqual(res.json.data, [{ pool_part: 0, treasury_part: 0 }]);
  assert.equal(db.poolRow().total_recycled, "105");
});

test("botapi: transfer_coins は原子的で、未登録の受取人を新規残高で作る", async () => {
  const db = makeFakeDb();
  db.seedUser("111", 1000);
  const transfer = (params) => call(db, "rpc", { name: "transfer_coins", params });
  // 受取人がいない → p_new_user_balance + amount で作られる
  let res = await transfer({
    p_sender_id: "111",
    p_receiver_id: "222",
    p_amount: 400,
    p_new_user_balance: 10000,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data, 600);
  assert.equal(db.userRow("111").balance, "600");
  assert.equal(db.userRow("222").balance, "10400");
  assert.equal(db.userRow("222").debt, "0");
  // 履歴が1行残る
  assert.equal(db.state.tables.transaction_history.length, 1);
  const history = db.state.tables.transaction_history[0];
  assert.equal(history.sender_id, "111");
  assert.equal(history.receiver_id, "222");
  assert.equal(history.amount, "400");
  assert.equal(history.reason, "送金");
  // 既存の受取人へは加算
  res = await transfer({
    p_sender_id: "111",
    p_receiver_id: "222",
    p_amount: 100,
    p_new_user_balance: 10000,
  });
  assert.equal(res.json.data, 500);
  assert.equal(db.userRow("222").balance, "10500");
});

test("botapi: transfer_coins の失敗は P0001 で、残高も履歴も変わらない", async () => {
  const db = makeFakeDb();
  db.seedUser("111", 100);
  db.seedUser("222", 50);
  const transfer = (params) => call(db, "rpc", { name: "transfer_coins", params });
  const cases = [
    { p_sender_id: "111", p_receiver_id: "222", p_amount: 101 }, // 残高不足
    { p_sender_id: "999", p_receiver_id: "222", p_amount: 1 }, // 送り手なし
    { p_sender_id: "111", p_receiver_id: "222", p_amount: 0 }, // 金額 0
    { p_sender_id: "111", p_receiver_id: "222", p_amount: -5 }, // 金額負
    { p_sender_id: "111", p_receiver_id: "111", p_amount: 1 }, // 自分宛
  ];
  for (const params of cases) {
    const res = await transfer(params);
    assert.equal(res.status, 400, JSON.stringify(params));
    assert.equal(res.json.detail.code, "P0001");
  }
  assert.equal(db.userRow("111").balance, "100");
  assert.equal(db.userRow("222").balance, "50");
  assert.equal(db.state.tables.transaction_history.length, 0);
});
