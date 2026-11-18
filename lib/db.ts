import { Pool, neonConfig } from "@neondatabase/serverless";
import { createRequire } from "node:module";

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  try {
    const require = createRequire(import.meta.url);
    neonConfig.webSocketConstructor = require("ws");
  } catch {
    // WebSocket が用意できない環境では Pool 生成時にエラーになる（fail-closed）。
  }
}

export interface SqlExecutor {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

type PgClient = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};

type PgPool = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<PgClient>;
};

class PoolExecutor implements SqlExecutor {
  private pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async query(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query(text, params);
    return result.rows;
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: SqlExecutor = {
        query: async (text, params = []) => (await client.query(text, params)).rows,
        transaction: async (f) => f(tx),
      };
      const out = await fn(tx);
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

let sharedPool: Pool | null = null;

export function getDbPool(): Pool {
  if (sharedPool) return sharedPool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  sharedPool = new Pool({ connectionString: url });
  return sharedPool;
}

export function createSqlExecutor(pool: PgPool): SqlExecutor {
  return new PoolExecutor(pool);
}

let sharedExecutor: SqlExecutor | null = null;

export function getSqlExecutor(): SqlExecutor {
  if (!sharedExecutor) sharedExecutor = createSqlExecutor(getDbPool() as unknown as PgPool);
  return sharedExecutor;
}
