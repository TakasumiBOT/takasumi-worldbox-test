#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL が未設定です。Postgres の接続文字列を設定してください。");
  process.exit(1);
}

function isNeonUrl(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");
const sql = await readFile(schemaPath, "utf8");

const pool = isNeonUrl(databaseUrl)
  ? new NeonPool({ connectionString: databaseUrl })
  : new PgPool({ connectionString: databaseUrl });
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
