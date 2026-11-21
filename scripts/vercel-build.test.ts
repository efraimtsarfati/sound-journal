import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { buildSteps } from "./vercel-build.mjs";

describe("vercel-build", () => {
  it("migrates then builds only in production", () => {
    expect(buildSteps({ VERCEL_ENV: "production" })).toEqual([
      ["drizzle-kit", "migrate"],
      ["next", "build"],
    ]);
  });

  it.each(["preview", "development", undefined])("skips migrations for %s", (env) => {
    expect(buildSteps({ VERCEL_ENV: env })).toEqual([["next", "build"]]);
  });
});
