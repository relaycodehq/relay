import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  open,
  stat,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
  utimes,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { setGitPath } from "./git";

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
  setGitPath(null);
  vi.restoreAllMocks();
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

it.skipIf(process.platform === "win32")(
  "streams exact bytes for both sides and reuses the immutable cache",
  async () => {
    const { videoSides } = await import("./video-pair");
    const bytes = Buffer.from(
      Array.from({ length: 131_073 }, (_, n) => n % 251),
    );
    await writeFile(join(root, "clip.mp4"), bytes);
    git("add", "clip.mp4");
    const sha = git("rev-parse", ":clip.mp4");
    const calls = await instrumentGit();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        videoSides(
          root,
          { name: "clip.mp4", spec: sha },
          { name: "clip.mp4", spec: sha },
        ),
      ),
    );
    const cache = join(userData, "cache", "video-blobs", `${sha}.mp4`);
    expect(await readFile(cache)).toEqual(bytes);
    expect(await calls()).toEqual(["blob"]);
    await videoSides(root, { name: "clip.mp4", spec: sha }, null);
    expect(await calls()).toEqual(["blob"]);
  },
);

async function instrumentGit(body?: string, size?: number) {
  const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const calls = join(userData, "calls");
  const wrapper = join(userData, "configured-git");
  await writeFile(
    wrapper,
    `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
${size === undefined ? "" : `if (args[2] === "cat-file" && args[3] === "-s") { process.stdout.write("${size}"); process.exit(0); }`}
if (args[2] === "cat-file" && args[3] === "blob") {
  appendFileSync(${JSON.stringify(calls)}, "blob\\n");
  if (process.env.GIT_TERMINAL_PROMPT !== "0" || process.env.GIT_OPTIONAL_LOCKS !== "0" || process.env.GIT_LITERAL_PATHSPECS !== "1" || process.env.GCM_INTERACTIVE !== "never") process.exit(17);
  ${body ?? ""}
}
const result = spawnSync(${JSON.stringify(actualGit)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    { mode: 0o700 },
  );
  setGitPath(wrapper);
  return async () =>
    (await readFile(calls, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean);
}

it.skipIf(process.platform === "win32")(
  "cleans failed streams and retries without a poisoned cache",
  async () => {
    const { videoSides } = await import("./video-pair");
    await writeFile(join(root, "clip.mp4"), "content");
    git("add", ".");
    const sha = git("rev-parse", ":clip.mp4");
    await instrumentGit(
      'process.stdout.write("partial"); process.stderr.write("https://secret@example.com failed"); process.exit(1);',
    );
    expect(
      await videoSides(root, { name: "clip.mp4", spec: sha }, null),
    ).toBeUndefined();
    expect(await readdir(join(userData, "cache", "video-blobs"))).toEqual([]);
    setGitPath(null);
    expect(
      (await videoSides(root, { name: "clip.mp4", spec: sha }, null))?.old,
    ).toMatch(/^relay-media:/);
    expect(
      await readFile(
        join(userData, "cache", "video-blobs", `${sha}.mp4`),
        "utf8",
      ),
    ).toBe("content");
  },
);

it.skipIf(process.platform === "win32")(
  "enforces the streamed cap even when the size query understates output",
  async () => {
    const { videoSides } = await import("./video-pair");
    await writeFile(join(root, "clip.mp4"), "content");
    git("add", ".");
    const sha = git("rev-parse", ":clip.mp4");
    await instrumentGit(`
    const chunk = Buffer.alloc(64 * 1024, 1);
    async function flood() { for (let n = 0; n < 3300; n++) {
      if (!process.stdout.write(chunk)) await new Promise((done) => process.stdout.once("drain", done));
    } }
    flood().then(() => process.exit(0));
    return;
  `);
    expect(
      await videoSides(root, { name: "clip.mp4", spec: sha }, null),
    ).toBeUndefined();
    expect(await readdir(join(userData, "cache", "video-blobs"))).toEqual([]);
  },
);

it.skipIf(process.platform === "win32")(
  "times out stalled Git, kills it and removes its partial output",
  async () => {
    const { videoSides } = await import("./video-pair");
    await writeFile(join(root, "clip.mp4"), "content");
    git("add", ".");
    const sha = git("rev-parse", ":clip.mp4");
    await instrumentGit(
      'process.stdout.write("partial"); setInterval(() => {}, 1000); return;',
    );
    const timeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: Parameters<typeof setTimeout>[0],
      ms?: number,
      ...args: unknown[]
    ) =>
      timeout(
        callback,
        ms === 15_000 ? 1000 : ms,
        ...args,
      )) as typeof setTimeout);
    expect(
      await videoSides(root, { name: "clip.mp4", spec: sha }, null),
    ).toBeUndefined();
    expect(await readdir(join(userData, "cache", "video-blobs"))).toEqual([]);
  },
);

it("keeps memory bounded while streaming a large committed video", async () => {
  const { videoSides } = await import("./video-pair");
  const source = join(root, "large.mp4");
  const handle = await open(source, "w");
  await handle.truncate(96 * 1024 * 1024);
  await handle.close();
  git("add", "large.mp4");
  const sha = git("rev-parse", ":large.mp4");
  const baseline = process.memoryUsage().arrayBuffers;
  let peak = baseline;
  const sample = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
  }, 1);
  try {
    const videos = await videoSides(
      root,
      { name: "large.mp4", spec: sha },
      { name: "renamed.mp4", spec: sha },
    );
    expect(videos?.old).toBe(videos?.next);
    expect(videos?.old).toMatch(/^relay-media:/);
  } finally {
    clearInterval(sample);
  }
  const cached = join(userData, "cache", "video-blobs", `${sha}.mp4`);
  expect((await stat(cached)).size).toBe(96 * 1024 * 1024);
  const digest = async (path: string) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  };
  expect(await digest(cached)).toBe(await digest(source));
  // The former execFile buffer required at least one entire 96 MiB blob.
  expect(peak - baseline).toBeLessThan(64 * 1024 * 1024);
});

it.skipIf(process.platform === "win32")(
  "rejects known oversized blobs before streaming or creating cache files",
  async () => {
    const { videoSides } = await import("./video-pair");
    await writeFile(join(root, "clip.mp4"), "content");
    git("add", ".");
    const sha = git("rev-parse", ":clip.mp4");
    const calls = await instrumentGit(undefined, 200 * 1024 * 1024 + 1);
    expect(
      await videoSides(root, { name: "clip.mp4", spec: sha }, null),
    ).toBeUndefined();
    expect(await calls()).toEqual([]);
    expect(
      await readdir(join(userData, "cache", "video-blobs")).catch(() => []),
    ).toEqual([]);
  },
);

it.skipIf(process.platform === "win32")(
  "does not publish a truncated blob even when Git exits successfully",
  async () => {
    const { videoSides } = await import("./video-pair");
    await writeFile(join(root, "clip.mp4"), "content");
    git("add", ".");
    const sha = git("rev-parse", ":clip.mp4");
    await instrumentGit('process.stdout.write("cut"); process.exit(0);');
    expect(
      await videoSides(root, { name: "clip.mp4", spec: sha }, null),
    ).toBeUndefined();
    expect(await readdir(join(userData, "cache", "video-blobs"))).toEqual([]);
  },
);

it("prunes stale partial copies while keeping active copies and the just-published blob", async () => {
  const { videoSides } = await import("./video-pair");
  const dir = join(userData, "cache", "video-blobs");
  await mkdir(dir, { recursive: true });
  const stale = join(dir, "stale.part"),
    active = join(dir, "active.part");
  for (const path of [stale, active]) {
    const file = await open(path, "w");
    await file.truncate(1024 * 1024 * 1024);
    await file.close();
  }
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(stale, past, past);
  await writeFile(join(root, "clip.mp4"), "content");
  git("add", ".");
  const sha = git("rev-parse", ":clip.mp4");
  expect(
    (await videoSides(root, { name: "clip.mp4", spec: sha }, null))?.old,
  ).toMatch(/^relay-media:/);
  await vi.waitFor(async () =>
    expect(await readdir(dir)).toEqual(
      expect.arrayContaining(["active.part", `${sha}.mp4`]),
    ),
  );
  await vi.waitFor(async () =>
    expect(await readdir(dir)).not.toContain("stale.part"),
  );
});
