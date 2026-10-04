import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    const fresh = [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
    ];
    return [
      {
        source: "/sw.js",
        headers: [...fresh, { key: "Service-Worker-Allowed", value: "/" }],
      },
      {
        source: "/((?!_next/static|_next/image|brand/|icons/).*)",
        headers: fresh,
      },
    ];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
