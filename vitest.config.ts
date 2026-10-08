import { defineConfig } from "vitest/config";
export default defineConfig({
  // Without this, files under mobile/ pick up mobile/tsconfig.json, which
  // extends expo/tsconfig.base and fails wherever mobile deps aren't installed (CI).
  tsconfig: "./tsconfig.json",
  test: {
    include: [
      "{src,electron,shared}/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
    ],
  },
});
