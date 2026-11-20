import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;

/** Any Drizzle Postgres database or transaction (Neon at runtime, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type DbOrTx = Db;

let cached: Db | undefined;

/**
 * Lazily creates the runtime database handle. Nothing connects at import time,
 * so `next build` works without DATABASE_URL.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  cached = drizzle(new Pool({ connectionString: url }), { schema });
  return cached;
}
