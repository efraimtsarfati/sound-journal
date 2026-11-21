import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_USER_ID, getConnectorSettings } from "../core";
import { oauthClients, oauthGrants, type Db } from "../db";
import { createTestDb } from "../db/test-utils";
import { handleConnectorSwitches, handleRevokeConnection } from "./connector-routes";
import { checkSessionRequest } from "./session-request";

const ORIGIN = "https://journal.example.test";
const ENV = { APP_ORIGIN: ORIGIN };

let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
});
afterAll(() => t.close());

const post = (headers: Record<string, string>, body: unknown = { allowDeletes: true }) =>
  new Request(`${ORIGIN}/api/settings/connector`, { method: "POST", headers, body: JSON.stringify(body) });

describe("checkSessionRequest", () => {
  it("allows the app's own origin, or no Origin header", () => {
    expect(checkSessionRequest(post({ "content-type": "application/json", origin: ORIGIN }), ENV, { json: true })).toBeNull();
    expect(checkSessionRequest(post({ "content-type": "application/json; charset=utf-8" }), ENV, { json: true })).toBeNull();
  });
  it("refuses another origin, including the literal null", () => {
    for (const origin of ["https://evil.example.test", "null", `${ORIGIN}.evil.test`]) {
      const r = checkSessionRequest(post({ "content-type": "application/json", origin }), ENV, { json: true });
      expect(r?.status, origin).toBe(403);
    }
  });
  it("requires application/json only where there is a body", () => {
    expect(checkSessionRequest(post({ "content-type": "text/plain" }), ENV, { json: true })?.status).toBe(415);
    expect(checkSessionRequest(post({}), ENV, { json: true })?.status).toBe(415);
    expect(checkSessionRequest(post({ "content-type": "text/plain" }), ENV, { json: false })).toBeNull();
  });
  it("fails closed without APP_ORIGIN", () => {
    expect(checkSessionRequest(post({ "content-type": "application/json" }), {}, { json: true })?.status).toBe(503);
  });
});

describe("session routes", () => {
  it("settings: refuses a cross-origin or non-JSON post and changes nothing", async () => {
    const bad1 = await handleConnectorSwitches(post({ "content-type": "application/json", origin: "https://evil.example.test" }), db, ENV);
    const bad2 = await handleConnectorSwitches(post({ "content-type": "text/plain" }), db, ENV);
    expect([bad1.status, bad2.status]).toEqual([403, 415]);
    expect((await getConnectorSettings(db, OWNER_USER_ID)).allowDeletes).toBe(false);
    const good = await handleConnectorSwitches(post({ "content-type": "application/json", origin: ORIGIN }), db, ENV);
    expect(good.status).toBe(200);
    expect((await getConnectorSettings(db, OWNER_USER_ID)).allowDeletes).toBe(true);
    expect((await handleConnectorSwitches(post({ "content-type": "application/json" }, { bogus: 1 }), db, ENV)).status).toBe(400);
  });

  it("revoke: refuses a cross-origin delete, then revokes", async () => {
    await db.insert(oauthClients).values({ id: "rc1", name: "Revokable", redirectUris: ["https://a.example.test/cb"] });
    const [g] = await db.insert(oauthGrants).values({ clientId: "rc1", userId: OWNER_USER_ID }).returning();
    const del = (origin?: string) =>
      new Request(`${ORIGIN}/api/connections/${g.id}`, { method: "DELETE", headers: origin ? { origin } : {} });
    expect((await handleRevokeConnection(del("https://evil.example.test"), g.id, db, ENV)).status).toBe(403);
    expect((await handleRevokeConnection(del(ORIGIN), "not-a-uuid", db, ENV)).status).toBe(400);
    expect((await handleRevokeConnection(del(ORIGIN), g.id, db, ENV)).status).toBe(200);
    expect((await handleRevokeConnection(del(ORIGIN), g.id, db, ENV)).status).toBe(404);
  });
});
