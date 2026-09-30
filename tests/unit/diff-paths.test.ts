import { describe, expect, it } from "vitest";
import { diffPaths } from "../../electron/diff-paths";

describe("diffPaths", () => {
  it("reads plain, spaced, renamed, binary and mode-only changes", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-diff --git a/not/a/path b/not/a/path",
      "+x",
      "diff --git a/docs/my notes.md b/docs/my notes.md",
      "diff --git a/old name.ts b/new name.ts",
      "similarity index 90%",
      "rename from old name.ts",
      "rename to new name.ts",
      "diff --git a/logo.png b/logo.png",
      "Binary files a/logo.png and b/logo.png differ",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
    ].join("\n");
    expect(diffPaths(diff).sort()).toEqual(
      [
        "docs/my notes.md",
        "logo.png",
        "new name.ts",
        "old name.ts",
        "run.sh",
        "src/a.ts",
      ].sort(),
    );
  });

  it("unquotes paths git escaped, including UTF-8 octal bytes", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
      'diff --git a/plain.ts "b/tab\\there.ts"',
      "rename from plain.ts",
      'rename to "tab\\there.ts"',
    ].join("\n");
    expect(diffPaths(diff).sort()).toEqual(
      ["café.ts", "plain.ts", "tab\there.ts"].sort(),
    );
  });
});
