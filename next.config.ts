import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pin the workspace root: without it Turbopack walks up and picks a stray
  // lockfile from the parent directory.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
