import { redirect } from "next/navigation";
import { appOrigin } from "@/lib/auth/oauth-metadata";
import { buildRedirect, checkAuthorizeRequest, readAuthorizeParams } from "@/lib/core";
import { getDb } from "@/lib/db";

export const metadata = { title: "Connect an app · Sound Journal" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid: "Wrong password.",
  locked: "Too many attempts. Try again in a few minutes.",
  config: "Sign-in isn't configured on the server.",
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-4 text-sm">{children}</p>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const origin = appOrigin(process.env.APP_ORIGIN);
  if (!origin || !process.env.APP_PASSWORD) {
    return <Notice title="Not configured">Connecting apps isn&apos;t set up on this server yet.</Notice>;
  }
  const p = readAuthorizeParams(sp);
  const check = await checkAuthorizeRequest(getDb(), p, origin);
  if (!check.ok && !check.redirect) {
    return <Notice title="Cannot connect">This connection request is not valid ({check.error}). Go back to the app and try again.</Notice>;
  }
  if (!check.ok) {
    redirect(
      buildRedirect(check.redirectUri, {
        error: check.error,
        error_description: check.description,
        state: check.state,
        iss: origin,
      }),
    );
  }
  const authError = typeof sp.auth_error === "string" ? sp.auth_error : "";
  const redirectHost = new URL(p.redirectUri).host;
  const hidden: [string, string][] = [
    ["response_type", p.responseType],
    ["client_id", p.clientId],
    ["redirect_uri", p.redirectUri],
    ["code_challenge", p.codeChallenge],
    ["code_challenge_method", p.codeChallengeMethod],
    ["state", p.state],
    ["resource", p.resource],
  ];
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Connect an app</h1>
      <p className="mt-4 text-sm">
        <strong>{check.client.name}</strong> <span className="text-neutral-600">(name given by the app, not verified)</span>{" "}
        wants to read and change your Sound Journal.
      </p>
      <p className="mt-3 text-sm">
        It will send you back to: <strong className="break-all">{redirectHost}</strong>
      </p>
      <p className="mt-3 rounded border border-amber-600 bg-amber-50 p-3 text-sm text-amber-900">
        Only approve if you just started connecting this app yourself.
      </p>
      <form method="post" action="/api/oauth/authorize" className="mt-6 flex flex-col gap-3">
        {hidden.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          className="min-h-11 rounded border border-neutral-400 px-3"
        />
        {authError && MESSAGES[authError] ? (
          <p role="alert" className="text-sm text-red-700">
            {MESSAGES[authError]}
          </p>
        ) : null}
        <button
          type="submit"
          name="decision"
          value="approve"
          className="min-h-11 rounded bg-neutral-900 px-4 text-white"
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          formNoValidate
          className="min-h-11 rounded border border-neutral-400 px-4"
        >
          Deny
        </button>
      </form>
    </main>
  );
}
