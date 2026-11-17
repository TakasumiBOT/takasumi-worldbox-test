// 独立環境の DB アクセス層（Neon Postgres、サーバー専用）。
//
// @neondatabase/serverless の Pool を使う。HTTP ドライバ（neon()）では
// 複数文にまたがるトランザクションが組めないため、経済 RPC の原子性は
// Pool（WebSocket 接続 + BEGIN/COMMIT）で担保する。
// 接続文字列は DATABASE_URL env のみ（コードに埋め込まない）。
import { Pool, neonConfig } from "@neondatabase/serverless";
import { createRequire } from "node:module";

// Node < 22 にはグローバル WebSocket が無いため、ある環境では ws で補う。
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  try {
    const require = createRequire(import.meta.url);
    neonConfig.webSocketConstructor = require("ws");
  } catch {
    // WebSocket が用意できない環境では Pool 生成時にエラーになる（fail-closed）。
  }
}

/**
 * SQL 実行の最小インターフェース。botapi-server はこれにだけ依存し、
 * テストではフェイクを注入できる。query は行配列を返し、DB エラーは
 * sqlstate を持つ例外（pg 互換の .code）としてそのまま投げる。
 */
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
        // 入れ子は同一トランザクションで実行する（呼び出し側は入れ子にしない）。
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

/** DATABASE_URL から共有 Pool を作る（遅延生成）。未設定なら例外。 */
export function getDbPool(): Pool {
  if (sharedPool) return sharedPool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  sharedPool = new Pool({ connectionString: url });
  return sharedPool;
}

/** 任意の Pool（互換クライアント）から SqlExecutor を作る。 */
export function createSqlExecutor(pool: PgPool): SqlExecutor {
  return new PoolExecutor(pool);
}

let sharedExecutor: SqlExecutor | null = null;

/** 既定の SqlExecutor（DATABASE_URL の Pool に接続）。 */
export function getSqlExecutor(): SqlExecutor {
  if (!sharedExecutor) sharedExecutor = createSqlExecutor(getDbPool() as unknown as PgPool);
  return sharedExecutor;
}
