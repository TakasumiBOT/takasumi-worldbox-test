#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL が未設定です。Neon の接続文字列を設定してください。");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");
const sql = await readFile(schemaPath, "utf8");

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(sql);
  const check = await pool.query("select pool, treasury from economy_pool_state where id = 1");
  const row = check.rows[0];
  console.log(
    `schema applied: ${schemaPath}\n` +
      `economy_pool_state: pool=${row?.pool} treasury=${row?.treasury}`,
  );
} finally {
  await pool.end();
}
