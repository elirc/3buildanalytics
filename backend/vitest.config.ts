import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests talk to a real database and hash real passwords with
    // bcrypt. Vitest's 5s/10s defaults are tuned for pure unit tests and are not
    // enough here, especially on a cold connection pool.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Suites share one database, so they must not run concurrently — two files
    // truncating tables underneath each other produces failures that look random.
    fileParallelism: false
  }
});
