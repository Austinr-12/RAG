import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Why: prisma.ts constructs its client at import time and throws
      // without a DATABASE_URL. Unit tests import pure helpers from modules
      // that share files with prisma-touching code; no query ever runs, so a
      // placeholder URL keeps imports safe without any real database.
      DATABASE_URL: "postgresql://unit:test@localhost:5432/unit-test-placeholder",
    },
  },
  resolve: {
    // Mirror tsconfig's "@/*" -> "./src/*" alias.
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
