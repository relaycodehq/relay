import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkNewLinks } from "./folder-inspect";

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-links-")));
  await mkdir(join(dir, "backend"));
  await mkdir(join(dir, "web"));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));
const link = (path: string) => ({ path, access: "read" as const });

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
