import { and, desc, eq } from "drizzle-orm";
import { oauthClients, oauthGrants, settings, type DbOrTx } from "../db";
import { getConnectorSettings } from "./agent-read";
import { DEFAULT_TIME_ZONE } from "./dates";
import { CoreError } from "./errors";

export type ConnectorSwitches = { enabled: boolean; allowChanges: boolean; allowDeletes: boolean };

/** Updates the given connector switches (omitted ones stay). Creates the settings row if it is missing. */
export async function setConnectorSwitches(
  db: DbOrTx,
  userId: string,
  patch: Partial<ConnectorSwitches>,
): Promise<void> {
  const set = {
    ...(patch.enabled !== undefined ? { mcpEnabled: patch.enabled } : {}),
    ...(patch.allowChanges !== undefined ? { mcpAllowChanges: patch.allowChanges } : {}),
    ...(patch.allowDeletes !== undefined ? { mcpAllowDeletes: patch.allowDeletes } : {}),
  };
  if (Object.keys(set).length === 0) throw new CoreError("invalid_input", "Give at least one switch to change.");
  await db.insert(settings).values({ userId, ...set }).onConflictDoUpdate({ target: settings.userId, set });
}

/** The user's `settings.time_zone` (an IANA name); the default when there is no settings row. Not validated here. */
export async function getUserTimeZone(db: DbOrTx, userId: string): Promise<string> {
  const [row] = await db.select({ tz: settings.timeZone }).from(settings).where(eq(settings.userId, userId));
  return row?.tz ?? DEFAULT_TIME_ZONE;
}

export type ConnectedApp = { grantId: string; name: string; connectedAt: Date; lastUsedAt: Date | null };

/** Apps the user has approved, newest first. The name is what the app called itself (not verified). */
export async function listConnectedApps(db: DbOrTx, userId: string): Promise<ConnectedApp[]> {
  const rows = await db
    .select({
      grantId: oauthGrants.id,
      name: oauthClients.name,
      connectedAt: oauthGrants.createdAt,
      lastUsedAt: oauthGrants.lastUsedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(eq(oauthGrants.userId, userId))
    .orderBy(desc(oauthGrants.createdAt));
  return rows;
}

/** Revokes one app: deleting the grant deletes all its tokens (cascade). */
export async function revokeConnectedApp(db: DbOrTx, userId: string, grantId: string): Promise<void> {
  const gone = await db
    .delete(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, userId)))
    .returning({ id: oauthGrants.id });
  if (gone.length === 0) throw new CoreError("not_found", "Connected app not found.");
}

export type ConnectorNeed = "read" | "changes" | "deletes";

export const CONNECTOR_SWITCH_NAME = {
  read: "Connector -> Enabled",
  changes: "Connector -> Allow changes",
  deletes: "Connector -> Allow deletes",
} as const;

/**
 * The connector switch rules (docs/mcp-server.md): read needs `enabled`; changes (including
 * `restore_deleted`) need `enabled` and `allowChanges`; deletes need `enabled`, `allowChanges`
 * and `allowDeletes`. Throws a CoreError that names the switch to turn on.
 */
export async function assertConnectorAllows(db: DbOrTx, userId: string, need: ConnectorNeed): Promise<void> {
  const s = await getConnectorSettings(db, userId);
  if (!s.enabled) {
    throw new CoreError("invalid_state", `The Sound Journal connector is switched off. Ask the user to turn on "${CONNECTOR_SWITCH_NAME.read}" in the web app settings.`);
  }
  if (need === "read") return;
  if (!s.allowChanges) {
    const why = need === "deletes" ? "Deleting needs changes to be allowed first" : "Changes through the connector are switched off";
    throw new CoreError("invalid_state", `${why}. Ask the user to turn on "${CONNECTOR_SWITCH_NAME.changes}" in the web app settings.`);
  }
  if (need === "deletes" && !s.allowDeletes) {
    throw new CoreError("invalid_state", `Deleting through the connector is switched off. Ask the user to turn on "${CONNECTOR_SWITCH_NAME.deletes}" in the web app settings.`);
  }
}
