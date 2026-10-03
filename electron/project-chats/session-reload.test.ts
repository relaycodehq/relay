import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { findExecutable } from "../platform/executables";
import { defaultAISettings } from "../../shared/settings";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { fakeCli } from "../../tests/fixtures/fake-cli";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string, store: Store, projects: Projects, chats: ProjectChats;
let projectId: string;
let events: { chatId: string; message: ChatMessage }[];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-reload-")));
  const repo = join(root, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  const cli = await fakeCli(
    join(root, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  store = new Store(join(root, "state"));
  await store.load();
  projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  events = [];
  chats = new ProjectChats(store, projects, join(root, "chats"), (event) =>
    events.push(structuredClone(event)),
  );
});
afterEach(async () => {
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});
const settled = (id: string, count: number) =>
  vi.waitFor(
    async () => {
      const { messages } = await chats.get(id);
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 6000 },
  );
/** The thread's own app-server calls; a title's helper job runs elsewhere. */
const threadCalls = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter((line) => !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .map((line) => JSON.parse(line))
    .filter((call) => call.thread);

it("restarts Codex on the same thread and notes it quietly", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(chat.id, 2);
  const before = chats.list(projectId)[0];

  await chats.reloadSessions(chat.id);
  const note = (await chats.get(chat.id)).messages.at(-1)!;
  expect(note).toMatchObject({
    role: "assistant",
    provider: "codex",
    status: "complete",
    body: "",
    reload: {},
  });
  expect(events.at(-1)?.message.id).toBe(note.id);
  // Your own action: the thread neither moves up nor turns unread.
  const after = chats.list(projectId)[0];
  expect(after.updated).toBe(before.updated);
  expect(after.contextAgent).toBe("codex");

  await chats.send(chat.id, input("@codex And why?"));
  await settled(chat.id, 5);
  const calls = await threadCalls();
  expect(calls.map((call) => call.method)).toEqual([
    "thread/start",
    "thread/resume",
  ]);
  expect(calls[1].thread.threadId).toBe("fixture-thread");
}, 20000);

it("refuses while an answer runs, and for agents it can't reload", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(chats.reloadSessions(chat.id)).rejects.toThrow(
    "no agent session",
  );
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(chat.id, 2);

  const internals = chats as unknown as {
    active: { claim(id: string, input: object): object };
    storage: {
      load(id: string): Promise<ProjectChat>;
      save(chat: ProjectChat): Promise<void>;
    };
  };
  internals.active.claim(chat.id, input("@codex More"));
  await expect(chats.reloadSessions(chat.id)).rejects.toThrow(
    "Wait for the current answer",
  );

  const other = await chats.create(projectId, { kind: "project" });
  const saved = await internals.storage.load(other.id);
  saved.messages.push({
    id: randomUUID(),
    role: "assistant",
    body: "Done.",
    status: "complete",
    provider: "opencode",
    created: Date.now(),
    version: 1,
  });
  await internals.storage.save(saved);
  await expect(chats.reloadSessions(other.id)).rejects.toThrow("OpenCode");
  expect((await chats.get(other.id)).messages).toHaveLength(1);
}, 20000);
