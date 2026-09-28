import { defineConfig } from "@playwright/test";
// CI's runners draw Electron in software on a virtual screen, 5-10x slower
// than a desktop, so the same steps get more time there and one retry for a
// timing blip; a retried test still shows as flaky in the report.
const ci = !!process.env.CI;
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: ci ? 180000 : 60000,
  expect: { timeout: ci ? 30000 : 15000 },
  retries: ci ? 1 : 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
