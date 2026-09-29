import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEntry,
  fileInfo,
  listDirectory,
  readImage,
  renameEntry,
} from "../../electron/project-files";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const put = async (path: string, contents: string | Buffer = "x") => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents);
};
const exists = (path: string) =>
  stat(join(root, path)).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-project-files-")));
  git("init", "--quiet");
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("listDirectory", () => {
  it("lists a folder from disk, folders first, with ignored files marked", async () => {
    await put(".gitignore", "output/\n*.log\n");
    await put("output/redesign/a.png");
    await put("src/main.ts");
    await put("b.log");
    await put("readme.md");
    const { entries } = await listDirectory(root, "", false);
    expect(entries.map((e) => [e.name, e.kind, e.ignored])).toEqual([
      ["output", "dir", true],
      ["src", "dir", false],
      [".gitignore", "file", false],
      ["b.log", "file", true],
      ["readme.md", "file", false],
    ]);
    // Files inside an ignored folder are still browsable.
    const inner = await listDirectory(root, "output/redesign", false);
    expect(inner.entries.map((e) => e.name)).toEqual(["a.png"]);
  });

  it("hides .git and shows links as links without following them", async () => {
    await put("real/file.txt");
    await symlink(join(root, "real"), join(root, "shortcut"));
    const { entries } = await listDirectory(root, "", false);
    expect(entries.map((e) => e.name)).not.toContain(".git");
    expect(entries.find((e) => e.name === "shortcut")?.kind).toBe("link");
    await expect(listDirectory(root, "shortcut", false)).rejects.toThrow(
      /Symbolic links/,
    );
  });

  it("refuses paths that leave the checkout or reach Git's folder", async () => {
    await expect(listDirectory(root, "../", false)).rejects.toThrow();
    await expect(listDirectory(root, ".git", false)).rejects.toThrow();
  });
});

describe("fileInfo", () => {
  it("tells text, images and everything else apart", async () => {
    await put("a.ts", "export {};\n");
    await put("pic.PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await put("blob.bin", Buffer.from([1, 2, 0, 3]));
    await put("latin.txt", Buffer.from([0xe9, 0xe8]));
    expect((await fileInfo(root, "a.ts")).kind).toBe("text");
    expect(await fileInfo(root, "pic.PNG")).toMatchObject({
      kind: "image",
      mime: "image/png",
    });
    expect(await fileInfo(root, "blob.bin")).toMatchObject({
      kind: "other",
      reason: expect.stringMatching(/Binary/),
    });
    expect((await fileInfo(root, "latin.txt")).reason).toMatch(/UTF-8/);
  });

  it("reads an image as a data URL and nothing else", async () => {
    await put("pic.svg", "<svg/>");
    await put("a.ts");
    expect(await readImage(root, "pic.svg")).toBe(
      `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
    );
    await expect(readImage(root, "a.ts")).rejects.toThrow(/not an image/);
  });
});

describe("createEntry and renameEntry", () => {
  it("creates files and folders but never replaces one", async () => {
    await createEntry(root, "notes.md", "file");
    await createEntry(root, "docs", "dir");
    await createEntry(root, "docs/todo.md", "file");
    expect(await readFile(join(root, "docs/todo.md"), "utf8")).toBe("");
    await expect(createEntry(root, "notes.md", "file")).rejects.toThrow(
      /already exists/,
    );
    await expect(createEntry(root, "nope/x.md", "file")).rejects.toThrow(
      /doesn’t exist/,
    );
  });

  it("renames and moves, refusing to overwrite or nest a folder in itself", async () => {
    await put("a/one.txt", "1");
    await put("two.txt", "2");
    await renameEntry(root, "a/one.txt", "one.txt");
    expect(await exists("one.txt")).toBe(true);
    await expect(renameEntry(root, "one.txt", "two.txt")).rejects.toThrow(
      /already exists/,
    );
    await expect(renameEntry(root, "a", "a/inner")).rejects.toThrow(/itself/);
    await renameEntry(root, "a", "b");
    expect(await exists("b")).toBe(true);
    expect(await readFile(join(root, "two.txt"), "utf8")).toBe("2");
  });

  it("allows a case-only rename", async () => {
    await put("readme.md");
    await renameEntry(root, "readme.md", "README.md");
    expect(await exists("README.md")).toBe(true);
  });
});
