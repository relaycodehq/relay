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

vi.mock("../platform/executables");

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

it("leaves a /btw answer running when Stop lands while the main thread is idle, and doesn't pause the queue", async () => {
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
  expect((await side())?.status).toBe("streaming");
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

it("finishes a deep review whose lead carried on through a restart", async () => {
  const { agentRuntime } = await import("../agents");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  const lead = {
    id: randomUUID(),
    role: "assistant",
    body: "Reading the reports",
    status: "streaming",
    created: 1,
    provider: "codex",
    version: 1,
  };
  saved.messages = [lead];
  saved.deepReview = {
    scope: { label: "PR #4" },
    request: "request",
    reviewers: [],
    lead: { provider: "codex", choice: input("").choice },
    runChecks: false,
    runtimeMode: "full-access",
    status: "leading",
  };
  await writeFile(file, JSON.stringify(saved));
  const codex = agentRuntime("codex");
  const key = JSON.stringify([join(root, "chats"), chat.id, "main"]);
  vi.spyOn(codex, "reattach").mockResolvedValue([{ key, open: true }]);
  vi.spyOn(codex, "run").mockResolvedValue("Findings are in.");
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  await chats.reattach();
  await vi.waitFor(
    async () => expect((await chats.get(chat.id)).deepReview?.status).toBe("done"),
    { timeout: 10_000 },
  );
  const after = await chats.get(chat.id);
  expect(after.messages.find((m) => m.id === lead.id)?.status).toBe("complete");
  expect(after.deepReview).not.toHaveProperty("leadStopped");
}, 30_000);

/**
 * A review whose first reviewer was mid-answer when Relay restarted; the
 * second either reported already or was cut off with nothing kept.
 */
async function reviewAcrossRestart(second: "reported" | "cut off") {
  const { agentRuntime } = await import("../agents");
  const review = await chats.create(projectId, { kind: "project" });
  const kept = await chats.create(projectId, { kind: "project" });
  const other = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const answer = (body: string, status: string) => ({
    id: randomUUID(),
    role: "assistant",
    body,
    status,
    created: 1,
    provider: "codex",
    version: 1,
  });
  const edit = async (id: string, change: (saved: Record<string, unknown>) => void) => {
    const file = join(root, "chats", id + ".json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    change(saved);
    await writeFile(file, JSON.stringify(saved));
  };
  const reviewer = { provider: "codex", choice: input("").choice };
  await edit(review.id, (saved) => {
    saved.deepReview = {
      scope: { target: { kind: "uncommitted" }, label: "Uncommitted changes", branch: "main" },
      request: "request",
      reviewers: [
        { ...reviewer, chatId: kept.id },
        { ...reviewer, chatId: other.id },
      ],
      lead: reviewer,
      runChecks: false,
      runtimeMode: "full-access",
      status: "reviewing",
    };
  });
  const cutOff = answer("Reading the diff", "streaming");
  await edit(kept.id, (saved) => {
    saved.reviewer = { parent: review.id, slot: 0 };
    saved.messages = [cutOff];
  });
  await edit(other.id, (saved) => {
    saved.reviewer = { parent: review.id, slot: 1 };
    saved.messages = [
      second === "reported"
        ? answer("No issues in the parser.", "complete")
        : answer("Reading the tests", "streaming"),
    ];
  });
  const codex = agentRuntime("codex");
  const key = JSON.stringify([join(root, "chats"), kept.id, "main"]);
  vi.spyOn(codex, "reattach").mockResolvedValue([{ key, open: true }]);
  vi.spyOn(codex, "run").mockImplementation(async (options) =>
    options.job?.kind === "adopt" ? "The cache key ignores the locale." : "Findings are in.",
  );
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  await chats.reattach();
  return { review, kept, cutOff };
}

it("waits for a reviewer that carried on through a restart, then hands over to the lead", async () => {
  const { review, kept, cutOff } = await reviewAcrossRestart("reported");
  await vi.waitFor(
    async () => expect((await chats.get(review.id)).deepReview?.status).toBe("done"),
    { timeout: 10_000 },
  );
  const answer = (await chats.get(kept.id)).messages.find((m) => m.id === cutOff.id);
  expect(answer).toMatchObject({
    status: "complete",
    body: "The cache key ignores the locale.",
  });
}, 30_000);

it("stops a review a restart cut a reviewer off from, letting the kept one finish", async () => {
  const { review, kept, cutOff } = await reviewAcrossRestart("cut off");
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(kept.id)).messages.find((m) => m.id === cutOff.id)?.status,
      ).toBe("complete"),
    { timeout: 10_000 },
  );
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  // Resume runs the reviewer that was cut off, then the lead.
  expect((await chats.get(review.id)).deepReview?.status).toBe("stopped");
}, 30_000);

it("waits for every reviewer that carried on through a restart, however slowly each is picked back up", async () => {
  const { agentRuntime } = await import("../agents");
  const review = await chats.create(projectId, { kind: "project" });
  const first = await chats.create(projectId, { kind: "project" });
  const second = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const edit = async (id: string, change: (saved: Record<string, unknown>) => void) => {
    const file = join(root, "chats", id + ".json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    change(saved);
    await writeFile(file, JSON.stringify(saved));
  };
  const reviewer = { provider: "codex", choice: input("").choice };
  await edit(review.id, (saved) => {
    saved.deepReview = {
      scope: { target: { kind: "uncommitted" }, label: "Uncommitted changes", branch: "main" },
      request: "request",
      reviewers: [
        { ...reviewer, chatId: first.id },
        { ...reviewer, chatId: second.id },
      ],
      lead: reviewer,
      runChecks: false,
      runtimeMode: "full-access",
      status: "reviewing",
    };
  });
  for (const [slot, chat] of [first, second].entries())
    await edit(chat.id, (saved) => {
      saved.reviewer = { parent: review.id, slot };
      saved.messages = [
        {
          id: randomUUID(),
          role: "assistant",
          body: "Reading the diff",
          status: "streaming",
          created: 1,
          provider: "codex",
          version: 1,
        },
      ];
    });
  const codex = agentRuntime("codex");
  const keys = [first, second].map((c) => JSON.stringify([join(root, "chats"), c.id, "main"]));
  vi.spyOn(codex, "reattach").mockResolvedValue(keys.map((key) => ({ key, open: true })));
  // The second reviewer's folder resolves only after the first has finished.
  let firstDone!: () => void;
  const firstEnded = new Promise<void>((resolve) => (firstDone = resolve));
  const leadPrompts: string[] = [];
  let adopted = 0;
  vi.spyOn(codex, "run").mockImplementation(async (options) => {
    if (options.job?.kind !== "adopt") {
      leadPrompts.push(options.prompt);
      return "Findings are in.";
    }
    if (adopted++ === 0) {
      setTimeout(firstDone, 300);
      return "The cache key ignores the locale.";
    }
    return "The parser drops trailing commas.";
  });
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const worktrees = chats["worktrees"];
  const resolveRoot = worktrees.root.bind(worktrees);
  vi.spyOn(worktrees, "root").mockImplementation(async (chat) => {
    if (chat.id === second.id) await firstEnded;
    return resolveRoot(chat);
  });
  await chats.reattach();
  await vi.waitFor(
    async () => expect((await chats.get(review.id)).deepReview?.status).toBe("done"),
    { timeout: 10_000 },
  );
  expect(leadPrompts).toHaveLength(1);
  expect(leadPrompts[0]).toContain("The cache key ignores the locale.");
  expect(leadPrompts[0]).toContain("The parser drops trailing commas.");
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
