import { describe, expect, it } from "vitest";
import pkg from "@/package.json";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns ok and the package.json version", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: pkg.version });
  });
});
