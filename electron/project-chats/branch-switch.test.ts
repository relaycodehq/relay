import {
  root,
  repo,
  chats,
  projectId,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
// The user picks a branch in a started thread's branch control: the thread
// goes wherever that branch is worked on, never refused for where it is.
import { it, expect, vi } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultAISettings } from "../../shared/settings";
import type { WorktreeStart } from "../../shared/projects";
import type { ChatCore } from "./core";
vi.mock("../platform/executables");

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const gitIn = (folder: string, ...args: string[]) =>
  execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" }).trim();
const commit = (folder: string, message: string) =>
  gitIn(
    folder,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-qam",
    message,
  );

useProjectChats({
  prepare: async () => {
    git("branch", "-m", "main");
    await writeFile(join(repo, "README.md"), "Hello\n");
    git("add", ".");
    commit(repo, "Initial");
  },
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});

async function answered(id: string, count: number) {
  await vi.waitFor(async () => {
    const chat = await chats.get(id);
    expect(chat.messages).toHaveLength(count);
    expect(chat.messages.at(-1)?.status).toBe("complete");
  });
  return chats.get(id);
}

/** A thread that answered once, in the project folder or a worktree. */
async function thread(
  workspace: "checkout" | "worktree",
  start?: WorktreeStart,
) {
  const chat = await chats.create(
    projectId,
    { kind: "project" },
    workspace,
    undefined,
    undefined,
    undefined,
    start,
  );
  await chats.send(chat.id, input("@codex fixture echo: hi"));
  return answered(chat.id, 2);
}

/** The folder the thread's next answer starts in. */
async function nextCwd(id: string) {
  const count = (await chats.get(id)).messages.length;
  await chats.send(id, input("@codex fixture echo: where now"));
  await answered(id, count + 2);
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return calls.filter((c) => c.thread).at(-1).thread.cwd;
}

it("moves a project-folder thread into the worktree another thread has the branch in", async () => {
  git("branch", "feature");
  const owner = await thread("worktree", { on: "feature" });
  const folder = owner.worktree!.path!;
  const chat = await thread("checkout");

  const summary = await chats.worktrees.branches.workOn(chat.id, "feature");

  expect(summary.worktree?.path).toBe(folder);
  const moved = await chats.get(chat.id);
  expect(moved.workspaceMoves?.at(-1)).toMatchObject({
    how: "switched",
    to: folder,
    branch: "feature",
  });
  expect(await nextCwd(chat.id)).toBe(folder);
  // The project folder stayed on its own branch.
  expect(gitIn(repo, "branch", "--show-current")).toBe("main");
});

it("switches a worktree thread's own folder to a branch no one has, dropping its unused branch", async () => {
  git("branch", "other");
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  const made = chat.worktree!.branch!;

  await chats.worktrees.branches.workOn(chat.id, "other");

  const moved = await chats.get(chat.id);
  expect(moved.worktree).toMatchObject({
    path: folder,
    branch: "other",
    existing: true,
  });
  expect(gitIn(folder, "branch", "--show-current")).toBe("other");
  expect(git("branch", "--list", made).trim()).toBe("");
  expect(await nextCwd(chat.id)).toBe(folder);
});

it("takes a worktree thread back to the project folder, leaving its folder as it is", async () => {
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  const made = chat.worktree!.branch!;
  // Like a hand-copied .env: removing the folder would lose it.
  await writeFile(join(folder, ".env"), "SECRET=1\n");
  await writeFile(join(folder, "wip.txt"), "Not committed\n");

  await chats.worktrees.branches.workOn(chat.id, "main");

  const back = await chats.get(chat.id);
  expect(back.worktree).toBeUndefined();
  expect(back.workspaceMoves?.at(-1)).toMatchObject({ how: "switched" });
  expect(await readFile(join(folder, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(await readFile(join(folder, "wip.txt"), "utf8")).toBe(
    "Not committed\n",
  );
  expect(gitIn(folder, "branch", "--show-current")).toBe(made);
  expect(await nextCwd(chat.id)).toBe(repo);
});

it("gets a worktree of its own on the branch when its folder holds work, which stays there", async () => {
  git("branch", "other");
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  await writeFile(join(folder, "wip.txt"), "Mine\n");

  await chats.worktrees.branches.workOn(chat.id, "other");

  const moved = await chats.get(chat.id);
  expect(moved.worktree?.branch).toBe("other");
  expect(moved.worktree?.path).not.toBe(folder);
  expect(gitIn(moved.worktree!.path!, "branch", "--show-current")).toBe(
    "other",
  );
  expect(existsSync(join(moved.worktree!.path!, "wip.txt"))).toBe(false);
  expect(await readFile(join(folder, "wip.txt"), "utf8")).toBe("Mine\n");
  expect(await nextCwd(chat.id)).toBe(moved.worktree!.path);
});

it("carries a remote-only branch on from a worktree thread", async () => {
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  git("branch", "shared");
  git("push", "-q", "origin", "shared");
  git("branch", "-D", "shared");
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;

  await chats.worktrees.branches.workOn(chat.id, "origin/shared");

  const moved = await chats.get(chat.id);
  expect(moved.worktree?.branch).toBe("shared");
  expect(gitIn(moved.worktree!.path!, "branch", "--show-current")).toBe(
    "shared",
  );
  // Its folder was clean and its own, so it went to the branch itself.
  expect(moved.worktree?.path).toBe(folder);
});

it("carries a remote-only branch on from a project-folder thread", async () => {
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  git("branch", "shared");
  git("push", "-q", "origin", "shared");
  git("branch", "-D", "shared");
  const chat = await thread("checkout");

  await chats.worktrees.branches.workOn(chat.id, "origin/shared");

  const moved = await chats.get(chat.id);
  expect(moved.worktree?.branch).toBe("shared");
  expect(gitIn(repo, "branch", "--show-current")).toBe("main");
});

it("keeps a branch it leaves when nothing else holds that branch's commits", async () => {
  git("switch", "-q", "-c", "feature");
  await writeFile(join(repo, "README.md"), "Feature\n");
  commit(repo, "Feature");
  git("switch", "-q", "main");
  git("branch", "other");
  const chat = await thread("worktree", { off: "feature" });
  const made = chat.worktree!.branch!;
  git("branch", "-D", "feature");

  await chats.worktrees.branches.workOn(chat.id, "other");

  expect(gitIn(chat.worktree!.path!, "branch", "--show-current")).toBe("other");
  expect(git("log", "-1", "--format=%s", made).trim()).toBe("Feature");
});

it("switches its folder back to its branch after the agent switched it elsewhere", async () => {
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  const made = chat.worktree!.branch!;
  gitIn(folder, "switch", "-q", "-c", "side");

  await chats.worktrees.branches.workOn(chat.id, made);

  expect(gitIn(folder, "branch", "--show-current")).toBe(made);
});

it("refuses a branch whose local name Git would read as an option", async () => {
  git("remote", "add", "origin", join(root, "nowhere.git"));
  git("update-ref", "refs/remotes/origin/-Cvictim", "HEAD");
  const chat = await thread("worktree");

  await expect(
    chats.worktrees.branches.workOn(chat.id, "origin/-Cvictim"),
  ).rejects.toThrow("There's no branch origin/-Cvictim.");
});

it("waits for a thread's background work before moving it", async () => {
  git("branch", "other");
  const chat = await thread("worktree");
  const { storage } = (chats as unknown as { core: ChatCore }).core;
  const held = await storage.load(chat.id);
  held.heldWakeups = [{ id: "wake", prompt: "continue", at: 123 }];
  await storage.save(held);

  await expect(
    chats.worktrees.branches.workOn(chat.id, "other"),
  ).rejects.toThrow("background work");
  expect((await chats.get(chat.id)).worktree?.branch).toBe(
    chat.worktree!.branch,
  );
});

it("refuses a branch that isn't there and leaves the thread where it was", async () => {
  const chat = await thread("checkout");
  await expect(
    chats.worktrees.branches.workOn(chat.id, "nope"),
  ).rejects.toThrow("There's no branch nope.");
  expect((await chats.get(chat.id)).worktree).toBeUndefined();
});
