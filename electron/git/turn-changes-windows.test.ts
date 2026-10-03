import { expect, it, vi } from "vitest";
import { ownFiles } from "./turn-changes";

// Windows paths, while Git still lists files with forward slashes.
vi.mock("node:path", async () => (await vi.importActual("node:path")).win32);

it("matches the agent's own files by their Windows paths", () => {
  const files = [
    { path: "src/app.ts", additions: 1, deletions: 0 },
    { path: "src/lib/util.ts", additions: 1, deletions: 0 },
    { path: "web/z.ts", additions: 1, deletions: 0 },
    { path: "other.ts", additions: 1, deletions: 0 },
  ];
  expect(
    ownFiles(
      files,
      {
        edited: ["C:\\repo\\src\\app.ts"],
        commands: [
          "sed -i 's/a/b/' src/lib/util.ts",
          "cd web; Remove-Item .\\z.ts",
        ],
      },
      "C:\\repo",
    ).map((f) => f.path),
  ).toEqual(["src/app.ts", "src/lib/util.ts", "web/z.ts"]);
});
