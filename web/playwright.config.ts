import { defineConfig, devices } from "@playwright/test";

/**
 * UI E2E (Playwright) — login + six landing dashboards (§10.6).
 * Requires a running full stack: `docker compose -f deploy/docker-compose.yml up`
 * or local `pnpm dev` + seeded demo users (pnpm db:seed:demo).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4000",
    locale: "ar",
    viewport: { width: 1280, height: 800 }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
