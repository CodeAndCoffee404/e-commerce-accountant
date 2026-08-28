import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pin the workspace root: without it Turbopack walks up and picks a stray
  // lockfile from the parent directory.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  // The screen was called Uploads until the name caught up with the table it
  // reads — `source_files` — and an address people have bookmarked should not
  // stop working over a rename. Permanent, because the old name is not coming
  // back.
  async redirects() {
    return [{ source: "/uploads", destination: "/source-files", permanent: true }];
  },
};

export default nextConfig;
