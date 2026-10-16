import { defineConfig } from "vitest/config";
// Records agent transcripts from the real CLIs; never part of the unit run.
// See tests/fixtures/replays/README.md.
export default defineConfig({
  test: {
    include: ["tests/record/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
