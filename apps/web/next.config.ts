import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Required for monorepo: tells Next.js to trace files relative to the repo root
  // so the standalone output mirrors the full workspace path structure.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
