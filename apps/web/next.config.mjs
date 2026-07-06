/** @type {import("next").NextConfig} */
// 127.0.0.1 (not "localhost"): uvicorn binds IPv4 only, but "localhost" can resolve
// to IPv6 ::1 first, where Docker/OrbStack may be squatting (→ 404s). Uncommon
// five-digit port avoids clashes; override with BACKEND_URL.
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:18000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ppt-pilot/shared-schema"],
  // Dev-proxy default (30s) is shorter than a real-LLM generation step (~30–60s),
  // which surfaces as a bare 500 → UNKNOWN_ERROR in the browser. Raise it for local dev.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
