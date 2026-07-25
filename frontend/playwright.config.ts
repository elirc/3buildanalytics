import { defineConfig } from "@playwright/test";

const FRONTEND_URL = "http://127.0.0.1:5173";
const BACKEND_URL = "http://127.0.0.1:4000";

export default defineConfig({
  testDir: "./src/test/e2e",
  // CI runners are slower and noisier than a laptop; retry once there but never
  // locally, where a flaky test should be visible immediately rather than hidden.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  // Both servers are needed: the UI cannot log in without the API. Previously
  // only the frontend was started, so any test past the login form failed.
  webServer: [
    {
      command: "npm run dev -w backend",
      url: `${BACKEND_URL}/health`,
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ],

  use: {
    baseURL: FRONTEND_URL,
    // Traces and screenshots make a CI-only failure diagnosable without
    // reproducing it locally. on-first-retry keeps artifacts small.
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  }
});
