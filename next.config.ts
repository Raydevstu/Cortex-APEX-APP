import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Phase 2: chokidar (file watcher) must stay external to the server bundle —
  // it relies on Node fs events at runtime and must not be traced/bundled.
  serverExternalPackages: ["chokidar"],
};

export default nextConfig;
