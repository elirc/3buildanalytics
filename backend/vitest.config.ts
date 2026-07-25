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
    // Every suite shares one database and resetDatabase() truncates globally,
    // so two files running at once corrupt each other. The symptom is a test
    // asserting "2 events" and getting 0, 1 or 4 on different runs — different
    // each time, which is what makes it expensive to diagnose.
    //
    // fileParallelism alone proved not to be a hard enough guarantee: running
    // a subset of files still produced intermittent interference. singleFork
    // puts every file in one process executed strictly in sequence, which is
    // the strongest isolation Vitest offers short of a database per worker.
    //
    // The cost is wall-clock time. A schema per worker is the right answer if
    // this suite ever grows slow enough for that to matter.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
