import { describe, expect, it } from "vitest";
import { linkedFoldersSchema, linksInstructions, threadLinks } from "./links";

describe("threadLinks", () => {
  it("lets a thread's own link override the project's for the same folder", () => {
    const links = threadLinks(
      [
        { path: "/w/api", access: "read", note: "backend" },
        { path: "/w/types", access: "read" },
      ],
      [{ path: "/w/api", access: "write" }],
    );
    expect(links).toEqual([
      { path: "/w/types", access: "read", from: "project" },
      { path: "/w/api", access: "write", from: "thread" },
    ]);
  });

  it("never links the thread's own folder", () => {
    expect(
      threadLinks([{ path: "/w/web", access: "read" }], undefined, "/w/web"),
    ).toEqual([]);
  });
});

it("parses a trailing slash away and refuses the same folder twice", () => {
  expect(
    linkedFoldersSchema.parse([{ path: "/w/api/", access: "read" }]),
  ).toEqual([{ path: "/w/api", access: "read" }]);
  expect(
    linkedFoldersSchema.safeParse([
      { path: "/w/api", access: "read" },
      { path: "/w/api/", access: "write" },
    ]).success,
  ).toBe(false);
  expect(
    linkedFoldersSchema.safeParse([{ path: "w/api", access: "read" }]).success,
  ).toBe(false);
});

it("tells the agent where edits land only when it may make them", () => {
  expect(linksInstructions([])).toBe("");
  const reads = linksInstructions([
    { path: "/w/api", access: "read", note: "the API" },
  ]);
  expect(reads).toContain("- /w/api (read only): the API");
  expect(reads).not.toContain("outside this thread's worktree");
  expect(linksInstructions([{ path: "/w/api", access: "write" }])).toContain(
    "outside this thread's worktree",
  );
});
