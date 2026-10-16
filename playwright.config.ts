import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end flows. Two ways to run:
 *
 * 1. Against your Supabase project (recommended before launch):
 *    turn OFF "Confirm email" in Supabase Auth settings, then
 *      npm run build && npx next start -p 3210   # with .env.local filled in
 *      E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
 *
 * 2. Fully local, no Docker: `npm run test:e2e:local` (see scripts/e2e-local.sh),
 *    which uses Postgres + the test-only Supabase stand-in in tests/e2e/standin.
 */
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: external ?? "http://127.0.0.1:3210",
    trace: "retain-on-failure",
    // Fail fast on a stalled page instead of waiting out the whole test (diagnostics: LR_NET_DEBUG in the server log).
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    // Use a system Chromium when Playwright's bundled browser isn't installed.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    screenshot: "only-on-failure",
  },
  webServer: external
    ? undefined
    : {
        command: "npx next start -p 3210 -H 127.0.0.1",
        url: "http://127.0.0.1:3210",
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
