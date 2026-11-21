import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthClients, oauthGrants, oauthTokens, users, type Db } from "../db";
import { createTestDb } from "../db/test-utils";
import { getConnectorSettings } from "./agent-read";
import { assertConnectorAllows, listConnectedApps, revokeConnectedApp, setConnectorSwitches } from "./connector";
import { CoreError } from "./errors";
import { OWNER_USER_ID } from "./owner";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  const t = await createTestDb();
  db = t.db as unknown as Db;
  close = t.close;
});
afterAll(() => close());

describe("connector switches", () => {
  it("changes only the given switches", async () => {
    expect(await getConnectorSettings(db, OWNER_USER_ID)).toEqual({ enabled: true, allowChanges: true, allowDeletes: false });
    await setConnectorSwitches(db, OWNER_USER_ID, { allowDeletes: true });
    await setConnectorSwitches(db, OWNER_USER_ID, { enabled: false });
    expect(await getConnectorSettings(db, OWNER_USER_ID)).toEqual({ enabled: false, allowChanges: true, allowDeletes: true });
  });
  it("refuses an empty patch", async () => {
    await expect(setConnectorSwitches(db, OWNER_USER_ID, {})).rejects.toBeInstanceOf(CoreError);
  });
});

describe("connected apps", () => {
  it("lists the user's apps and revoking deletes the grant and its tokens", async () => {
    const [other] = await db.insert(users).values({ displayName: "Other" }).returning();
    await db.insert(oauthClients).values([
      { id: "c1", name: "Agent One", redirectUris: ["https://a.example.test/cb"] },
      { id: "c2", name: "Agent Two", redirectUris: ["https://b.example.test/cb"] },
    ]);
    const [mine] = await db.insert(oauthGrants).values({ clientId: "c1", userId: OWNER_USER_ID }).returning();
    const [theirs] = await db.insert(oauthGrants).values({ clientId: "c2", userId: other.id }).returning();
    await db.insert(oauthTokens).values({
      tokenHash: "t1",
      grantId: mine.id,
      kind: "access",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await listConnectedApps(db, OWNER_USER_ID)).map((a) => a.name)).toEqual(["Agent One"]);
    await expect(revokeConnectedApp(db, OWNER_USER_ID, theirs.id)).rejects.toMatchObject({ code: "not_found" });
    await revokeConnectedApp(db, OWNER_USER_ID, mine.id);
    expect(await listConnectedApps(db, OWNER_USER_ID)).toEqual([]);
    expect(await db.select().from(oauthTokens)).toEqual([]);
  });
});

describe("assertConnectorAllows", () => {
  const need = (n: "read" | "changes" | "deletes") => assertConnectorAllows(db, OWNER_USER_ID, n);
  const set = (enabled: boolean, allowChanges: boolean, allowDeletes: boolean) =>
    setConnectorSwitches(db, OWNER_USER_ID, { enabled, allowChanges, allowDeletes });

  it("read needs only Enabled", async () => {
    await set(true, false, false);
    await expect(need("read")).resolves.toBeUndefined();
    await set(false, true, true);
    await expect(need("read")).rejects.toThrow(/Connector -> Enabled/);
  });
  it("changes need Enabled and Allow changes", async () => {
    await set(true, true, false);
    await expect(need("changes")).resolves.toBeUndefined();
    await set(true, false, true);
    await expect(need("changes")).rejects.toThrow(/Connector -> Allow changes/);
    await set(false, true, true);
    await expect(need("changes")).rejects.toThrow(/Connector -> Enabled/);
  });
  it("deletes need all three switches and name the missing one", async () => {
    await set(true, true, true);
    await expect(need("deletes")).resolves.toBeUndefined();
    await set(true, true, false);
    await expect(need("deletes")).rejects.toThrow(/Connector -> Allow deletes/);
    await set(true, false, true);
    await expect(need("deletes")).rejects.toThrow(/Connector -> Allow changes/);
    await set(false, true, true);
    await expect(need("deletes")).rejects.toBeInstanceOf(CoreError);
  });
  it("uses the documented defaults with no settings row", async () => {
    await expect(assertConnectorAllows(db, "00000000-0000-4000-8000-0000000000ff", "changes")).resolves.toBeUndefined();
    await expect(assertConnectorAllows(db, "00000000-0000-4000-8000-0000000000ff", "deletes")).rejects.toBeInstanceOf(CoreError);
  });
});
