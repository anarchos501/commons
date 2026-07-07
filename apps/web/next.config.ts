import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Required for monorepo: tells Next.js to trace files relative to the repo root
  // so the standalone output mirrors the full workspace path structure.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // The two-node federation dev harness runs a second instance from the same
  // directory (pnpm dev:node-b); it needs its own build dir or Next refuses
  // to start alongside the first instance. Unset = normal .next.
  distDir: process.env.COMMONS_DIST_DIR || ".next",
};

export default nextConfig;
