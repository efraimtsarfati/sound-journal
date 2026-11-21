// Vercel build entry point. Only production builds migrate the database.
// Previews share the production DB until Neon branch-per-preview is enabled,
// so they must never run migrations (docs/architecture.md -> Environments).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function buildSteps(env) {
  const steps = [];
  if (env.VERCEL_ENV === "production") steps.push(["drizzle-kit", "migrate"]);
  steps.push(["next", "build"]);
  return steps;
}

function main() {
  for (const [bin, ...args] of buildSteps(process.env)) {
    const result = spawnSync("npx", ["--no-install", bin, ...args], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
