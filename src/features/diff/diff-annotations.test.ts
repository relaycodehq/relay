import { expect, it } from "vitest";
import { lineAnnotations } from "./diff-annotations";
import { checkNote } from "../checks/file-checks";

const comment = (id: number, position: number, original: number, at = "h1") =>
  ({
    id,
    path: "a.ts",
    commit_id: at,
    position,
    original_position: original,
    body: `c${id}`,
  }) as never;
const draft = (id: string, line: number, revision = "r1") =>
  ({ id, path: "a.ts", line, side: "additions", revision, body: id }) as never;

const base = {
  path: "a.ts",
  head: "h1",
  revision: "r1",
  comments: [],
  drafts: [],
  marks: [],
  diagnostics: [],
  composer: null,
};
const at = (list: ReturnType<typeof lineAnnotations>) =>
  list.map((a) => `${a.side}:${a.lineNumber}`);

it("puts comments on the head's lines, or the base's once outdated, and skips other commits", () => {
  const list = lineAnnotations({
    ...base,
    comments: [
      comment(1, 4, 9),
      comment(2, 0, 7),
      comment(3, 0, 0),
      comment(4, 5, 5, "old"),
    ],
  });
  expect(at(list)).toEqual(["additions:4", "deletions:7"]);
  expect(list[1].metadata.comments.map((c) => c.id)).toEqual([2]);
});

it("collects drafts, marks and diagnostics on a line, and the open box's draft shows in the box", () => {
  const list = lineAnnotations({
    ...base,
    drafts: [draft("d1", 3), draft("d2", 3), draft("d3", 3, "r0")],
    marks: [
      {
        id: "m",
        path: "a.ts",
        start: 1,
        end: 3,
        side: "additions",
        revision: "r1",
      } as never,
    ],
    diagnostics: [
      { path: "a.ts", line: 3, severity: "error" } as never,
      { path: "a.ts", severity: "error" } as never,
    ],
    composer: { id: "d2", line: 8, side: "deletions" },
  });
  expect(at(list)).toEqual(["additions:3", "deletions:8"]);
  const [three, box] = list.map((a) => a.metadata);
  expect(three.drafts.map((d) => d.id)).toEqual(["d1"]);
  expect([three.marks.length, three.diagnostics.length]).toEqual([1, 1]);
  expect([three.composer, box.composer]).toEqual([undefined, true]);
});

it("says how a file's checks went", () => {
  const counts = (errors: number) => ({
    hash: "x",
    errors,
    warnings: 0,
    suggestions: 0,
  });
  expect(checkNote("checking", undefined, false)).toBe(
    "Checking local project…",
  );
  expect(checkNote("ready", undefined, false)).toBe(
    "This file is outside the selected compiler configuration",
  );
  expect(checkNote("ready", counts(2), false)).toBe(
    "Local file differs from PR · 2 errors · 0 warnings in local version",
  );
  expect(checkNote("ready", counts(1), true)).toBe(
    "1 error · 0 warnings in this file",
  );
  expect(checkNote("ready", counts(0), true)).toBe(
    "No compiler errors in this file",
  );
});
