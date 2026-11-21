import { and, desc, eq } from "drizzle-orm";
import { oauthClients, oauthGrants, settings, type DbOrTx } from "../db";
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
