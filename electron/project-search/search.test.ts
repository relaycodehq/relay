import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSearchQuery } from "../../shared/project-search";
import { digest } from "../util/hash";
import { searchProjectText, type SearchTarget } from "./search";
import { SearchSlots } from "./slots";

let root: string;
const put = async (path: string, contents: string | Buffer) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents);
};
const find = (pattern: string, over: Partial<ProjectSearchQuery> = {}) => ({
  pattern,
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...over,
});
const gitFiles = (): string[] =>
  execFileSync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
const target = (): SearchTarget => ({
  root,
  plain: false,
  files: async () => gitFiles(),
});
const rgPath = (() => {
  try {
    return execFileSync("which", ["rg"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
})();
const live = new AbortController().signal;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-search-")));
  execFileSync("git", ["-C", root, "init", "--quiet"]);
  execFileSync("git", ["-C", root, "config", "core.autocrlf", "false"]);
  await put(".gitignore", "dist/\n*.log\n");
  await put(
    "src/app.ts",
    "const Needle = 1;\n  // needle again, NEEDLE\nnope\n",
  );
  await put("src/useNeedleHook.ts", "export const useNeedleHook = needle;\n");
  await put("src/café.ts", "// ünï needle after multibyte: é😀needle\r\nend\n");
  await put(".config/hidden.txt", "needle in a dotfile\n");
  await put("dist/out.js", "needle in an ignored folder\n");
  await put("debug.log", "needle in an ignored file\n");
  await put("untracked.md", "needle in an untracked file\n");
  await put(
    "bin.dat",
    Buffer.concat([Buffer.from("needle"), Buffer.from([0, 1, 2])]),
  );
  await put("big.txt", "needle " + "x".repeat(3 * 1024 * 1024));
  await put(
    "latin1.txt",
    Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0xe9, 0x0a]),
  );
  await put("regex.txt", "foo123bar\nfoo bar\nfoobar\n");
  execFileSync("git", ["-C", root, "add", "src", ".gitignore", "regex.txt"]);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const run = (
  query: ProjectSearchQuery,
  engine: "rg" | "node",
  over: { timeoutMs?: number; signal?: AbortSignal } = {},
) =>
  searchProjectText(target(), query, over.signal ?? live, {
    rg: engine === "rg" ? rgPath : null,
    timeoutMs: over.timeoutMs,
  });
const summary = (r: Awaited<ReturnType<typeof run>>) =>
  r.files.map((f) => [
    f.path,
    f.matches.map((m) => [m.line, m.column, m.length]),
  ]);

const engines: ("node" | "rg")[] = rgPath ? ["node", "rg"] : ["node"];

describe.each(engines)("searching with %s", (engine) => {
  it("finds matches in tracked, untracked and hidden files, not ignored or binary ones", async () => {
    const r = await run(find("needle"), engine);
    expect(r.engine).toBe(engine === "rg" ? "ripgrep" : "node");
    expect(summary(r)).toEqual([
      [".config/hidden.txt", [[1, 0, 6]]],
      [
        "src/app.ts",
        [
          [1, 6, 6],
          [2, 5, 6],
          [2, 19, 6],
        ],
      ],
      [
        "src/café.ts",
        [
          [1, 7, 6],
          [1, 34, 6],
        ],
      ],
      [
        "src/useNeedleHook.ts",
        [
          [1, 16, 6],
          [1, 29, 6],
        ],
      ],
      ["untracked.md", [[1, 0, 6]]],
    ]);
  });

  it("gives columns in the line's UTF-16 units, which index the line", async () => {
    const r = await run(find("needle"), engine);
    const file = r.files.find((f) => f.path === "src/café.ts")!;
    const line = "// ünï needle after multibyte: é😀needle";
    for (const m of file.matches)
      expect(line.slice(m.column, m.column + m.length).toLowerCase()).toBe(
        "needle",
      );
    expect(file.matches[0].preview).toContain("ünï needle");
    // The \r of a CRLF line is not part of the preview.
    expect(file.matches[1].preview.endsWith("\r")).toBe(false);
  });

  it("matches case on request", async () => {
    const r = await run(find("Needle", { caseSensitive: true }), engine);
    expect(summary(r)).toEqual([
      ["src/app.ts", [[1, 6, 6]]],
      ["src/useNeedleHook.ts", [[1, 16, 6]]],
    ]);
  });

  it("matches words on request", async () => {
    const r = await run(find("needle", { wholeWord: true }), engine);
    // `useNeedleHook` and `useNeedleHook = ` hold the word only as part of a longer one.
    const hook = r.files.find((f) => f.path === "src/useNeedleHook.ts");
    expect(hook?.matches.map((m) => m.column)).toEqual([29]);
  });

  it("runs a regex", async () => {
    const r = await run(find("foo\\d+bar|foo bar", { regex: true }), engine);
    expect(summary(r)).toEqual([
      [
        "regex.txt",
        [
          [1, 0, 9],
          [2, 0, 7],
        ],
      ],
    ]);
  });

  it("ends a CRLF line before its \\r, as replace does", async () => {
    await put("crlf.txt", "a;\r\nb;\n");
    const r = await run(
      find(";$", { regex: true, include: "crlf.txt" }),
      engine,
    );
    expect(summary(r)).toEqual([
      [
        "crlf.txt",
        [
          [1, 1, 1],
          [2, 1, 1],
        ],
      ],
    ]);
  });

  it("treats regex characters literally in a plain query", async () => {
    await put("lit.txt", "a.b a+b\n");
    const r = await run(find("a.b"), engine);
    expect(summary(r).find(([p]) => p === "lit.txt")?.[1]).toEqual([[1, 0, 3]]);
  });

  it("limits the files by include and exclude globs", async () => {
    const only = await run(
      find("needle", { include: "*.md, .config" }),
      engine,
    );
    expect(only.files.map((f) => f.path)).toEqual([
      ".config/hidden.txt",
      "untracked.md",
    ]);
    const without = await run(
      find("needle", { include: "src", exclude: "*Hook.ts, café.ts" }),
      engine,
    );
    expect(without.files.map((f) => f.path)).toEqual(["src/app.ts"]);
  });

  it("leaves ignored files out even when a mask names them", async () => {
    const r = await run(find("needle", { include: "*.log, dist" }), engine);
    expect(r.files).toEqual([]);
  });

  it("counts only matches in files the masks let through toward the limit", async () => {
    const r = await run(
      find("needle", { include: "untracked.md", limit: 1 }),
      engine,
    );
    expect(summary(r)).toEqual([["untracked.md", [[1, 0, 6]]]]);
  });

  it("stops at the limit and says so", async () => {
    const r = await run(find("needle", { limit: 3 }), engine);
    const total = r.files.reduce((n, f) => n + f.matches.length, 0);
    expect(total).toBe(3);
    expect(r.truncated).toBe(true);
    const all = await run(find("needle", { limit: 100 }), engine);
    expect(all.truncated).toBe(false);
  });

  it("hands back the digest of each file as searched", async () => {
    const r = await run(find("foo bar"), engine);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].version).toBe(digest("foo123bar\nfoo bar\nfoobar\n"));
  });

  it("finds nothing quietly", async () => {
    const r = await run(find("zzzzzz"), engine);
    expect(r).toMatchObject({ files: [], truncated: false });
  });

  it("drops its results when cancelled", async () => {
    const stop = new AbortController();
    const pending = run(find("needle"), engine, { signal: stop.signal });
    stop.abort();
    expect(await pending).toMatchObject({ files: [], cancelled: true });
  });
});

describe("the Node fallback", () => {
  it("skips binary files, files over 2 MiB, files that are not UTF-8, and links", async () => {
    await symlink(join(root, "untracked.md"), join(root, "link.md"));
    const files = [
      ...gitFiles(),
      "bin.dat",
      "big.txt",
      "latin1.txt",
      "link.md",
    ];
    const r = await searchProjectText(
      { root, plain: false, files: async () => files },
      find("need"),
      live,
      { rg: null },
    );
    const paths = r.files.map((f) => f.path);
    expect(paths).not.toContain("bin.dat");
    expect(paths).not.toContain("big.txt");
    expect(paths).not.toContain("latin1.txt");
    expect(paths).not.toContain("link.md");
    expect(paths).toContain("untracked.md");
  });

  it("copes with a listed file that is gone", async () => {
    const r = await searchProjectText(
      { root, plain: false, files: async () => ["ghost.ts", "src/app.ts"] },
      find("nope"),
      live,
      { rg: null },
    );
    expect(r.files.map((f) => f.path)).toEqual(["src/app.ts"]);
  });

  it("names a broken regex", async () => {
    await expect(
      searchProjectText(target(), find("(", { regex: true }), live, {
        rg: null,
      }),
    ).rejects.toThrow(/Invalid regular expression/);
  });

  it("stops at its time limit with what it has", async () => {
    const r = await searchProjectText(target(), find("needle"), live, {
      rg: null,
      timeoutMs: -1,
    });
    expect(r.truncated).toBe(true);
  });
});

describe.skipIf(!rgPath)("ripgrep", () => {
  it("falls back to JavaScript for a pattern Rust's regex has no syntax for", async () => {
    const r = await run(find("foo(?=\\d)", { regex: true }), "rg");
    expect(r.engine).toBe("node");
    expect(summary(r)).toEqual([["regex.txt", [[1, 0, 3]]]]);
  });

  it("falls back when the executable is gone", async () => {
    const r = await searchProjectText(target(), find("nope"), live, {
      rg: join(root, "no-such-rg"),
    });
    expect(r.engine).toBe("node");
    expect(r.files).toHaveLength(1);
  });

  it("refuses a pattern neither engine takes, in words", async () => {
    await expect(run(find("(", { regex: true }), "rg")).rejects.toThrow(
      /Invalid regular expression/,
    );
  });

  it("gives a bad glob back as an error", async () => {
    await expect(run(find("needle", { exclude: "[" }), "rg")).rejects.toThrow(
      /glob/,
    );
  });

  it.skipIf(process.platform === "win32")(
    "drops a file written after ripgrep read it, so replace can't trust a new digest",
    async () => {
      const lateRg = join(root, "late-rg.sh");
      await writeFile(
        lateRg,
        `#!/bin/sh\n"${rgPath}" "$@"\ncode=$?\necho needle >> src/app.ts\nexit $code\n`,
        { mode: 0o755 },
      );
      const r = await searchProjectText(target(), find("needle"), live, {
        rg: lateRg,
      });
      expect(r.engine).toBe("ripgrep");
      expect(r.files.map((f) => f.path)).not.toContain("src/app.ts");
      expect(r.files.map((f) => f.path)).toContain("untracked.md");
    },
  );

  it("searches a plain folder without node_modules", async () => {
    const plainRoot = await realpath(
      await mkdtemp(join(tmpdir(), "relay-plain-")),
    );
    try {
      await mkdir(join(plainRoot, "node_modules/x"), { recursive: true });
      await writeFile(join(plainRoot, "node_modules/x/i.js"), "needle\n");
      await writeFile(join(plainRoot, "a.txt"), "needle\n");
      const r = await searchProjectText(
        { root: plainRoot, plain: true, files: async () => [] },
        find("needle"),
        live,
        { rg: rgPath },
      );
      expect(r.files.map((f) => f.path)).toEqual(["a.txt"]);
    } finally {
      await rm(plainRoot, { recursive: true, force: true });
    }
  });
});

describe("SearchSlots", () => {
  it("cancels the previous search in the same slot only", () => {
    const slots = new SearchSlots();
    const first = slots.start("1:panel");
    const other = slots.start("1:palette");
    const second = slots.start("1:panel");
    expect(first.aborted).toBe(true);
    expect(other.aborted).toBe(false);
    expect(second.aborted).toBe(false);
  });

  it("does not let a finished search free a slot a newer one holds", () => {
    const slots = new SearchSlots();
    const first = slots.start("w:s");
    const second = slots.start("w:s");
    slots.finish("w:s", first);
    slots.cancel("w:s");
    expect(second.aborted).toBe(true);
  });
});
