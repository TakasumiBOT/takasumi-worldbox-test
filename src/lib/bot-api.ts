import {
  BotApiDbError,
  BotApiHttpError,
  handleBotApiQuery,
  handleBotApiRpc,
  serializeBotApiJson,
  validateQueryBody,
  validateRpcBody,
} from "./botapi-server";
import { parseJsonPreservingInts, stringifyWithInts } from "./dashboard-core";
import { getSqlExecutor } from "./db";

export type BotApiFilter = { column: string; op: string; value: unknown };

type QueryBody = {
  table: string;
  action: "select" | "insert" | "upsert" | "update" | "delete";
  columns?: string;
  filters?: BotApiFilter[];
  values?: unknown;
  on_conflict?: string;
  limit?: number;
};

export class BotApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(`database API returned ${status}${code ? ` (${code})` : ""}`);
    this.status = status;
    this.code = code;
  }
}

function httpBotApi(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.BOT_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.BOT_API_KEY;
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

function inProcessAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export function isBotApiConfigured() {
  return httpBotApi() !== null || inProcessAvailable();
}

let lastLazyKickAt = 0;
let lazyJobsModule: Promise<typeof import("./worldbox/core/lazy-jobs")> | null = null;
function kickLazyJobs() {
  if (!isBotApiConfigured()) return;
  const now = Date.now();
  if (now - lastLazyKickAt < 15_000) return;
  lastLazyKickAt = now;
  if (!lazyJobsModule) lazyJobsModule = import("./worldbox/core/lazy-jobs");
  void lazyJobsModule.then((m) => m.maybeRunLazyJobs(now)).catch(() => undefined);
}

function inProcessStatus(error: unknown): number | null {
  if (error instanceof BotApiHttpError) return error.status;
  if (error instanceof BotApiDbError) {
    const state = error.sqlstate;
    return state.startsWith("22") || state.startsWith("23") || state === "P0001" ? 400 : 500;
  }
  return null;
}

function roundTrip<T>(value: unknown): T {
  return parseJsonPreservingInts(serializeBotApiJson(value)) as T;
}

async function queryInProcess<T>(body: QueryBody): Promise<T[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await handleBotApiQuery(validateQueryBody(body), getSqlExecutor());
  } catch (error) {
    const status = inProcessStatus(error);
    if (status === null) {
      console.error("[bot-api] in-process query failed:", error);
      throw new Error("database API returned 500");
    }
    throw new Error(`database API returned ${status}`);
  }
  const data = roundTrip<unknown>(rows);
  return Array.isArray(data) ? (data as T[]) : [];
}

async function query<T>(body: QueryBody): Promise<T[]> {
  kickLazyJobs();
  const http = httpBotApi();
  if (!http) {
    if (!inProcessAvailable()) throw new Error("database API environment is missing");
    return queryInProcess<T>(body);
  }
  const { baseUrl, apiKey } = http;

  const res = await fetch(`${baseUrl}/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: stringifyWithInts(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`database API returned ${res.status}`);
  const result = parseJsonPreservingInts(await res.text()) as { data?: T[] };
  return Array.isArray(result.data) ? result.data : [];
}

export async function tableSelect<T>(
  table: string,
  columns: string,
  filters: { column: string; op: string; value: unknown }[],
  limit = 1,
): Promise<T[]> {
  return query<T>({ table, action: "select", columns, filters, limit });
}

export async function tableUpsert(
  table: string,
  values: unknown,
  onConflict: string,
): Promise<void> {
  await query({ table, action: "upsert", values, on_conflict: onConflict });
}

export async function tableInsert(table: string, values: unknown): Promise<void> {
  await query({ table, action: "insert", values });
}

export async function tableUpdate<T>(
  table: string,
  values: unknown,
  filters: BotApiFilter[],
): Promise<T[]> {
  return query<T>({ table, action: "update", values, filters });
}

async function rpcInProcess<T>(name: string, params: Record<string, unknown>): Promise<T> {
  let data: unknown;
  try {
    data = await handleBotApiRpc(validateRpcBody({ name, params }), getSqlExecutor());
  } catch (error) {
    if (error instanceof BotApiHttpError) throw new BotApiError(error.status, error.code);
    if (error instanceof BotApiDbError) {
      throw new BotApiError(inProcessStatus(error) ?? 500, error.sqlstate);
    }
    console.error("[bot-api] in-process rpc failed:", error);
    throw new BotApiError(500, "INTERNAL_ERROR");
  }
  return roundTrip<T>(data);
}

export async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  kickLazyJobs();
  const http = httpBotApi();
  if (!http) {
    if (!inProcessAvailable()) throw new Error("database API environment is missing");
    return rpcInProcess<T>(name, params);
  }
  const { baseUrl, apiKey } = http;

  const res = await fetch(`${baseUrl}/v1/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: stringifyWithInts({ name, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { detail?: { code?: unknown } };
      if (typeof parsed.detail?.code === "string") code = parsed.detail.code;
    } catch {
      // コードが読めなくても status だけで十分に扱える
    }
    throw new BotApiError(res.status, code);
  }
  const result = parseJsonPreservingInts(text) as { data?: T };
  return result.data as T;
}

type KvRow = { key: string; value: unknown };

const KV_TABLE = "bot_kv";

export async function kvGet(namespace: string, key: string): Promise<unknown | null> {
  const rows = await query<KvRow>({
    table: KV_TABLE,
    action: "select",
    columns: "key,value",
    filters: [
      { column: "namespace", op: "eq", value: namespace },
      { column: "key", op: "eq", value: key },
    ],
    limit: 1,
  });
  return rows.length > 0 ? (rows[0].value ?? null) : null;
}

export async function kvList(namespace: string): Promise<Map<string, unknown>> {
  const rows = await query<KvRow>({
    table: KV_TABLE,
    action: "select",
    columns: "key,value",
    filters: [{ column: "namespace", op: "eq", value: namespace }],
    limit: 10_000,
  });
  const map = new Map<string, unknown>();
  for (const row of rows) map.set(String(row.key), row.value ?? null);
  return map;
}

export async function kvSet(namespace: string, key: string, value: unknown): Promise<void> {
  await query({
    table: KV_TABLE,
    action: "upsert",
    values: {
      namespace,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    on_conflict: "namespace,key",
  });
}

export async function kvDelete(namespace: string, key: string): Promise<void> {
  await query({
    table: KV_TABLE,
    action: "delete",
    filters: [
      { column: "namespace", op: "eq", value: namespace },
      { column: "key", op: "eq", value: key },
    ],
  });
}
