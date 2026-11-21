import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The consent page must never be framed (clickjacking) or leak its URL cross-site.
        // Referrer-Policy must NOT be "no-referrer": browsers then send `Origin: null` on the
        // consent form POST, which the same-origin check in lib/http/oauth.ts rejects.
        source: "/oauth/authorize",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
