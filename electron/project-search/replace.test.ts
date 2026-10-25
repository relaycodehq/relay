import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSearchQuery } from "../../shared/project-search";
import { digest } from "../util/hash";
import { replaceProjectText } from "./replace";

let root: string;
const put = async (path: string, contents: string | Buffer) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents);
  return digest(contents);
};
const read = (path: string) => readFile(join(root, path), "utf8");
const find = (pattern: string, over: Partial<ProjectSearchQuery> = {}) => ({
  pattern,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...over,
});

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-replace-")));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("replaceProjectText", () => {
  it("replaces every match in the files given and reports each", async () => {
    const a = await put("a.ts", "oldName(oldName)\r\nx\n");
    const b = await put("src/b.ts", "// oldname\n");
    const untouched = await put("c.ts", "oldName\n");
    const result = await replaceProjectText(root, find("oldName"), "newName", [
      { path: "a.ts", version: a },
      { path: "src/b.ts", version: b },
    ]);
    expect(await read("a.ts")).toBe("newName(newName)\r\nx\n");
    expect(await read("src/b.ts")).toBe("// newName\n");
    expect(await read("c.ts")).toBe("oldName\n");
    expect(digest(await read("c.ts"))).toBe(untouched);
    expect(result).toEqual({
      replaced: [
        { path: "a.ts", count: 2, version: digest("newName(newName)\r\nx\n") },
        { path: "src/b.ts", count: 1, version: digest("// newName\n") },
      ],
      skipped: [],
    });
  });

  it("refuses a file that changed since the search, and does the others", async () => {
    const stale = await put("stale.ts", "foo\n");
    const fresh = await put("fresh.ts", "foo\n");
    await writeFile(join(root, "stale.ts"), "foo\nsomeone typed this\n");
    const result = await replaceProjectText(root, find("foo"), "bar", [
      { path: "stale.ts", version: stale },
      { path: "fresh.ts", version: fresh },
    ]);
    expect(await read("stale.ts")).toBe("foo\nsomeone typed this\n");
    expect(await read("fresh.ts")).toBe("bar\n");
    expect(result.replaced.map((r) => r.path)).toEqual(["fresh.ts"]);
    expect(result.skipped).toEqual([
      {
        path: "stale.ts",
        reason: "Changed on disk since the search. Search again.",
      },
    ]);
  });

  it("expands capture groups for a regex and keeps $ literal otherwise", async () => {
    const v = await put("r.ts", "get(a) get(b)\n");
    await replaceProjectText(
      root,
      find("get\\((\\w)\\)", { regex: true }),
      "$1.get()",
      [{ path: "r.ts", version: v }],
    );
    expect(await read("r.ts")).toBe("a.get() b.get()\n");
    const w = await put("p.ts", "cost\n");
    await replaceProjectText(root, find("cost"), "$1", [
      { path: "p.ts", version: w },
    ]);
    expect(await read("p.ts")).toBe("$1\n");
  });

  it("honours case and whole-word settings as the search did", async () => {
    const v = await put("w.ts", "use users Use\n");
    await replaceProjectText(
      root,
      find("use", { wholeWord: true, caseSensitive: true }),
      "X",
      [{ path: "w.ts", version: v }],
    );
    expect(await read("w.ts")).toBe("X users Use\n");
  });

  it("reports a file that is gone, binary, read-only or has nothing left", async () => {
    const bin = await put("bin.dat", Buffer.from([0x66, 0x6f, 0x6f, 0]));
    const ro = await put("ro.ts", "foo\n");
    await chmod(join(root, "ro.ts"), 0o444);
    const none = await put("none.ts", "bar\n");
    const result = await replaceProjectText(root, find("foo"), "x", [
      { path: "gone.ts", version: digest("") },
      { path: "bin.dat", version: bin },
      { path: "ro.ts", version: ro },
      { path: "none.ts", version: none },
    ]);
    expect(result.replaced).toEqual([]);
    expect(result.skipped.map((s) => [s.path, s.reason])).toEqual([
      ["gone.ts", "This file is gone."],
      ["bin.dat", "Binary files are not supported here."],
      ["ro.ts", "This file is read-only."],
      ["none.ts", "Nothing left to replace here."],
    ]);
    expect(await read("ro.ts")).toBe("foo\n");
  });

  it("will not follow a link out of the folder", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "relay-out-")));
    try {
      await writeFile(join(outside, "secret.txt"), "foo\n");
      const { symlink } = await import("node:fs/promises");
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
      const result = await replaceProjectText(root, find("foo"), "x", [
        { path: "link.txt", version: digest("foo\n") },
      ]);
      expect(result.replaced).toEqual([]);
      expect(result.skipped[0].reason).toMatch(/Symbolic links/);
      expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("foo\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("names a broken regex before touching anything", async () => {
    const v = await put("a.ts", "foo\n");
    await expect(
      replaceProjectText(root, find("(", { regex: true }), "x", [
        { path: "a.ts", version: v },
      ]),
    ).rejects.toThrow(/Invalid regular expression/);
    expect(await read("a.ts")).toBe("foo\n");
  });
});
