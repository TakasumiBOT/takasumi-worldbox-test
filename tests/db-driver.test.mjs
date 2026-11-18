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

function fakePoolModule(driver) {
  return dataUrl(`
export const neonConfig = {};
export class Pool {
  constructor(config) {
    this.driver = "${driver}";
    this.config = config;
    this.queries = [];
    this.connects = 0;
  }
  async query(text, params) {
    this.queries.push([text, params]);
    return { rows: [{ via: "${driver}" }] };
  }
  async connect() {
    this.connects += 1;
    const self = this;
    return { query: (t, p) => self.query(t, p), release() {} };
  }
  async end() {}
}
`);
}

const db = await import(
  dataUrl(
    transpile("db.ts")
      .replaceAll('from "@neondatabase/serverless"', `from "${fakePoolModule("neon")}"`)
      .replaceAll('from "pg"', `from "${fakePoolModule("pg")}"`),
  )
);

test("db-driver: Neon のホストは neon ドライバになる", () => {
  assert.equal(
    db.databaseDriverForUrl("postgres://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb"),
    "neon",
  );
  assert.equal(
    db.databaseDriverForUrl("postgres://u:p@ep-cool-123.c-2.eu-central-1.aws.neon.tech/neondb"),
    "neon",
  );
  assert.equal(db.databaseDriverForUrl("postgresql://u:p@db.neon.tech/neondb"), "neon");
});

test("db-driver: それ以外のホストは pg ドライバになる", () => {
  assert.equal(db.databaseDriverForUrl("postgres://u:p@localhost:5432/takasumi"), "pg");
  assert.equal(db.databaseDriverForUrl("postgres://u:p@127.0.0.1:5432/takasumi"), "pg");
  assert.equal(db.databaseDriverForUrl("postgres://luna@pi.local/takasumi"), "pg");
  assert.equal(db.databaseDriverForUrl("postgres://u:p@neon.tech.evil.example/db"), "pg");
  assert.equal(db.databaseDriverForUrl("postgres://u:p@fakeneon.tech/db"), "pg");
});

test("db-driver: URL として不正なら throw する", () => {
  assert.throws(() => db.databaseDriverForUrl("not-a-url"), /DATABASE_URL is not a valid URL/);
  assert.throws(() => db.createDbPool(":://"), /DATABASE_URL is not a valid URL/);
});

test("db-driver: createDbPool は URL に応じた Pool を生成する（接続は張らない）", () => {
  const neonUrl = "postgres://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb";
  const neonPool = db.createDbPool(neonUrl);
  assert.equal(neonPool.driver, "neon");
  assert.equal(neonPool.config.connectionString, neonUrl);
  assert.deepEqual(neonPool.queries, []);
  assert.equal(neonPool.connects, 0);

  const localUrl = "postgres://u:p@localhost:5432/takasumi";
  const pgPool = db.createDbPool(localUrl);
  assert.equal(pgPool.driver, "pg");
  assert.equal(pgPool.config.connectionString, localUrl);
  assert.deepEqual(pgPool.queries, []);
  assert.equal(pgPool.connects, 0);
});

test("db-driver: 生成した Pool は SqlExecutor 抽象の上でそのまま動く", async () => {
  const pool = db.createDbPool("postgres://u:p@localhost:5432/takasumi");
  const executor = db.createSqlExecutor(pool);
  const rows = await executor.query("select 1", []);
  assert.deepEqual(rows, [{ via: "pg" }]);
  const out = await executor.transaction(async (tx) => {
    await tx.query("insert into t values ($1)", [1]);
    return "done";
  });
  assert.equal(out, "done");
  assert.deepEqual(
    pool.queries.map(([text]) => text),
    ["select 1", "BEGIN", "insert into t values ($1)", "COMMIT"],
  );
});

test("db-driver: getDbPool は DATABASE_URL 未設定で throw し、ローカル URL では pg を返す", () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(() => db.getDbPool(), /DATABASE_URL is not configured/);
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/takasumi";
    const pool = db.getDbPool();
    assert.equal(pool.driver, "pg");
    assert.equal(db.getDbPool(), pool);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});
