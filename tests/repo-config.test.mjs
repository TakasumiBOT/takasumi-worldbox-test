import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const rootDir = path.join(import.meta.dirname, "..");
const libDir = path.join(rootDir, "src/lib");

function transpile(name, base = libDir) {
  const src = fs.readFileSync(path.join(base, name), "utf8");
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function dataUrl(js) {
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const ENV_KEYS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_SESSION_SECRET",
  "BOT_API_BASE_URL",
  "BOT_API_KEY",
  "DATABASE_URL",
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

const subdomainUrl = dataUrl(transpile("subdomain.ts"));
const headersStubUrl = dataUrl(
  "export async function cookies() { throw new Error('tests do not use cookies()'); }",
);
const deployConfigFilledUrl = dataUrl(`
export const DEPLOY_CONFIG = {
  discordClientId: "111222333",
  discordClientSecret: "deploy-secret",
  discordRedirectUri: "https://example.test/api/auth/discord/callback",
};
`);
const deployConfigRealUrl = dataUrl(transpile("deploy-config.ts"));

function buildAuth(deployConfigUrl) {
  return dataUrl(
    transpile("auth.ts")
      .replaceAll('"./subdomain"', JSON.stringify(subdomainUrl))
      .replaceAll('"./deploy-config"', JSON.stringify(deployConfigUrl))
      .replaceAll('"next/headers"', JSON.stringify(headersStubUrl)),
  );
}
const authFilled = await import(buildAuth(deployConfigFilledUrl));
const authReal = await import(buildAuth(deployConfigRealUrl));
const deployConfigReal = await import(deployConfigRealUrl);

const fakeRequest = { url: "https://internal.test/somewhere", headers: new Headers() };

test("deploy-config: 値が入っていれば env 無しで Discord 設定済みになる", () => {
  clearEnv();
  try {
    assert.equal(authFilled.isDiscordConfigured(), true);
    assert.equal(authFilled.discordClientId(), "111222333");
    assert.equal(authFilled.discordClientSecret(), "deploy-secret");
    assert.equal(authFilled.discordRedirectUri(), "https://example.test/api/auth/discord/callback");
    assert.equal(authFilled.publicOrigin(fakeRequest), "https://example.test");
  } finally {
    restoreEnv();
  }
});

test("deploy-config: env があれば deploy-config より優先される", () => {
  clearEnv();
  try {
    process.env.DISCORD_CLIENT_ID = "999888777";
    process.env.DISCORD_CLIENT_SECRET = "env-secret";
    process.env.DISCORD_REDIRECT_URI = "https://env.test/api/auth/discord/callback";
    assert.equal(authFilled.isDiscordConfigured(), true);
    assert.equal(authFilled.discordClientId(), "999888777");
    assert.equal(authFilled.discordClientSecret(), "env-secret");
    assert.equal(authFilled.publicOrigin(fakeRequest), "https://env.test");
  } finally {
    restoreEnv();
  }
});

test("deploy-config: 実ファイルの値がそのまま読め、設定判定は実ファイルの中身と一致する", () => {
  clearEnv();
  try {
    const cfg = deployConfigReal.DEPLOY_CONFIG;
    assert.equal(authReal.discordClientId(), cfg.discordClientId);
    assert.equal(authReal.discordClientSecret(), cfg.discordClientSecret);
    assert.equal(authReal.discordRedirectUri(), cfg.discordRedirectUri);
    assert.equal(
      authReal.isDiscordConfigured(),
      Boolean(cfg.discordClientId && cfg.discordClientSecret && cfg.discordRedirectUri),
    );
  } finally {
    restoreEnv();
  }
});

test("deploy-config: セッション秘密は deploy-config の secret でも署名でき、env が優先される", () => {
  clearEnv();
  try {
    const user = { id: "123456789", username: "tester", provider: "discord" };
    const token = authFilled.createSession(user);
    assert.equal(authFilled.readSession(token)?.id, "123456789");
    process.env.DISCORD_SESSION_SECRET = "env-session-secret";
    assert.equal(authFilled.readSession(token), null);
    const envToken = authFilled.createSession(user);
    assert.equal(authFilled.readSession(envToken)?.id, "123456789");
  } finally {
    restoreEnv();
  }
});

function makeFakeExecutor() {
  const kv = new Map();
  const pool = { pool: "0", treasury: "0", total_recycled: "0", total_house_paid: "0" };
  const executor = {
    async query(sql, params = []) {
      if (sql.startsWith("SELECT") && sql.includes('"bot_kv"')) {
        const [namespace, key] = params;
        const raw = kv.get(`${namespace}\0${key}`);
        return raw === undefined ? [] : [{ key, value: raw }];
      }
      if (sql.startsWith('INSERT INTO "public"."bot_kv"')) {
        const [namespace, key, raw] = params;
        kv.set(`${namespace}\0${key}`, raw);
        return [{ namespace, key, value: raw, updated_at: new Date() }];
      }
      if (sql.startsWith('INSERT INTO "economy_pool_state"')) return [];
      if (sql.startsWith("SELECT") && sql.includes('"economy_pool_state"')) {
        return [{ ...pool }];
      }
      if (sql.startsWith('UPDATE "economy_pool_state"')) {
        [pool.pool, pool.treasury, pool.total_recycled, pool.total_house_paid] = params;
        return [];
      }
      throw new Error(`fake executor: unexpected SQL: ${sql.slice(0, 80)}`);
    },
    async transaction(fn) {
      return fn(executor);
    },
  };
  return executor;
}
const fakeExecutor = makeFakeExecutor();
const dbStubUrl = dataUrl(`
export function getSqlExecutor() { return globalThis.__repoConfigFakeExecutor; }
export function getDbPool() { throw new Error("not used in tests"); }
export function createSqlExecutor() { throw new Error("not used in tests"); }
`);
globalThis.__repoConfigFakeExecutor = fakeExecutor;

const dashUrl = dataUrl(transpile("dashboard-core.ts"));
const botapiServerUrl = dataUrl(
  transpile("botapi-server.ts")
    .replaceAll('from "./dashboard-core"', `from "${dashUrl}"`)
    .replaceAll('from "./db"', `from "${dataUrl("export {};")}"`),
);
const botApiUrl = dataUrl(
  transpile("bot-api.ts")
    .replaceAll('from "./dashboard-core"', `from "${dashUrl}"`)
    .replaceAll('from "./botapi-server"', `from "${botapiServerUrl}"`)
    .replaceAll('from "./db"', `from "${dbStubUrl}"`),
);
const botApi = await import(botApiUrl);
const botapiServer = await import(botapiServerUrl);

test("bot-api: BOT_API_* 未設定 + DATABASE_URL でプロセス内経路が通り、HTTP は使わない", async () => {
  clearEnv();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be used in-process");
  };
  try {
    process.env.DATABASE_URL = "postgres://fake";
    assert.equal(botApi.isBotApiConfigured(), true);
    await botApi.kvSet("worldbox_test_ns", "greeting", { hello: "world", n: 42 });
    assert.deepEqual(await botApi.kvGet("worldbox_test_ns", "greeting"), {
      hello: "world",
      n: 42,
    });
    assert.equal(await botApi.kvGet("worldbox_test_ns", "missing"), null);
    const rows = await botApi.rpc("economy_pool_add_loss", { p_amount: 1000 });
    assert.equal(rows[0].pool_part, 700);
    assert.equal(rows[0].treasury_part, 300);
    const big = await botApi.rpc("economy_pool_add_loss", {
      p_amount: "#int:9999999999999999999",
    });
    assert.equal(big[0].pool_part, "#int:6999999999999999999");
    assert.equal(big[0].treasury_part, "#int:3000000000000000000");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("bot-api: BOT_API_* があれば従来どおり HTTP 経路を使う", async () => {
  clearEnv();
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization });
    return new Response(JSON.stringify({ data: [{ key: "k", value: { via: "http" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    process.env.BOT_API_BASE_URL = "http://bot.local/botapi/";
    process.env.BOT_API_KEY = "http-key";
    process.env.DATABASE_URL = "postgres://fake";
    assert.equal(botApi.isBotApiConfigured(), true);
    assert.deepEqual(await botApi.kvGet("ns", "k"), { via: "http" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "http://bot.local/botapi/v1/query");
    assert.equal(seen[0].auth, "Bearer http-key");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test("bot-api: どちらの経路も無ければ未設定として弾く", async () => {
  clearEnv();
  try {
    assert.equal(botApi.isBotApiConfigured(), false);
    await assert.rejects(() => botApi.kvGet("ns", "k"), /database API environment is missing/);
  } finally {
    restoreEnv();
  }
});

test("bot-api: 公開ルートは BOT_API_KEY 未設定なら正しい形式でも 401（fail-closed）", async () => {
  clearEnv();
  try {
    const body = JSON.stringify({
      table: "bot_kv",
      action: "select",
      columns: "key,value",
      filters: [{ column: "namespace", op: "eq", value: "ns" }],
      limit: 1,
    });
    const noKey = await botapiServer.processBotApiRequest("query", body, null, fakeExecutor);
    assert.equal(noKey.status, 401);
    const someKey = await botapiServer.processBotApiRequest(
      "query",
      body,
      "Bearer anything",
      fakeExecutor,
    );
    assert.equal(someKey.status, 401);
    process.env.BOT_API_KEY = "route-key";
    const ok = await botapiServer.processBotApiRequest(
      "query",
      body,
      "Bearer route-key",
      fakeExecutor,
    );
    assert.equal(ok.status, 200);
  } finally {
    restoreEnv();
  }
});

const lazyKv = new Map();
const lazyCounts = { sweep: 0, company: 0, stock: 0 };
const lazyWaitUntilPromises = [];
const lazyBotApiStubUrl = dataUrl(`
const store = globalThis.__lazyKvStore;
export function isBotApiConfigured() { return true; }
export async function kvGet(ns, key) { return store.get(ns + "\\0" + key) ?? null; }
export async function kvSet(ns, key, value) { store.set(ns + "\\0" + key, value); }
`);
globalThis.__lazyKvStore = lazyKv;
const lazyJobsUrl = dataUrl(
  transpile("worldbox/core/lazy-jobs.ts")
    .replaceAll(
      'from "@vercel/functions"',
      `from "${dataUrl("export function waitUntil(p) { globalThis.__lazyWaitUntil.push(p); }")}"`,
    )
    .replaceAll('from "../../bot-api"', `from "${lazyBotApiStubUrl}"`)
    .replaceAll(
      'from "../economy/economy-bridge-online"',
      `from "${dataUrl("export async function sweepEconomyOps() { globalThis.__lazyCounts.sweep += 1; return {}; }")}"`,
    )
    .replaceAll(
      'from "../economy/stock-online"',
      `from "${dataUrl("export async function runStockDividendCron() { globalThis.__lazyCounts.stock += 1; return {}; }")}"`,
    )
    .replaceAll(
      'from "../social/company-online"',
      `from "${dataUrl("export async function runCompanyCron() { globalThis.__lazyCounts.company += 1; return {}; }")}"`,
    ),
);
globalThis.__lazyCounts = lazyCounts;
globalThis.__lazyWaitUntil = lazyWaitUntilPromises;
const lazyJobs = await import(lazyJobsUrl);

async function flushLazy() {
  while (lazyWaitUntilPromises.length > 0) {
    await lazyWaitUntilPromises.shift();
  }
}

const T0 = 1_800_000_000_000;

test("lazy: 初回は全ジョブが走り、間隔内は再実行されず、経過後に必要な分だけ走る", async () => {
  lazyKv.clear();
  lazyCounts.sweep = 0;
  lazyCounts.company = 0;
  lazyCounts.stock = 0;
  lazyJobs.maybeRunLazyJobs(T0);
  await flushLazy();
  assert.deepEqual({ ...lazyCounts }, { sweep: 1, company: 1, stock: 1 });

  lazyJobs.maybeRunLazyJobs(T0 + 1_000);
  await flushLazy();
  assert.deepEqual({ ...lazyCounts }, { sweep: 1, company: 1, stock: 1 });

  lazyJobs.maybeRunLazyJobs(T0 + 56_000);
  await flushLazy();
  assert.deepEqual({ ...lazyCounts }, { sweep: 2, company: 1, stock: 1 });

  lazyJobs.maybeRunLazyJobs(T0 + 11 * 60_000);
  await flushLazy();
  assert.deepEqual({ ...lazyCounts }, { sweep: 3, company: 2, stock: 1 });
});

test("lazy: Cron 側の markLazyJobRun とタイムスタンプを共有し二重に走らない", async () => {
  await lazyJobs.markLazyJobRun("economy_sweep", T0);
  await lazyJobs.markLazyJobRun("company_cron", T0);
  await lazyJobs.markLazyJobRun("stock_dividend", T0);
  const before = { ...lazyCounts };
  lazyJobs.maybeRunLazyJobs(T0 + 30_000);
  await flushLazy();
  assert.deepEqual({ ...lazyCounts }, before);
});

test("lazy: 実行中の多重キックは二重実行にならない", async () => {
  lazyKv.clear();
  const before = { ...lazyCounts };
  lazyJobs.maybeRunLazyJobs(T0);
  lazyJobs.maybeRunLazyJobs(T0);
  await flushLazy();
  assert.equal(lazyCounts.sweep, before.sweep + 1);
  assert.equal(lazyCounts.company, before.company + 1);
  assert.equal(lazyCounts.stock, before.stock + 1);
});
