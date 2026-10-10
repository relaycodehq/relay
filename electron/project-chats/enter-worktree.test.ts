// An agent moves its thread into a worktree through Relay's tool, the way a
// real one does: the fake Codex calls move_to_worktree over the MCP server
// mid-answer, then edits in the folder it got back.
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { findExecutable } from "../platform/executables";
import { defaultAISettings } from "../../shared/settings";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import { StartedThreads } from "../started-threads";
import { serveRelayTools, useRelayMcp, verifyRelayToken } from "../relay-mcp";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

const secret = "c".repeat(64);
let root: string,
  repo: string,
  chats: ProjectChats,
  projectId: string,
  closeTools: () => Promise<void>;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-enter-wt-")));
  repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
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
  const cli = await fakeCli(
    join(root, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  const store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
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
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
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
  expect(git("worktree", "list")).toContain(folder);
  // The copy went along and the project folder kept its own.
  expect(await readFile(join(folder!, "wip.txt"), "utf8")).toBe(
    "Not committed\n",
  );
  expect(existsSync(join(repo, "wip.txt"))).toBe(true);
  // The edit made after the move is the answer's, in the worktree.
  expect(moved.messages[1].changes?.map((c) => c.path)).toEqual(["moved.txt"]);
  expect(existsSync(join(repo, "moved.txt"))).toBe(false);
  const summary = (await chats.list(projectId)).find((c) => c.id === chat.id);
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
