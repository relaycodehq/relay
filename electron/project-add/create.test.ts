import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectFolder } from "./create";
import { createGithubRepo, githubLogin } from "./github";
import { git } from "../git/git";

vi.mock("../git/git", () => ({ git: vi.fn(async () => "sample") }));
vi.mock("./github", () => ({
  githubLogin: vi.fn(),
  createGithubRepo: vi.fn(),
}));
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-create-"));
  vi.clearAllMocks();
  vi.mocked(githubLogin).mockResolvedValue({ path: "gh", login: "sample" });
});
afterEach(async () => rm(dir, { recursive: true, force: true }));
const spec = () => ({
  name: "web",
  location: dir,
  git: true,
  github: true,
  private: true,
});

it("checks cancellation before publication and propagates its signal to every command", async () => {
  const stop = new AbortController();
  await expect(
    createProjectFolder(
      spec(),
      join(dir, "web"),
      (step) => {
        if (step.startsWith("Creating sample/")) stop.abort();
      },
      stop.signal,
    ),
  ).rejects.toThrow(/Cancelled/);
  expect(createGithubRepo).not.toHaveBeenCalled();
  expect(githubLogin).toHaveBeenCalledWith(stop.signal);
  for (const call of vi.mocked(git).mock.calls)
    expect(call[2]).toEqual({ signal: stop.signal });
  expect(await readdir(dir)).toEqual([]);
});

it("waits for publication to stop, preserves the local repo, and reports recovery", async () => {
  const stop = new AbortController();
  let finished = false;
  vi.mocked(createGithubRepo).mockImplementation(
    async (_gh, _dir, _name, _visibility, signal) => {
      expect(signal).toBe(stop.signal);
      stop.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = true;
      throw new Error("Cancelled.");
    },
  );
  await expect(
    createProjectFolder(spec(), join(dir, "web"), () => {}, stop.signal),
  ).rejects.toThrow(/Open a folder/);
  expect(finished).toBe(true);
  expect(await readdir(join(dir, "web"))).toEqual([".gitignore"]);
});

it("does not remove a destination it did not create", async () => {
  const dest = join(dir, "web");
  await mkdir(dest);
  await expect(
    createProjectFolder(spec(), dest, () => {}, new AbortController().signal),
  ).rejects.toThrow();
  expect(await readdir(dir)).toEqual(["web"]);
});
