import { defineConfig } from "@playwright/test";
import { dropInheritedEnv } from "./tests/fixtures/inherited-env";

dropInheritedEnv();

// Playwright options that take a value, so the value isn't read as a spec filter.
const valued = new Set([
  "-c",
  "--config",
  "-j",
  "--workers",
  "--project",
  "--reporter",
  "--timeout",
  "--retries",
  "--repeat-each",
  "--max-failures",
  "--output",
  "--shard",
  "--trace",
  "--global-timeout",
  "--tsconfig",
  "--grep-invert",
]);

function picksSpecs(argv: string[]) {
  const at = argv.indexOf("test");
  if (at < 0) return true;
  const args = argv.slice(at + 1);
  return args.some(
    (arg, i) =>
      ["-g", "--grep", "--list", "--last-failed", "--only-changed", "--ui"].some(
        (flag) => arg === flag || arg.startsWith(flag + "="),
      ) ||
      (!arg.startsWith("-") && !valued.has(args[i - 1])),
  );
}

// Every spec launches its own Electron app, and they keep popping into the
// Dock of whoever runs them, for half an hour. Workers load this config too,
// with their own argv, so only the runner checks.
if (
  !process.env.TEST_WORKER_INDEX &&
  !process.env.RELAY_E2E_ALL &&
  !picksSpecs(process.argv)
)
  throw new Error(
    "Name the specs to run (e.g. `npx playwright test e2e/projects.spec`). " +
      "The whole suite runs only with RELAY_E2E_ALL=1.",
  );

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
