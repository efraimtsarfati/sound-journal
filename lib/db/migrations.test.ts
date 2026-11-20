import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_USER_ID } from "../core/owner";
import { settings, users } from "./schema";
import { createTestDb } from "./test-utils";

const EXPECTED_TABLES = [
  "artist_genres",
  "artists",
  "auth_attempts",
  "entries",
  "entry_artists",
  "entry_sources",
  "highlight_tags",
  "highlights",
  "oauth_clients",
  "oauth_codes",
  "oauth_grants",
  "oauth_tokens",
  "settings",
  "tags",
  "users",
];

describe("migrations", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("creates exactly the 15 documented tables", async () => {
    const res = await t.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(res.rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("OWNER_USER_ID is a valid v4 UUID", () => {
    expect(OWNER_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("seeds exactly one owner user", async () => {
    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(OWNER_USER_ID);
    expect(rows[0].displayName).toBe("Owner");
  });

  it("seeds the owner's settings with the documented defaults", async () => {
    const rows = await t.db.select().from(settings).where(eq(settings.userId, OWNER_USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      mcpEnabled: true,
      mcpAllowChanges: true,
      mcpAllowDeletes: false,
      timeZone: "America/Toronto",
    });
  });

  it("re-running migrations is a no-op", async () => {
    await migrate(t.db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await t.db.select().from(settings)).toHaveLength(1);
  });

  it("the seed statements are idempotent", async () => {
    const sql = readFileSync(new URL("./migrations/0000_init.sql", import.meta.url), "utf8");
    const seeds = sql.split("--> statement-breakpoint").filter((s) => /^\s*INSERT INTO/.test(s));
    expect(seeds.length).toBe(2);
    for (const s of seeds) await t.client.exec(s);
    expect(await t.db.select().from(users)).toHaveLength(1);
    expect(await t.db.select().from(settings)).toHaveLength(1);
  });

  it("each test database is isolated", async () => {
    const other = await createTestDb();
    try {
      await other.db.insert(users).values({ displayName: "Second" });
      expect(await other.db.select().from(users)).toHaveLength(2);
      expect(await t.db.select().from(users)).toHaveLength(1);
    } finally {
      await other.close();
    }
  });
});
