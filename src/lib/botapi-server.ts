import { createHash, timingSafeEqual } from "node:crypto";
import {
  INT_TOKEN_PREFIX,
  isIntToken,
  parseJsonPreservingInts,
  stringifyWithInts,
} from "./dashboard-core";
import type { SqlExecutor } from "./db";

export class BotApiHttpError extends Error {
  status: number;
  code: string;
  detailBody?: unknown;
  constructor(status: number, code: string, message: string, detailBody?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detailBody = detailBody;
  }
}

export class BotApiDbError extends Error {
  sqlstate: string;
  constructor(sqlstate: string, message: string) {
    super(message);
    this.sqlstate = sqlstate;
  }
}

function validationError(message: string): BotApiHttpError {
  return new BotApiHttpError(422, "VALIDATION_ERROR", message, {
    detail: [{ loc: ["body"], msg: message, type: "value_error" }],
  });
}

function asDbError(error: unknown): unknown {
  if (error instanceof BotApiHttpError || error instanceof BotApiDbError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return new BotApiDbError(
      code,
      error instanceof Error ? error.message : "Database operation failed",
    );
  }
  return error;
}

export function authorizeBotApi(authorization: string | null | undefined): void {
  const expected = process.env.BOT_API_KEY ?? "";
  const provided = authorization ?? "";
  let ok = false;
  if (expected && provided.startsWith("Bearer ")) {
    const a = createHash("sha256").update(provided.slice("Bearer ".length)).digest();
    const b = createHash("sha256").update(expected).digest();
    ok = timingSafeEqual(a, b);
  }
  if (!ok) throw new BotApiHttpError(401, "UNAUTHORIZED", "Invalid API credentials");
}

type ColumnType = "text" | "int8" | "int2" | "jsonb" | "timestamptz";

export const BOTAPI_TABLE_COLUMNS: Record<string, Record<string, ColumnType>> = {
  bot_kv: { namespace: "text", key: "text", value: "jsonb", updated_at: "timestamptz" },
  users: { user_id: "text", balance: "int8", debt: "int8" },
  transaction_history: {
    id: "int8",
    sender_id: "text",
    receiver_id: "text",
    amount: "int8",
    reason: "text",
    created_at: "timestamptz",
  },
  economy_pool_state: {
    id: "int2",
    pool: "int8",
    treasury: "int8",
    total_recycled: "int8",
    total_paid: "int8",
    total_released: "int8",
    total_boosted: "int8",
    lottery_boost_pending: "int8",
    total_house_paid: "int8",
    last_release_date: "text",
    updated_at: "timestamptz",
  },
};

const TABLE_PRIMARY_KEYS: Record<string, string[]> = {
  bot_kv: ["namespace", "key"],
  users: ["user_id"],
  transaction_history: ["id"],
  economy_pool_state: ["id"],
};

const FILTER_OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "contains",
  "is",
  "in",
]);
const MAX_LIMIT = 10_000;
const DEFAULT_LIMIT = 1_000;

export interface BotApiFilter {
  column: string;
  op: string;
  value?: unknown;
}

export interface QueryBody {
  table: string;
  action: "select" | "insert" | "upsert" | "update" | "delete";
  columns: string | string[];
  filters: BotApiFilter[];
  order: { column: string; desc: boolean }[];
  values: unknown;
  on_conflict: string | null;
  limit: number | null;
  offset: number;
}

export interface RpcBody {
  name: string;
  params: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw validationError(`${where}: unknown field ${key}`);
  }
}

export function validateQueryBody(raw: unknown): QueryBody {
  if (!isPlainObject(raw)) throw validationError("query body must be an object");
  checkKeys(
    raw,
    ["table", "action", "columns", "filters", "order", "values", "on_conflict", "limit", "offset"],
    "query",
  );
  if (typeof raw.table !== "string") throw validationError("table is required");
  const action = raw.action ?? "select";
  if (
    action !== "select" &&
    action !== "insert" &&
    action !== "upsert" &&
    action !== "update" &&
    action !== "delete"
  ) {
    throw validationError("invalid action");
  }
  const columns = raw.columns ?? "*";
  if (
    typeof columns !== "string" &&
    !(Array.isArray(columns) && columns.every((c) => typeof c === "string"))
  ) {
    throw validationError("columns must be a string or string array");
  }
  const filters: BotApiFilter[] = [];
  if (raw.filters !== undefined) {
    if (!Array.isArray(raw.filters) || raw.filters.length > 32)
      throw validationError("filters must be an array of at most 32");
    for (const item of raw.filters) {
      if (!isPlainObject(item)) throw validationError("filter must be an object");
      checkKeys(item, ["column", "op", "value"], "filter");
      if (typeof item.column !== "string" || typeof item.op !== "string")
        throw validationError("filter column/op are required");
      filters.push({ column: item.column, op: item.op, value: item.value });
    }
  }
  const order: { column: string; desc: boolean }[] = [];
  if (raw.order !== undefined) {
    if (!Array.isArray(raw.order) || raw.order.length > 8)
      throw validationError("order must be an array of at most 8");
    for (const item of raw.order) {
      if (!isPlainObject(item)) throw validationError("order must be an object");
      checkKeys(item, ["column", "desc"], "order");
      if (typeof item.column !== "string") throw validationError("order column is required");
      if (item.desc !== undefined && typeof item.desc !== "boolean")
        throw validationError("order desc must be boolean");
      order.push({ column: item.column, desc: item.desc === true });
    }
  }
  if (
    raw.on_conflict !== undefined &&
    raw.on_conflict !== null &&
    typeof raw.on_conflict !== "string"
  ) {
    throw validationError("on_conflict must be a string");
  }
  let limit: number | null = null;
  if (raw.limit !== undefined && raw.limit !== null) {
    if (
      typeof raw.limit !== "number" ||
      !Number.isInteger(raw.limit) ||
      raw.limit < 0 ||
      raw.limit > MAX_LIMIT
    ) {
      throw validationError("limit must be an integer in 0..10000");
    }
    limit = raw.limit;
  }
  let offset = 0;
  if (raw.offset !== undefined) {
    if (typeof raw.offset !== "number" || !Number.isInteger(raw.offset) || raw.offset < 0) {
      throw validationError("offset must be a non-negative integer");
    }
    offset = raw.offset;
  }
  return {
    table: raw.table,
    action,
    columns,
    filters,
    order,
    values: raw.values,
    on_conflict: typeof raw.on_conflict === "string" ? raw.on_conflict : null,
    limit,
    offset,
  };
}

export function validateRpcBody(raw: unknown): RpcBody {
  if (!isPlainObject(raw)) throw validationError("rpc body must be an object");
  checkKeys(raw, ["name", "params"], "rpc");
  if (typeof raw.name !== "string") throw validationError("name is required");
  const params = raw.params ?? {};
  if (!isPlainObject(params)) throw validationError("params must be an object");
  return { name: raw.name, params };
}

class ParamBag {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function identifier(table: string, name: string): string {
  const types = BOTAPI_TABLE_COLUMNS[table];
  if (!types || !(name in types)) {
    throw new BotApiHttpError(400, "INVALID_COLUMN", `Unknown column '${name}'`);
  }
  return quoteIdent(name);
}

function adaptParam(table: string, column: string, value: unknown, bag: ParamBag): string {
  const type = BOTAPI_TABLE_COLUMNS[table][column];
  if (type === "jsonb") {
    if (value === null || value === undefined) return `${bag.add(null)}::jsonb`;
    return `${bag.add(stringifyWithInts(value))}::jsonb`;
  }
  if ((type === "int8" || type === "int2") && isIntToken(value)) {
    return bag.add(value.slice(INT_TOKEN_PREFIX.length));
  }
  return bag.add(value ?? null);
}

function buildWhere(table: string, filters: BotApiFilter[], bag: ParamBag): string {
  const operators: Record<string, string> = {
    eq: "=",
    neq: "<>",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    like: "LIKE",
    ilike: "ILIKE",
  };
  const clauses: string[] = [];
  for (const item of filters) {
    if (!FILTER_OPERATORS.has(item.op)) {
      throw new BotApiHttpError(
        400,
        "INVALID_OPERATOR",
        `Unsupported filter operator '${item.op}'`,
      );
    }
    const col = identifier(table, item.column);
    if (item.op === "is") {
      const normalized = typeof item.value === "string" ? item.value.toLowerCase() : item.value;
      if (item.value === null || item.value === undefined || normalized === "null") {
        clauses.push(`${col} IS NULL`);
      } else if (normalized === true || normalized === "true") {
        clauses.push(`${col} IS TRUE`);
      } else if (normalized === false || normalized === "false") {
        clauses.push(`${col} IS FALSE`);
      } else {
        throw new BotApiHttpError(400, "INVALID_FILTER", "is accepts only null/true/false");
      }
    } else if (
      (item.op === "eq" || item.op === "neq") &&
      (item.value === null || item.value === undefined)
    ) {
      clauses.push(item.op === "neq" ? `${col} IS NOT NULL` : `${col} IS NULL`);
    } else if (item.op === "in") {
      if (!Array.isArray(item.value)) {
        throw new BotApiHttpError(400, "INVALID_FILTER", "in requires an array");
      }
      if (item.value.length === 0) {
        clauses.push("FALSE");
      } else {
        const placeholders = item.value.map((v) => adaptParam(table, item.column, v, bag));
        clauses.push(`${col} IN (${placeholders.join(", ")})`);
      }
    } else if (item.op === "contains") {
      clauses.push(`${col} @> ${adaptParam(table, item.column, item.value, bag)}`);
    } else {
      clauses.push(
        `${col} ${operators[item.op]} ${adaptParam(table, item.column, item.value, bag)}`,
      );
    }
  }
  return clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
}

function columnExpr(table: string, name: string): string {
  const type = BOTAPI_TABLE_COLUMNS[table][name];
  return type === "jsonb" ? `${quoteIdent(name)}::text AS ${quoteIdent(name)}` : quoteIdent(name);
}

function selectedColumns(table: string, columns: string | string[]): string[] {
  const types = BOTAPI_TABLE_COLUMNS[table];
  if (columns === "*" || (Array.isArray(columns) && columns.length === 1 && columns[0] === "*")) {
    return Object.keys(types);
  }
  const names = (typeof columns === "string" ? columns.split(",") : columns).map((n) => n.trim());
  if (names.length === 0 || names.some((n) => !n)) {
    throw new BotApiHttpError(400, "INVALID_COLUMNS", "Invalid select columns");
  }
  for (const name of names) identifier(table, name);
  return names;
}

function allColumnExprs(table: string): string {
  return Object.keys(BOTAPI_TABLE_COLUMNS[table])
    .map((name) => columnExpr(table, name))
    .join(", ");
}

function isoPlus(date: Date): string {
  return date.toISOString().replace("Z", "+00:00");
}

function postProcessRows(
  table: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const types = BOTAPI_TABLE_COLUMNS[table];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const type = types[key];
      if (type === "int8" && typeof value === "string" && /^-?\d+$/.test(value)) {
        out[key] = BigInt(value);
      } else if (type === "jsonb" && typeof value === "string") {
        try {
          out[key] = parseJsonPreservingInts(value);
        } catch {
          out[key] = value;
        }
      } else if (type === "timestamptz" && value instanceof Date) {
        out[key] = isoPlus(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

async function executeQuery(
  executor: SqlExecutor,
  body: QueryBody,
): Promise<Record<string, unknown>[]> {
  const types = BOTAPI_TABLE_COLUMNS[body.table];
  if (!types) {
    throw new BotApiHttpError(404, "TABLE_NOT_ALLOWED", "Table is not available through this API");
  }
  const tableSql = `"public".${quoteIdent(body.table)}`;
  const validateBag = new ParamBag();
  buildWhere(body.table, body.filters, validateBag);

  if (body.action === "select") {
    const names = selectedColumns(body.table, body.columns);
    const bag = new ParamBag();
    const where = buildWhere(body.table, body.filters, bag);
    let sql = `SELECT ${names.map((n) => columnExpr(body.table, n)).join(", ")} FROM ${tableSql}${where}`;
    if (body.order.length > 0) {
      const orders = body.order.map(
        (o) => `${identifier(body.table, o.column)} ${o.desc ? "DESC" : "ASC"}`,
      );
      sql += ` ORDER BY ${orders.join(", ")}`;
    }
    sql += ` LIMIT ${bag.add(body.limit ?? DEFAULT_LIMIT)} OFFSET ${bag.add(body.offset)}`;
    return postProcessRows(body.table, await executor.query(sql, bag.values));
  }

  if ((body.action === "update" || body.action === "delete") && body.filters.length === 0) {
    throw new BotApiHttpError(400, "FILTER_REQUIRED", "update/delete require at least one filter");
  }

  if (body.action === "delete") {
    const bag = new ParamBag();
    const where = buildWhere(body.table, body.filters, bag);
    const rows = await executor.query(
      `DELETE FROM ${tableSql}${where} RETURNING ${allColumnExprs(body.table)}`,
      bag.values,
    );
    return postProcessRows(body.table, rows);
  }

  if (body.action === "update") {
    if (!isPlainObject(body.values) || Object.keys(body.values).length === 0) {
      throw new BotApiHttpError(400, "INVALID_VALUES", "update requires a non-empty object");
    }
    const bag = new ParamBag();
    const assignments: string[] = [];
    for (const [name, value] of Object.entries(body.values)) {
      assignments.push(
        `${identifier(body.table, name)} = ${adaptParam(body.table, name, value, bag)}`,
      );
    }
    const where = buildWhere(body.table, body.filters, bag);
    const rows = await executor.query(
      `UPDATE ${tableSql} SET ${assignments.join(", ")}${where} RETURNING ${allColumnExprs(body.table)}`,
      bag.values,
    );
    return postProcessRows(body.table, rows);
  }

  const records = Array.isArray(body.values) ? body.values : [body.values];
  if (
    records.length === 0 ||
    records.some((r) => !isPlainObject(r) || Object.keys(r).length === 0)
  ) {
    throw new BotApiHttpError(
      400,
      "INVALID_VALUES",
      "insert/upsert requires an object or non-empty array of objects",
    );
  }
  const names = Object.keys(records[0] as Record<string, unknown>);
  const nameSet = new Set(names);
  if (
    records.some((r) => {
      const keys = Object.keys(r as Record<string, unknown>);
      return keys.length !== names.length || keys.some((k) => !nameSet.has(k));
    })
  ) {
    throw new BotApiHttpError(400, "INVALID_VALUES", "All rows must have the same columns");
  }
  for (const name of names) identifier(body.table, name);
  const bag = new ParamBag();
  const rowSqls = (records as Record<string, unknown>[]).map((record) => {
    const placeholders = names.map((name) => adaptParam(body.table, name, record[name], bag));
    return `(${placeholders.join(", ")})`;
  });
  let sql = `INSERT INTO ${tableSql} (${names.map(quoteIdent).join(", ")}) VALUES ${rowSqls.join(", ")}`;
  if (body.action === "upsert") {
    let conflicts = (body.on_conflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (conflicts.length === 0) conflicts = TABLE_PRIMARY_KEYS[body.table] ?? [];
    if (conflicts.length === 0) {
      throw new BotApiHttpError(
        400,
        "CONFLICT_REQUIRED",
        "upsert requires on_conflict or a primary key",
      );
    }
    for (const name of conflicts) identifier(body.table, name);
    const updates = names.filter((n) => !conflicts.includes(n));
    const conflictSql = conflicts.map(quoteIdent).join(", ");
    if (updates.length > 0) {
      const setSql = updates.map((n) => `${quoteIdent(n)} = EXCLUDED.${quoteIdent(n)}`).join(", ");
      sql += ` ON CONFLICT (${conflictSql}) DO UPDATE SET ${setSql}`;
    } else {
      sql += ` ON CONFLICT (${conflictSql}) DO NOTHING`;
    }
  }
  sql += ` RETURNING ${allColumnExprs(body.table)}`;
  return postProcessRows(body.table, await executor.query(sql, bag.values));
}

export async function handleBotApiQuery(
  body: QueryBody,
  executor: SqlExecutor,
): Promise<Record<string, unknown>[]> {
  try {
    return await executor.transaction((tx) => executeQuery(tx, body));
  } catch (error) {
    throw asDbError(error);
  }
}

export const BOTAPI_RPC_ARGUMENTS: Record<string, string[]> = {
  economy_pool_pay_house: ["p_amount"],
  economy_pool_refund_house: ["p_pool_part", "p_treasury_part"],
  economy_pool_add_loss: ["p_amount"],
  transfer_coins: ["p_sender_id", "p_receiver_id", "p_amount", "p_new_user_balance"],
};

function rpcInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (isIntToken(value)) return BigInt(value.slice(INT_TOKEN_PREFIX.length));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new BotApiDbError("22P02", `invalid input syntax for type bigint: "${String(value)}"`);
}

function poolAmount(value: unknown): bigint {
  const v = rpcInt(value);
  return v === null || v < 0n ? 0n : v;
}

function rpcText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new BotApiDbError("42883", "function argument type mismatch");
}

function rowBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}

async function ensurePoolRow(tx: SqlExecutor): Promise<void> {
  await tx.query(
    `INSERT INTO "economy_pool_state" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`,
  );
}

interface PoolRow {
  pool: bigint;
  treasury: bigint;
  totalRecycled: bigint;
  totalHousePaid: bigint;
}

async function selectPoolForUpdate(tx: SqlExecutor): Promise<PoolRow> {
  const rows = await tx.query(
    `SELECT "pool", "treasury", "total_recycled", "total_house_paid" FROM "economy_pool_state" WHERE "id" = $1 FOR UPDATE`,
    [1],
  );
  const row = rows[0] ?? {};
  return {
    pool: rowBigInt(row.pool),
    treasury: rowBigInt(row.treasury),
    totalRecycled: rowBigInt(row.total_recycled),
    totalHousePaid: rowBigInt(row.total_house_paid),
  };
}

async function updatePool(tx: SqlExecutor, next: PoolRow): Promise<void> {
  await tx.query(
    `UPDATE "economy_pool_state" SET "pool" = $1, "treasury" = $2, "total_recycled" = $3, "total_house_paid" = $4, "updated_at" = now() WHERE "id" = $5`,
    [
      next.pool.toString(),
      next.treasury.toString(),
      next.totalRecycled.toString(),
      next.totalHousePaid.toString(),
      1,
    ],
  );
}

async function rpcPayHouse(tx: SqlExecutor, params: Record<string, unknown>): Promise<unknown> {
  const amount = poolAmount(params.p_amount);
  await ensurePoolRow(tx);
  const row = await selectPoolForUpdate(tx);
  const poolPart = row.pool < amount ? row.pool : amount;
  const rest = amount - poolPart;
  const treasuryPart = row.treasury < rest ? row.treasury : rest;
  const paid = poolPart + treasuryPart;
  if (paid > 0n) {
    await updatePool(tx, {
      pool: row.pool - poolPart,
      treasury: row.treasury - treasuryPart,
      totalRecycled: row.totalRecycled,
      totalHousePaid: row.totalHousePaid + paid,
    });
  }
  return [{ paid, pool_part: poolPart, treasury_part: treasuryPart }];
}

async function rpcRefundHouse(tx: SqlExecutor, params: Record<string, unknown>): Promise<unknown> {
  const poolPart = poolAmount(params.p_pool_part);
  const treasuryPart = poolAmount(params.p_treasury_part);
  const amount = poolPart + treasuryPart;
  await ensurePoolRow(tx);
  const row = await selectPoolForUpdate(tx);
  const totalHousePaid = row.totalHousePaid - amount < 0n ? 0n : row.totalHousePaid - amount;
  await updatePool(tx, {
    pool: row.pool + poolPart,
    treasury: row.treasury + treasuryPart,
    totalRecycled: row.totalRecycled,
    totalHousePaid,
  });
  return totalHousePaid;
}

async function rpcAddLoss(tx: SqlExecutor, params: Record<string, unknown>): Promise<unknown> {
  const amount = poolAmount(params.p_amount);
  const poolPart = (amount * 7n) / 10n;
  const treasuryPart = amount - poolPart;
  await ensurePoolRow(tx);
  if (amount > 0n) {
    const row = await selectPoolForUpdate(tx);
    await updatePool(tx, {
      pool: row.pool + poolPart,
      treasury: row.treasury + treasuryPart,
      totalRecycled: row.totalRecycled + amount,
      totalHousePaid: row.totalHousePaid,
    });
  }
  return [{ pool_part: poolPart, treasury_part: treasuryPart }];
}

async function rpcTransferCoins(
  tx: SqlExecutor,
  params: Record<string, unknown>,
): Promise<unknown> {
  const sender = rpcText(params.p_sender_id);
  const receiver = rpcText(params.p_receiver_id);
  const amount = rpcInt(params.p_amount);
  if (amount === null || amount <= 0n) {
    throw new BotApiDbError("P0001", "amount must be positive");
  }
  if (sender === null || receiver === null || sender === receiver) {
    throw new BotApiDbError("P0001", "invalid transfer parties");
  }
  const newUserBalance = rpcInt(params.p_new_user_balance) ?? 10n;

  const [first, second] = sender < receiver ? [sender, receiver] : [receiver, sender];
  const firstRows = await tx.query(
    `SELECT "balance" FROM "users" WHERE "user_id" = $1 FOR UPDATE`,
    [first],
  );
  const secondRows = await tx.query(
    `SELECT "balance" FROM "users" WHERE "user_id" = $1 FOR UPDATE`,
    [second],
  );
  const senderRows = first === sender ? firstRows : secondRows;
  const receiverRows = first === receiver ? firstRows : secondRows;

  const senderBalance = senderRows.length > 0 ? rowBigInt(senderRows[0].balance) : null;
  if (senderBalance === null || senderBalance < amount) {
    throw new BotApiDbError("P0001", "insufficient balance");
  }
  const newSenderBalance = senderBalance - amount;
  await tx.query(`UPDATE "users" SET "balance" = $1 WHERE "user_id" = $2`, [
    newSenderBalance.toString(),
    sender,
  ]);

  if (receiverRows.length > 0) {
    const next = rowBigInt(receiverRows[0].balance) + amount;
    await tx.query(`UPDATE "users" SET "balance" = $1 WHERE "user_id" = $2`, [
      next.toString(),
      receiver,
    ]);
  } else {
    await tx.query(`INSERT INTO "users" ("user_id", "balance", "debt") VALUES ($1, $2, $3)`, [
      receiver,
      (newUserBalance + amount).toString(),
      "0",
    ]);
  }
  await tx.query(
    `INSERT INTO "transaction_history" ("sender_id", "receiver_id", "amount", "reason") VALUES ($1, $2, $3, $4)`,
    [sender, receiver, amount.toString(), "送金"],
  );
  return newSenderBalance;
}

const RPC_IMPLS: Record<
  string,
  (tx: SqlExecutor, params: Record<string, unknown>) => Promise<unknown>
> = {
  economy_pool_pay_house: rpcPayHouse,
  economy_pool_refund_house: rpcRefundHouse,
  economy_pool_add_loss: rpcAddLoss,
  transfer_coins: rpcTransferCoins,
};

export async function handleBotApiRpc(body: RpcBody, executor: SqlExecutor): Promise<unknown> {
  const allowed = BOTAPI_RPC_ARGUMENTS[body.name];
  if (!allowed) {
    throw new BotApiHttpError(404, "RPC_NOT_ALLOWED", "Function is not available through this API");
  }
  const keys = Object.keys(body.params);
  if (keys.length === 0 || keys.some((k) => !allowed.includes(k))) {
    throw new BotApiHttpError(400, "INVALID_RPC_PARAMS", "Invalid function arguments");
  }
  const impl = RPC_IMPLS[body.name];
  try {
    return await executor.transaction((tx) => impl(tx, body.params));
  } catch (error) {
    throw asDbError(error);
  }
}

export function serializeBotApiJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("cannot serialize non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    return isIntToken(value) ? value.slice(INT_TOKEN_PREFIX.length) : JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(isoPlus(value));
  if (Array.isArray(value)) return `[${value.map((item) => serializeBotApiJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${serializeBotApiJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`cannot serialize ${typeof value}`);
}

function toErrorResponse(error: unknown): { status: number; body: string } {
  const converted = asDbError(error);
  if (converted instanceof BotApiHttpError) {
    const body =
      converted.detailBody !== undefined
        ? serializeBotApiJson(converted.detailBody)
        : serializeBotApiJson({ detail: { code: converted.code, message: converted.message } });
    return { status: converted.status, body };
  }
  if (converted instanceof BotApiDbError) {
    const state = converted.sqlstate;
    const status =
      state.startsWith("22") || state.startsWith("23") || state === "P0001" ? 400 : 500;
    return {
      status,
      body: serializeBotApiJson({ detail: { code: state, message: converted.message } }),
    };
  }
  console.error("[botapi] unexpected error:", error);
  return {
    status: 500,
    body: serializeBotApiJson({
      detail: { code: "INTERNAL_ERROR", message: "Internal server error" },
    }),
  };
}

export async function processBotApiRequest(
  kind: "query" | "rpc",
  rawText: string,
  authorization: string | null,
  executor: SqlExecutor,
): Promise<{ status: number; body: string }> {
  try {
    let parsed: unknown;
    try {
      parsed = parseJsonPreservingInts(rawText);
    } catch {
      throw validationError("Invalid JSON body");
    }
    if (kind === "query") {
      const body = validateQueryBody(parsed);
      authorizeBotApi(authorization);
      const data = await handleBotApiQuery(body, executor);
      return { status: 200, body: serializeBotApiJson({ data }) };
    }
    const body = validateRpcBody(parsed);
    authorizeBotApi(authorization);
    const data = await handleBotApiRpc(body, executor);
    return { status: 200, body: serializeBotApiJson({ data }) };
  } catch (error) {
    return toErrorResponse(error);
  }
}
