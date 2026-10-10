import { defineConfig } from "vitest/config";
export default defineConfig({
  // Without this, files under mobile/ pick up mobile/tsconfig.json, which
  // extends expo/tsconfig.base and fails wherever mobile deps aren't installed (CI).
  tsconfig: "./tsconfig.json",
  test: {
    include: [
      "{src,electron,shared}/**/*.test.{ts,tsx}",
      "mobile/src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "scripts/*.test.mjs",
    ],
    // Caps, not waits: see tests/unit/setup.ts.
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    expect: { poll: { timeout: 20_000 } },
  },
});
