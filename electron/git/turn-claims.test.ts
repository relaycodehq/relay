import { expect, it } from "vitest";
import { ownFiles } from "./turn-claims";

it("matches the agent's paths whether relative, absolute or dotted", () => {
  const files = [
    { path: "app/src/x.ts", additions: 1, deletions: 0 },
    { path: "app/src/y.ts", additions: 1, deletions: 0 },
    { path: "app/src/z.ts", additions: 1, deletions: 0 },
    { path: "app/src/other.ts", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      {
        edited: ["app/src/x.ts", "/repo/app/src/y.ts"],
        commands: ["sed -i '' 's/a/b/' ./app/src/z.ts"],
      },
      "/repo",
    ).map((f) => f.path),
  ).toEqual(["app/src/x.ts", "app/src/y.ts", "app/src/z.ts"]);
});

it("matches a file a command names from the folder it changed into", () => {
  const files = [
    { path: "app/src/x.ts", additions: 1, deletions: 0 },
    { path: "app/src/y.ts", additions: 1, deletions: 0 },
    { path: "web/z.ts", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      {
        edited: [],
        commands: [
          `/bin/zsh -lc "cd app/src && sed -i '' 's/a/b/' x.ts"`,
          "cd '/repo/web' && npx prettier --write ./z.ts",
        ],
      },
      "/repo",
    ).map((f) => f.path),
  ).toEqual(["app/src/x.ts", "web/z.ts"]);
});

it("doesn't claim a file whose name ends a longer non-ASCII one", () => {
  const files = [
    { path: "plan.md", additions: 1, deletions: 0 },
    { path: "úplan.md", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      { edited: [], commands: ["echo done >> úplan.md"] },
      "/repo",
    ).map((f) => f.path),
  ).toEqual(["úplan.md"]);
});
