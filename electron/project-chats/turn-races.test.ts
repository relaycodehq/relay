// Stops and queue actions that land at the edge of a turn, against the fake
// agents in tests/fixtures/room-agent.cjs.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string, store: Store, projects: Projects, chats: ProjectChats;
let projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-turn-races-")));
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
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const input = (body: string, provider: "codex" | "claude" = "codex") => ({
  id: randomUUID(),
  body,
  provider,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: {
    ...defaultAISettings.questions,
    model: "fixture-model",
    reasoningEffort: "high" as const,
    fast: true,
  },
});

/** The providers the agents' own turns ran on, helper jobs left out. */
const agentProviders = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line && !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .map((line) => (JSON.parse(line) as { provider: string }).provider);

/** A Codex answer, then a message for Claude: Codex is asked for a handoff note first. */
async function switchToClaude(id: string) {
  await chats.send(id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(id)).messages.at(-1)?.status).toBe("complete"),
  );
  await chats.send(id, input("@claude Now fix it", "claude"));
}

it("starts no new agent turn and writes no note of its own when stopped during the handoff note", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2000");
  const chat = await chats.create(projectId, { kind: "project" });
  await switchToClaude(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
      handoff: { from: "codex", to: "claude" },
      status: "streaming",
    }),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false), {
    timeout: 15_000,
  });
  const after = await chats.get(chat.id);
  expect(after.messages.at(-1)).toMatchObject({ status: "cancelled" });
  expect(after.messages.some((m) => m.handoff?.byRelay)).toBe(false);
  expect(after.messages.some((m) => m.provider === "claude" && m.role === "assistant")).toBe(false);
  expect(await agentProviders()).not.toContain("claude");
}, 30_000);

it("stops the handoff note when the Stop lands while the note is first saved", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2000");
  const chat = await chats.create(projectId, { kind: "project" });
  const storage = (chats as unknown as {
    storage: { save: (...a: unknown[]) => Promise<void> };
  }).storage;
  const save = storage.save.bind(storage);
  let stopped = false;
  vi.spyOn(storage, "save").mockImplementation(async (c, ...rest) => {
    const last = (c as { messages?: { handoff?: unknown; status: string }[] })
      .messages?.at(-1);
    if (!stopped && last?.handoff && last.status === "streaming") {
      stopped = true;
      await chats.cancel(chat.id);
    }
    return save(c, ...rest);
  });
  await switchToClaude(chat.id);
  await vi.waitFor(() => expect(stopped).toBe(true));
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false), {
    timeout: 15_000,
  });
  const note = (await chats.get(chat.id)).messages.find((m) => m.handoff);
  expect(note?.status).toBe("cancelled");
}, 30_000);

it("stops a /btw answer that runs while the main thread is idle, without pausing the queue", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const question = { ...input("@codex wait for cancellation"), side: true as const };
  await chats.send(chat.id, question);
  const side = async () =>
    (await chats.get(chat.id)).messages.find(
      (m) => m.parentId === question.id && m.role === "assistant",
    );
  await vi.waitFor(async () => expect((await side())?.status).toBe("streaming"));
  await chats.cancel(chat.id);
  await vi.waitFor(async () => expect((await side())?.status).toBe("cancelled"));
  expect((await chats.get(chat.id)).queuePaused).toBeFalsy();
}, 30_000);

it("sends messages queued behind a turn that carried on through a restart once it ends", async () => {
  const { agentRuntime } = await import("../agents");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain("cache guard"),
  );
  const queued = input("@codex Queued meanwhile");
  await chats.send(chat.id, queued);
  await chats.dispose();
  // As a restart that kept the agent going leaves it: the answer still
  // streaming and the queue waiting for it.
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  const answer = saved.messages.at(-1);
  answer.status = "streaming";
  delete answer.error;
  delete saved.queuePaused;
  await writeFile(file, JSON.stringify(saved));
  const codex = agentRuntime("codex");
  const key = JSON.stringify([join(root, "chats"), chat.id, "main"]);
  vi.spyOn(codex, "reattach").mockResolvedValue([{ key, open: true }]);
  const run = codex.run.bind(codex);
  vi.spyOn(codex, "run").mockImplementation(async (options) =>
    options.job?.kind === "adopt" ? "Carried on after the restart." : run(options),
  );
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  await chats.reattach();
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.some((m) => m.id === queued.id)).toBe(true),
    { timeout: 10_000 },
  );
}, 30_000);

it("refuses to take a queued message back once it went out", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "800");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex First"));
  const queued = input("@codex Second");
  await chats.send(chat.id, queued);
  expect((await chats.get(chat.id)).queue).toHaveLength(1);
  // The window still shows the bubble until its next refetch.
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.some((m) => m.id === queued.id)).toBe(true),
  );
  await expect(chats.queueAction(chat.id, "remove", queued.id)).rejects.toThrow(
    "already went out",
  );
}, 30_000);
