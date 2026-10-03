import { describe, expect, it } from "vitest";
import type { DirListing } from "../../shared/project-files";
import { ancestors, formatSize, treeRows } from "./file-tree";

const entry = (
  name: string,
  kind: "file" | "dir" = "file",
  ignored = false,
) => ({
  name,
  kind,
  size: 1,
  mtime: 0,
  ignored,
});
const listings: Record<string, DirListing> = {
  "": {
    entries: [entry("src", "dir"), entry("out", "dir", true), entry("a.md")],
    truncated: false,
  },
  src: { entries: [entry("lib", "dir"), entry("main.ts")], truncated: false },
  "src/lib": { entries: [entry("x.ts")], truncated: false },
};

describe("treeRows", () => {
  it("puts each open folder's entries under it, indented, and leaves closed ones shut", () => {
    const rows = treeRows((d) => listings[d], new Set(["src", "src/lib"]));
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["src", 0],
      ["src/lib", 1],
      ["src/lib/x.ts", 2],
      ["src/main.ts", 1],
      ["out", 0],
      ["a.md", 0],
    ]);
    expect(rows.find((r) => r.path === "out")).toMatchObject({
      ignored: true,
      open: false,
    });
  });

  it("marks an open folder whose listing hasn't arrived", () => {
    const rows = treeRows((d) => listings[d], new Set(["out"]));
    expect(rows.find((r) => r.path === "out")).toMatchObject({
      open: true,
      loading: true,
    });
  });

  it("only opens folders, not files that share a path with an open one", () => {
    const rows = treeRows((d) => listings[d], new Set(["a.md"]));
    expect(rows.find((r) => r.path === "a.md")?.open).toBe(false);
  });
});

describe("helpers", () => {
  it("lists the folders above a path, outermost first", () => {
    expect(ancestors("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestors("c.ts")).toEqual([]);
  });

  it("writes sizes the way a file manager does", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(48213)).toBe("47 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
