import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkNewLinks, expandHome, folderPreview } from "./folder-inspect";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-links-")));
  await mkdir(join(dir, "backend"));
  await mkdir(join(dir, "web"));
});

afterEach(async () => rm(dir, { recursive: true, force: true }));
const link = (path: string) => ({ path, access: "read" as const });

it("previews a bounded mix of folders and files without reading their contents", async () => {
  for (const name of ["src", "tests", "docs", "node_modules", ".git"])
    await mkdir(join(dir, name));
  for (const name of [
    "README.md",
    "package.json",
    "vite.config.ts",
    "LICENSE",
    ".env",
  ])
    await writeFile(join(dir, name), "sample");
  const preview = await folderPreview(dir);
  expect(preview.entries).toHaveLength(6);
  expect(preview.entries.filter((e) => e.directory)).toHaveLength(3);
  expect(preview.entries.filter((e) => !e.directory)).toHaveLength(3);
  expect(preview.remaining).toBe(3);
  expect(
    preview.entries.some(
      (e) => e.name.startsWith(".") || e.name === "node_modules",
    ),
  ).toBe(false);
});

it("previews empty folders and surfaces unreadable paths", async () => {
  expect(await folderPreview(join(dir, "web"))).toEqual({
    entries: [],
    remaining: 0,
  });
  await expect(folderPreview(join(dir, "missing"))).rejects.toThrow();
});

it.skipIf(process.platform === "win32")(
  "refuses a Windows path another computer sent instead of making a folder named after it",
  () => {
    expect(() => expandHome("~\\work")).toThrow("Windows path");
    expect(() => expandHome("\\\\server\\share")).toThrow("Windows path");
    expect(expandHome("/srv/work")).toBe("/srv/work");
  },
);

it("persists a canonical path and rejects duplicate symlink and dot-segment identities", async () => {
  const target = join(dir, "backend");
  const alias = join(dir, "alias");
  await symlink(target, alias, "junction");
  expect(await checkNewLinks([link(alias)], undefined)).toEqual([link(target)]);
  await expect(
    checkNewLinks([link(target), link(alias)], undefined),
  ).rejects.toThrow(/linked already/);
  await expect(
    checkNewLinks([link(target), link(`${dir}/web/../backend`)], undefined),
  ).rejects.toThrow(/linked already/);
});

it("rejects aliases of the project's own folder", async () => {
  const own = join(dir, "web");
  const alias = join(dir, "own-alias");
  await symlink(own, alias, "junction");
  await expect(checkNewLinks([link(alias)], undefined, own)).rejects.toThrow(
    /own folder/,
  );
});

it("retains saved missing folders but rejects new missing ones", async () => {
  const saved = link(join(dir, "missing"));
  expect(await checkNewLinks([saved], [saved])).toEqual([saved]);
  await expect(checkNewLinks([saved], undefined)).rejects.toThrow(
    /isn't there/,
  );
});

it("collapses casing aliases when the filesystem treats them as the same folder", async () => {
  const target = join(dir, "backend");
  const alias = join(dir, "BACKEND");
  if ((await realpath(alias).catch(() => undefined)) !== target) return;
  await expect(
    checkNewLinks([link(target), link(alias)], undefined),
  ).rejects.toThrow(/linked already/);
});
