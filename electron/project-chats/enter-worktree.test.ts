import {
  root,
  repo,
  chats,
  projects,
  projectId,
  useProjectChats,
} from "../../tests/fixtures/project-chats-harness";
// An agent moves its thread into a worktree through Relay's tool, the way a
// real one does: the fake Codex calls move_to_worktree over the MCP server
// mid-answer, then edits in the folder it got back.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultAISettings } from "../../shared/settings";
import { StartedThreads } from "../started-threads";
import { serveRelayTools, useRelayMcp, verifyRelayToken } from "../relay-mcp";
vi.mock("../platform/executables");

const secret = "c".repeat(64);
let closeTools: () => Promise<void>;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

useProjectChats({
  prepare: async () => {
    git("branch", "-m", "main");
    await writeFile(join(repo, "README.md"), "Hello\n");
    git("add", ".");
    git(
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-qm",
      "Initial",
    );
  },
});

beforeEach(async () => {
  const serving = serveRelayTools(0, {
    verify: (token) => verifyRelayToken(secret, token),
    call: new StartedThreads(chats).handle,
  });
  await serving.ready;
  closeTools = serving.close;
  const { port } = serving.server.address() as { port: number };
  useRelayMcp({ port, secret });
});

afterEach(async () => {
  useRelayMcp(undefined);
  await closeTools?.();
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});

/** A new thread whose agent moved it with `request`, once it answered. */
async function movedTo(request: { branch: string; uncommitted?: boolean }) {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input(`@codex fixture relay move_to_worktree ${JSON.stringify(request)}`),
  );
  return answered(chat.id, 2);
}

async function answered(id: string, count: number) {
  await vi.waitFor(async () => {
    const chat = await chats.get(id);
    expect(chat.messages).toHaveLength(count);
    expect(chat.messages.at(-1)?.status).toBe("complete");
  });
  return chats.get(id);
}

it("takes the thread, its answer's edits and its next session into the worktree", async () => {
  await writeFile(join(repo, "wip.txt"), "Not committed\n");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input(
      `@codex fixture relay move_to_worktree ${JSON.stringify({ branch: "relay/acp-agents", uncommitted: true })}`,
    ),
  );
  const moved = await answered(chat.id, 2);
  const folder = moved.worktree?.path;
  expect(folder).toBe(join(root, "worktrees", "repo", "acp-agents"));
  expect(moved.worktree?.branch).toBe("relay/acp-agents");
  // The user didn't ask: the composer gets a dot, the thread a line.
  expect(moved.workspaceMoves).toEqual([
    expect.objectContaining({ how: "moved", to: folder, unasked: true }),
  ]);
  expect(git("worktree", "list")).toContain(folder);
  // The copy went along and the project folder kept its own.
  expect(await readFile(join(folder!, "wip.txt"), "utf8")).toBe(
    "Not committed\n",
  );
  expect(existsSync(join(repo, "wip.txt"))).toBe(true);
  // The edit made after the move is the answer's, in the worktree.
  expect(moved.messages[1].changes?.map((c) => c.path)).toEqual(["moved.txt"]);
  expect(existsSync(join(repo, "moved.txt"))).toBe(false);
  const summary = chats.list(projectId).find((c) => c.id === chat.id);
  expect(summary?.branch).toBe("relay/acp-agents");

  await chats.send(chat.id, input("@codex fixture echo: still here"));
  await answered(chat.id, 4);
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(calls.filter((c) => c.thread).at(-1).thread.cwd).toBe(folder);
});

it("joins the worktree another thread works in on that branch", async () => {
  const first = await movedTo({ branch: "feature" });
  const folder = first.worktree?.path;

  const joined = await movedTo({ branch: "feature" });
  expect(joined.worktree?.path).toBe(folder);
  expect(joined.worktree?.branch).toBe("feature");
  expect(joined.messages[1].body).toContain("sharedWithThreads");
  // The folder Relay made for the first thread was set up already.
  expect(joined.messages[1].body).not.toContain("setupCommand");
  expect(git("worktree", "list").trim().split("\n")).toHaveLength(2);
  // Cleaning up after the first thread leaves the folder to the second.
  const kept = await chats.worktrees.cleanUp(first.id, async () => undefined);
  expect(kept).toBe("another thread works in it");
  expect(existsSync(folder!)).toBe(true);
});

it("hands the agent the setup of a folder made again for a kept branch", async () => {
  await projects.saveSettings(projectId, { worktreeSetup: "echo ready" });
  const first = await movedTo({ branch: "feature" });
  await chats.worktrees.cleanUp(first.id, async () => undefined);
  expect(existsSync(first.worktree!.path!)).toBe(false);

  const second = await movedTo({ branch: "feature" });
  expect(second.messages[1].body).toContain("setupCommand");
  // The first thread finds its branch in the same new folder.
  expect((await chats.get(first.id)).worktree?.path).toBe(
    second.worktree?.path,
  );
});

it("carries a remote branch on under its local name", async () => {
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  git("branch", "shared");
  git("push", "-q", "origin", "shared");
  git("branch", "-D", "shared");

  const moved = await movedTo({ branch: "origin/shared" });
  expect(moved.worktree?.branch).toBe("shared");
  expect(git("branch", "--list", "origin/shared").trim()).toBe("");
});

it("joins a worktree made by hand without taking it over", async () => {
  const folder = join(root, "by-hand");
  git("worktree", "add", "-q", "-b", "by-hand", folder);
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input(
      `@codex fixture relay move_to_worktree ${JSON.stringify({ branch: "by-hand" })}`,
    ),
  );
  const joined = await answered(chat.id, 2);
  expect(joined.worktree?.path).toBe(folder);
  // Relay never removes or renames a folder it didn't make.
  expect(joined.worktree?.adopted).toBe(true);
  expect(existsSync(join(folder, "moved.txt"))).toBe(true);
});

it.each([
  { request: { branch: "main" }, says: "project folder's own branch" },
  { request: { branch: "main~1" }, says: "can't contain ~" },
  {
    request: { branch: "kept", uncommitted: true },
    says: "brings no uncommitted edits along",
  },
])(
  "refuses $request.branch and leaves the thread there",
  async ({ request, says }) => {
    git("branch", "kept");
    git(
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Second",
    );
    const done = await movedTo(request);
    expect(done.messages[1].body).toContain(says);
    expect(done.worktree).toBeUndefined();
    expect(git("worktree", "list").trim().split("\n")).toHaveLength(1);
  },
);
