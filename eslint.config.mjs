import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    // Only lib/db may import the Postgres client (docs/architecture.md).
    ignores: ["lib/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@neondatabase/*",
                "@electric-sql/pglite*",
                "drizzle-orm/neon-*",
                "drizzle-orm/node-postgres*",
                "drizzle-orm/postgres-js*",
                "@vercel/postgres*",
                "drizzle-orm/pglite*",
                "pg",
                "postgres",
              ],
              message: "Only lib/db may import the Postgres client. Import from @/lib/db instead.",
            },
          ],
        },
      ],
    },
  },
]);
