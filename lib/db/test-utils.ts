import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect } from "vitest";
import { OWNER_USER_ID } from "../core/owner";
import * as schema from "./schema";
import type {
  NewArtist,
  NewEntry,
  NewHighlight,
  NewTag,
  NewUser,
} from "./schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

export type TestDb = ReturnType<typeof drizzle<typeof schema, PGlite>>;

/** A fresh in-memory Postgres (PGlite), migrated from empty. Use one per test file. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

type PgErrorLike = { code?: string; constraint?: string; cause?: unknown };

function pgFields(err: unknown): { code?: string; constraint?: string } {
  const e = err as PgErrorLike;
  const cause = e.cause as PgErrorLike | undefined;
  return {
    code: e.code ?? cause?.code,
    constraint: e.constraint ?? cause?.constraint,
  };
}

/** Postgres SQLSTATE codes used in tests. */
export const PG = { unique: "23505", fk: "23503", check: "23514" } as const;

/** Asserts that the promise rejects with the given SQLSTATE (and constraint name, if given). */
export async function expectPgError(
  promise: PromiseLike<unknown>,
  expected: { code: string; constraint?: string },
) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the query to fail").toBeDefined();
  const { code, constraint } = pgFields(caught);
  expect(code).toBe(expected.code);
  if (expected.constraint !== undefined) expect(constraint).toBe(expected.constraint);
}

// Fixture inserters. All data is made up.

export async function insertUser(db: TestDb, values: Partial<NewUser> = {}) {
  const [row] = await db
    .insert(schema.users)
    .values({ displayName: "Test User", ...values })
    .returning();
  return row;
}

export async function insertEntry(db: TestDb, values: Partial<NewEntry> = {}) {
  const [row] = await db
    .insert(schema.entries)
    .values({ userId: OWNER_USER_ID, title: "Test Song", ...values })
    .returning();
  return row;
}

/** Inserts a highlight; defaults to a whole-work highlight with a note, status needs_tags. */
export async function insertHighlight(
  db: TestDb,
  values: Partial<NewHighlight> & { entryId: string },
) {
  const [row] = await db
    .insert(schema.highlights)
    .values({ userId: OWNER_USER_ID, status: "needs_tags", note: "a made-up note", ...values })
    .returning();
  return row;
}

export async function insertTag(db: TestDb, values: Partial<NewTag> = {}) {
  const [row] = await db
    .insert(schema.tags)
    .values({
      userId: OWNER_USER_ID,
      axis: "texture",
      name: "Test Tag",
      slug: "test-tag",
      createdBy: "agent",
      ...values,
    })
    .returning();
  return row;
}

export async function insertArtist(db: TestDb, values: Partial<NewArtist> = {}) {
  const [row] = await db
    .insert(schema.artists)
    .values({ name: "Test Artist", nameNormalized: "test artist", ...values })
    .returning();
  return row;
}
