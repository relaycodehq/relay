import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
let userData: string;
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-video-")));
  userData = await mkdtemp(join(tmpdir(), "relay-video-data-"));
  git("init", "-q", "-b", "main");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

it("plays both sides of a renamed video, copied out of git once", async () => {
  const { videoSides } = await import("./video-pair");
  await writeFile(join(root, "clip.mp4"), Buffer.alloc(4096, 1));
  git("add", "clip.mp4");
  const sha = git("rev-parse", ":clip.mp4");
  const videos = await videoSides(
    root,
    { name: "clip.mp4", spec: sha },
    { name: "renamed.mp4", spec: sha },
  );
  expect(videos?.old).toMatch(/^relay-media:/);
  expect(videos?.next).toBe(videos?.old);
  expect(await readdir(join(userData, "cache", "video-blobs"))).toEqual([
    `${sha}.mp4`,
  ]);
});
