import {
  root,
  repo,
  chats,
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

it("refuses a branch that exists and leaves the thread in the project folder", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input(
      `@codex fixture relay move_to_worktree ${JSON.stringify({ branch: "main" })}`,
    ),
  );
  const done = await answered(chat.id, 2);
  expect(done.messages[1].body).toContain("main already exists");
  expect(done.worktree).toBeUndefined();
  expect(git("worktree", "list").trim().split("\n")).toHaveLength(1);
});
