import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("consent page headers", () => {
  it("never uses Referrer-Policy no-referrer (browsers would send Origin: null and the consent POST would be rejected)", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const consent = rules.find((r) => r.source === "/oauth/authorize");
    expect(consent).toBeDefined();
    const policy = consent?.headers.find((h) => h.key === "Referrer-Policy")?.value;
    expect(policy).toBe("same-origin");
  });

  it("still blocks framing of the consent page", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const consent = rules.find((r) => r.source === "/oauth/authorize");
    expect(consent?.headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });
});
