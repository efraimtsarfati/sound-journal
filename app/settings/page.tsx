import { Nav } from "@/app/_components/nav";
import { ActionButton } from "@/app/_components/action-button";
import { OWNER_USER_ID, formatInZone, getConnectorSettings, getUserTimeZone, listConnectedApps } from "@/lib/core";
import { getDb } from "@/lib/db";
import { ConnectorSwitches } from "./connector-switches";

export const metadata = { title: "Settings · Sound Journal" };
export const dynamic = "force-dynamic";

function when(d: Date | null, timeZone: string): string {
  return d ? formatInZone(d, timeZone) : "never";
}

export default async function SettingsPage() {
  const db = getDb();
  const [switches, apps, timeZone] = await Promise.all([
    getConnectorSettings(db, OWNER_USER_ID),
    listConnectedApps(db, OWNER_USER_ID),
    getUserTimeZone(db, OWNER_USER_ID),
  ]);
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Nav />
      <section aria-labelledby="connector-h" className="mb-8">
        <h2 id="connector-h" className="mb-2 text-lg font-semibold">
          Connector
        </h2>
        <ConnectorSwitches initial={switches} />
      </section>
      <section aria-labelledby="apps-h">
        <h2 id="apps-h" className="mb-2 text-lg font-semibold">
          Connected apps
        </h2>
        {apps.length === 0 ? (
          <p className="text-neutral-600">No apps are connected.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {apps.map((a) => (
              <li key={a.grantId} className="flex items-center justify-between gap-3 rounded border border-neutral-300 p-3">
                <div className="min-w-0">
                  <div className="break-words font-medium">{a.name}</div>
                  <div className="text-sm text-neutral-600">
                    Connected {when(a.connectedAt, timeZone)} · last used {when(a.lastUsedAt, timeZone)}
                  </div>
                </div>
                <ActionButton
                  url={`/api/connections/${a.grantId}`}
                  method="DELETE"
                  label="Revoke"
                  confirmText={`Revoke ${a.name}? It will stop working immediately.`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
