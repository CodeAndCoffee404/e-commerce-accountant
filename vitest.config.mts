import path from "node:path";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// The database-backed tests need a connection string, and it lives where the
// app's own does. Without one they skip themselves rather than fail.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
