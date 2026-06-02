import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** True when a Postgres connection is configured. */
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Lazily-initialized Drizzle client. Returns null when DATABASE_URL is absent
 * so every caller degrades gracefully to in-memory-only (open demo mode).
 */
export function getDb(): PostgresJsDatabase<typeof schema> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!db) {
    const sql = postgres(url, { max: 1 });
    db = drizzle(sql, { schema });
  }
  return db;
}
