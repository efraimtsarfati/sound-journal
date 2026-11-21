import { safeNext } from "@/lib/auth/session";

export const metadata = { title: "Sign in · Sound Journal" };

const MESSAGES: Record<string, string> = {
  invalid: "Wrong password.",
  locked: "Too many attempts. Try again in a few minutes.",
  config: "Sign-in isn't configured on the server.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Sound Journal</h1>
      <form method="post" action="/api/auth/login" className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="min-h-11 rounded border border-neutral-400 px-3"
        />
        {error && MESSAGES[error] ? (
          <p role="alert" className="text-sm text-red-700">
            {MESSAGES[error]}
          </p>
        ) : null}
        <button type="submit" className="min-h-11 rounded bg-neutral-900 px-4 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
