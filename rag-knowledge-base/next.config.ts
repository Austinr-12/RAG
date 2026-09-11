import type { NextConfig } from "next";
import path from "node:path";

// Why: baseline hardening headers on every route. Deliberately no script-src
// CSP yet — Next's inline bootstrap and Clerk's scripts need nonce plumbing
// to lock that down properly; frame-ancestors alone can't break the app and
// closes clickjacking.
const securityHeaders = [
  // No embedding this app in iframes (clickjacking).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Legacy equivalent for older user agents.
  { key: "X-Frame-Options", value: "DENY" },
  // Never MIME-sniff responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which include conversation/document routes) cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app never needs these browser capabilities.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
