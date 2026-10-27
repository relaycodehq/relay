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
async function thread(workspace: "checkout" | "worktree", start?: WorktreeStart) {
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

it("takes a worktree thread back to the project folder, its clean folder removed", async () => {
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  const made = chat.worktree!.branch!;

  await chats.worktrees.branches.workOn(chat.id, "main");

  const back = await chats.get(chat.id);
  // It never got a commit, so nothing is lost with it.
  expect(git("branch", "--list", made).trim()).toBe("");
  expect(back.worktree).toBeUndefined();
  expect(back.workspaceMoves?.at(-1)).toMatchObject({ how: "switched" });
  expect(existsSync(folder)).toBe(false);
  expect(await nextCwd(chat.id)).toBe(repo);
});

it("leaves a folder with uncommitted edits as it is when its thread goes", async () => {
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  await writeFile(join(folder, "wip.txt"), "Not committed\n");

  await chats.worktrees.branches.workOn(chat.id, "main");

  expect((await chats.get(chat.id)).worktree).toBeUndefined();
  expect(await readFile(join(folder, "wip.txt"), "utf8")).toBe(
    "Not committed\n",
  );
});

it("gets a worktree of its own on the branch when Git won't switch over edits in the way", async () => {
  git("switch", "-q", "-c", "other");
  await writeFile(join(repo, "README.md"), "Other\n");
  commit(repo, "Other");
  git("switch", "-q", "main");
  const chat = await thread("worktree");
  const folder = chat.worktree!.path!;
  await writeFile(join(folder, "README.md"), "Mine\n");

  await chats.worktrees.branches.workOn(chat.id, "other");

  const moved = await chats.get(chat.id);
  expect(moved.worktree?.branch).toBe("other");
  expect(moved.worktree?.path).not.toBe(folder);
  expect(gitIn(moved.worktree!.path!, "branch", "--show-current")).toBe(
    "other",
  );
  // The edit Git wouldn't carry over stays where it was made.
  expect(await readFile(join(folder, "README.md"), "utf8")).toBe("Mine\n");
});

it("refuses a branch that isn't there and leaves the thread where it was", async () => {
  const chat = await thread("checkout");
  await expect(
    chats.worktrees.branches.workOn(chat.id, "nope"),
  ).rejects.toThrow("There's no branch nope.");
  expect((await chats.get(chat.id)).worktree).toBeUndefined();
});
