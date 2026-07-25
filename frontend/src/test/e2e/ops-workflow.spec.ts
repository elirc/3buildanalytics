import { expect, test } from "@playwright/test";

/**
 * One real end-to-end flow, exercised against a seeded database.
 *
 * Scope is deliberately narrow: this is the smoke test that proves the stack is
 * wired together — login issues a usable token, the dashboard renders
 * server-aggregated data, and role-gated navigation works. Detailed behaviour
 * belongs in the much faster integration and component tests.
 *
 * Requires `npm run db:seed` to have run. playwright.config.ts starts both the
 * backend and the frontend.
 */

const OPS_MANAGER = { email: "ops_manager@example.com", password: "Password123!" };
const READ_ONLY = { email: "read_only@example.com", password: "Password123!" };

async function login(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
}

test.describe("operations manager workflow", () => {
  test("logs in, reads the dashboard, and opens an event", async ({ page }) => {
    await login(page, OPS_MANAGER);

    // The header reflects the signed-in identity.
    await expect(page.getByText("OPS_MANAGER")).toBeVisible();

    // KPI cards are populated from the server aggregation, not computed client-side.
    await expect(page.getByText("Total events")).toBeVisible();
    await expect(page.getByText("Active users")).toBeVisible();

    // Navigate to the event log, which ops managers are allowed to see.
    await page.getByRole("link", { name: "Events" }).click();
    await expect(page).toHaveURL(/\/events/);

    // Open the first event's detail page.
    const firstOpenLink = page.getByRole("link", { name: "Open" }).first();
    await expect(firstOpenLink).toBeVisible();
    await firstOpenLink.click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+/);
  });

  test("shares dashboard filters through the URL", async ({ page }) => {
    await login(page, OPS_MANAGER);

    await page.goto("/?startDate=2026-01-01&endDate=2026-01-31&interval=week");

    // Filter state lives in the query string so a dashboard view is shareable.
    await expect(page).toHaveURL(/startDate=2026-01-01/);
    await expect(page.getByText("Total events")).toBeVisible();
  });
});

test.describe("role-gated navigation", () => {
  test("read-only users cannot reach the event log", async ({ page }) => {
    await login(page, READ_ONLY);

    // RequireRole bounces a disallowed role back to the dashboard.
    await page.goto("/events");
    await expect(page).toHaveURL("/");
  });
});
