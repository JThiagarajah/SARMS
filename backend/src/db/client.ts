import "dotenv/config";
import { Pool, type PoolClient, types } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// node-postgres returns BIGINT (e.g. every COUNT(*)) as a JS string by default, to avoid silent
// precision loss above 2^53. Nothing in this app's queries needs precision beyond a normal
// number, and every call site here was written assuming COUNT(*) comes back as a number (like
// it did under node:sqlite) — so parse int8 as a regular number app-wide instead of patching
// every individual query.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

const connectionString = process.env.DATABASE_URL ?? "postgres://sarms:sarms_dev_pw@localhost:5432/sarms";

const pool = new Pool({ connectionString });

// When code runs inside transaction(), every db.prepare(...).get/all/run() call in that
// callback (and anything it calls) is transparently routed to this one checked-out client
// instead of a random connection from the pool, so BEGIN/COMMIT/ROLLBACK actually wrap them.
const txContext = new AsyncLocalStorage<PoolClient>();

/** SQLite-style "?" placeholders -> Postgres-style "$1, $2, ..." (in order of appearance). */
function toPositional(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

async function runQuery(sql: string, params: unknown[]) {
  const client = txContext.getStore();
  const text = toPositional(sql);
  return client ? client.query(text, params) : pool.query(text, params);
}

class Statement {
  constructor(private sql: string) {}

  /** Returns the first matching row, or undefined — mirrors better-sqlite3's .get(). */
  async get(...params: unknown[]): Promise<any> {
    const result = await runQuery(this.sql, params);
    return result.rows[0];
  }

  /** Returns all matching rows — mirrors better-sqlite3's .all(). */
  async all(...params: unknown[]): Promise<any[]> {
    const result = await runQuery(this.sql, params);
    return result.rows;
  }

  /** Runs an INSERT/UPDATE/DELETE — mirrors better-sqlite3's .run() (minus lastInsertRowid,
   *  which this project never relies on since every id is an app-generated UUID). */
  async run(...params: unknown[]): Promise<{ changes: number }> {
    const result = await runQuery(this.sql, params);
    return { changes: result.rowCount ?? 0 };
  }
}

export const db = {
  prepare(sql: string): Statement {
    return new Statement(sql);
  },
};

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Run `fn` inside a Postgres transaction; rolls back if `fn` throws or rejects. */
export async function transaction<T>(fn: () => Promise<T> | T): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await txContext.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Applies schema.sql (all statements are CREATE ... IF NOT EXISTS, so this is safe to
 *  re-run on every startup and never destroys existing data). Must be awaited once before
 *  the server starts accepting requests — see server.ts and db/migrate.ts. */
export async function initDb(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  await pool.query(schema);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
