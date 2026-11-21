import { describe, expect, it } from "vitest";
import { ipKeyPart } from "./rate-limit";

describe("ipKeyPart", () => {
  it("keeps IPv4 addresses and falls back to unknown", () => {
    expect(ipKeyPart("198.51.100.7")).toBe("198.51.100.7");
    expect(ipKeyPart("  ")).toBe("unknown");
    expect(ipKeyPart(undefined)).toBe("unknown");
  });

  it("groups IPv6 addresses by /64", () => {
    const a = ipKeyPart("2001:db8:aaaa:bbbb:1111:2222:3333:4444");
    const b = ipKeyPart("2001:DB8:aaaa:bbbb:ffff:eeee:dddd:cccc");
    expect(a).toBe("2001:db8:aaaa:bbbb::");
    expect(b).toBe(a);
    expect(ipKeyPart("2001:db8:aaaa:cccc::1")).not.toBe(a);
  });

  it("expands :: and drops zone ids", () => {
    expect(ipKeyPart("2001:db8::1")).toBe("2001:db8:0:0::");
    expect(ipKeyPart("2001:db8:0:0:9::1")).toBe("2001:db8:0:0::");
    expect(ipKeyPart("::1")).toBe("0:0:0:0::");
    expect(ipKeyPart("fe80::1%eth0")).toBe("fe80:0:0:0::");
  });

  it("is stable when applied twice and maps IPv4-in-IPv6 to IPv4", () => {
    const once = ipKeyPart("2001:db8:1:2:3:4:5:6");
    expect(ipKeyPart(once)).toBe(once);
    expect(ipKeyPart("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("does not choke on garbage", () => {
    expect(ipKeyPart("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(ipKeyPart("a::b::c")).toBe("a::b::c");
  });
});
