import { expect, it } from "vitest";
import { diffKind, headlineStat, statsByKind } from "./diff-kinds";

it("tells generated files, tests and docs from code", () => {
  const kinds = Object.fromEntries(
    [
      "package-lock.json",
      "ios/Podfile.lock",
      "web/vendor/chart.min.js",
      "src/features/changes/turn-diff-tree.test.ts",
      "tests/e2e/thread-scroll.spec.ts",
      "ios/RelayKitTests/BridgeTests.swift",
      "android/app/src/test/java/dev/relay/PairTest.kt",
      "server/frames_test.go",
      "docs/ideas.md",
      "src/features/changes/ChangedFilesCard.tsx",
      "src/features/tests-page/Latest.tsx",
      "electron/git/working-tree.ts",
    ].map((p) => [p, diffKind(p)]),
  );
  expect(kinds).toEqual({
    "package-lock.json": "generated",
    "ios/Podfile.lock": "generated",
    "web/vendor/chart.min.js": "generated",
    "src/features/changes/turn-diff-tree.test.ts": "tests",
    "tests/e2e/thread-scroll.spec.ts": "tests",
    "ios/RelayKitTests/BridgeTests.swift": "tests",
    "android/app/src/test/java/dev/relay/PairTest.kt": "tests",
    "server/frames_test.go": "tests",
    "docs/ideas.md": "docs",
    "src/features/changes/ChangedFilesCard.tsx": "code",
    "src/features/tests-page/Latest.tsx": "code",
    "electron/git/working-tree.ts": "code",
  });
});

it("counts generated lines only when nothing else changed", () => {
  const lock = { path: "yarn.lock", additions: 900, deletions: 40 };
  expect(
    headlineStat(
      statsByKind([lock, { path: "a.test.ts", additions: 3, deletions: 1 }]),
    ),
  ).toEqual({ additions: 3, deletions: 1 });
  expect(headlineStat(statsByKind([lock]))).toEqual({
    additions: 900,
    deletions: 40,
  });
});
