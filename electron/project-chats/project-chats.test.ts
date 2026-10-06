import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
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
import { triageState } from "../../shared/chat-activity";
import {
  applyChatPatch,
  type ChatMessage,
  type ChatSummary,
} from "../../shared/projects";
import { ChatSummaryFeed } from "./chat-summaries";
import { AgentAccounts, accountFor } from "../agents/accounts";
import { prepareProfile, setProfilesRoot } from "../agents/accounts/profiles";
import { fakeCli } from "../../tests/fixtures/fake-cli";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));
let root: string,
  store: Store,
  projects: Projects,
  chats: ProjectChats,
  projectId: string;
let events: { chatId: string; message: ChatMessage; title?: string }[];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-project-chat-")));
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
  // Windows holds a folder a just-stopped agent ran in for a moment.
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});
/** The capture log, the agent's own calls only unless helper jobs are asked for. */
const agentCalls = async ({ helpers = false } = {}) =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => helpers || !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .join("\n");
const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: {
    ...defaultAISettings.questions,
    model: "fixture-model",
    reasoningEffort: "high" as const,
    fast: true,
  },
});
it("sends only messages the renderer doesn't hold at their current version", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const full = await chats.get(chat.id);
  const [question, answer] = full.messages;
  const patch = await chats.changes(chat.id, {
    [question!.id]: question!.version,
    [answer!.id]: answer!.version - 1,
  });
  expect(patch.messages).toEqual([question!.id, answer]);
  expect(patch.title).toBe(full.title);
  const held = { ...full, messages: [question!, { ...answer!, body: "old" }] };
  const rebuilt = applyChatPatch(patch, held);
  expect(rebuilt.messages[0]).toBe(question);
  expect(rebuilt.messages[1]).toEqual(answer);
  expect(() => applyChatPatch(patch, undefined)).toThrow("missing a message");
}, 15000);
it("streams locally, persists final answers, and resumes the same Codex session with selected settings", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2600");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(() =>
    expect(
      events.some(
        (e) =>
          e.message.status === "streaming" &&
          e.message.body.includes("cache guard"),
      ),
    ).toBe(true),
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("streaming");
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
    "The cache guard prevents duplicate requests.",
  );
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
  expect(events.some((e) => e.title === "Cache guard behavior")).toBe(true);
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), (event) =>
    events.push(structuredClone(event)),
  );
  await chats.send(chat.id, input("@codex And why is that useful?"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(requests.filter((r) => r.thread).map((r) => r.method)).toEqual([
    "thread/start",
    "thread/resume",
  ]);
  expect(requests.filter((r) => r.thread)[1].thread.threadId).toBe(
    "fixture-thread",
  );
  for (const r of requests.filter((r) => r.turn)) {
    expect(r.cwd).toBe(join(root, "repo"));
    expect(r.turn).toMatchObject({
      model: "fixture-model",
      effort: "high",
      serviceTier: "fast",
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "readOnly" },
      approvalsReviewer: "user",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "fixture-model",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });
  }
  expect(requests.filter((r) => r.turn)[1].turn.input[0].text).not.toContain(
    "The cache guard prevents duplicate requests.",
  );
}, 15000);
it("names a thread from its first message while the answer is still running", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  vi.stubEnv("RELAY_AGENT_TURN_MS", "4000");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
    { timeout: 3000 },
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("streaming");
  const titling = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.turn?.input[0].text.startsWith("Generate a short title"));
  expect(titling.turn).toMatchObject({
    model: "fixture-model",
    effort: "low",
  });
  expect(titling.turn.input[0].text).toContain("Explain the cache guard");
  expect(titling.turn.input[0].text).not.toContain('"answer"');
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
}, 12000);
it("retries a missing title once, not every time the thread is read", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  // The generated title is the prompt excerpt already.
  await chats.send(chat.id, input("@codex Cache guard behavior"));
  const titleRuns = async () =>
    (await agentCalls({ helpers: true }))
      .split("\n")
      .filter((line) => line.includes("Generate a short title")).length;
  await vi.waitFor(async () => expect(await titleRuns()).toBe(1), {
    timeout: 8000,
  });
  for (let read = 0; read < 3; read++) {
    await new Promise((r) => setTimeout(r, 500));
    chats.ensureTitle(chat.id);
  }
  await new Promise((r) => setTimeout(r, 1000));
  expect(await titleRuns()).toBe(1);
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
}, 15000);
it("retries a title with the answering agent's own model after another agent took over", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  for (const [body, count] of [
    ["@codex Cache guard behavior", 2],
    ["@claude Now fix it", 5],
  ] as const) {
    const provider = body.startsWith("@claude") ? "claude" : "codex";
    await chats.send(chat.id, {
      ...input(body),
      provider,
      choice: { ...input(body).choice, model: `${provider}-model` },
    });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  }
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  await chats.get(chat.id);
  chats.ensureTitle(chat.id);
  const models = async () =>
    (await agentCalls({ helpers: true }))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((r) => r.turn?.input[0].text.startsWith("Generate a short"))
      .map((r) => r.turn.model);
  await vi.waitFor(async () => expect(await models()).toHaveLength(2));
  // Codex can't run Claude's model; it retries with its own settings.
  expect(await models()).not.toContain("claude-model");
}, 20000);
it("waits for the first answer to name a thread of only screenshots", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex [Image #1]"));
  expect((await chats.get(chat.id)).title).toBe("[Image #1]");
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
    { timeout: 8000 },
  );
  const titling = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.turn?.input[0].text.startsWith("Generate a short title"));
  expect(titling.turn.input[0].text).toContain('"answer"');
}, 12000);
it("keeps the furthest read mark, and lists it for the desktop and phones", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.markSeen(chat.id, 500);
  await chats.markSeen(chat.id, 300);
  expect(chats.list(projectId).find((c) => c.id === chat.id)?.seenAt).toBe(500);
});
it("keeps a user's thread name over the prompt excerpt and generated titles", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(chats.rename(chat.id, "  \n ")).rejects.toThrow("thread name");
  expect(await chats.rename(chat.id, " Cache\n  work ")).toMatchObject({
    title: "Cache work",
    renamed: true,
  });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 8000 },
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.filter((r) => r.turn)).toHaveLength(1);
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  expect((await chats.list(projectId))[0].title).toBe("Cache work");
}, 12000);
it("asks the outgoing agent for a handoff note before another agent takes over", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  await chats.send(chat.id, {
    ...input("@claude Now fix it"),
    provider: "claude",
  });
  await vi.waitFor(
    async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(5);
      expect(messages.at(-1)?.status).toBe("complete");
    },
    { timeout: 10000 },
  );
  const after = await chats.get(chat.id);
  const note = after.messages[3]!;
  expect(note).toMatchObject({
    role: "assistant",
    provider: "codex",
    handoff: { from: "codex", to: "claude" },
    status: "complete",
    body: "The cache guard prevents duplicate requests.",
  });
  expect(after.messages[4]).toMatchObject({
    role: "assistant",
    provider: "claude",
    status: "complete",
  });
  // The note is a hidden turn: not a queue pause, not the last real input,
  // and Codex has heard nothing new since its answer.
  expect(after.queuePaused).toBeFalsy();
  expect(after.lastInput?.body).toBe("@claude Now fix it");
  expect(after.sessions?.codex?.through).toBe(after.messages[1]!.id);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter(
    (c) => c.turn && !c.turn.input[0].text.startsWith("Generate a short title"),
  );
  expect(turns).toHaveLength(2);
  expect(turns[1].turn.input[0].text).toContain(
    "Claude is taking over this conversation",
  );
  const claudePrompt = JSON.parse(
    calls.find((c) => c.provider === "claude").prompt,
  ).message.content.find((p: { type: string }) => p.type === "text")
    .text as string;
  expect(claudePrompt).toContain("Handoff note from Codex");
  expect(claudePrompt).toContain(
    "The cache guard prevents duplicate requests.",
  );
  // The history slice carries the earlier exchange, not the note again.
  expect(claudePrompt.split("Claude is taking over")).toHaveLength(1);
  expect(claudePrompt).toContain("Explain the cache guard");
}, 20000);
it("accepts a message for another agent without waiting for the handoff note", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2000");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  await chats.send(chat.id, {
    ...input("@claude Now fix it"),
    provider: "claude",
  });
  // Codex is still writing its note; the message is already in the thread.
  const messages = (await chats.get(chat.id)).messages;
  expect(messages.at(-2)?.body).toBe("@claude Now fix it");
  expect(messages.at(-1)).toMatchObject({
    handoff: { from: "codex", to: "claude" },
    status: "streaming",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
        provider: "claude",
        status: "complete",
      }),
    { timeout: 10000 },
  );
}, 20000);
it("tells an agent coming back what was asked of the other agent meanwhile", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const [body, count] of [
    ["@codex Explain the cache guard", 2],
    ["@claude Now fix it", 5],
    ["@codex Check the fix", 8],
  ] as const) {
    await chats.send(chat.id, {
      ...input(body),
      provider: body.startsWith("@claude") ? "claude" : "codex",
    });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  }
  const codex = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) => c.turn.input[0].text as string)
    .find((text) => text.startsWith("My request: Check the fix"))!;
  const history = JSON.parse(
    codex.slice(codex.indexOf("[", codex.indexOf("Conversation updates"))),
  );
  expect(history.map((m: { body: string }) => m.body)).toEqual([
    "@claude Now fix it",
    "Claude found the same cache guard.",
  ]);
}, 30000);
it("still tells a compacted session the notes left since its last answer", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const settled = (count: number) =>
    vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await settled(2);
  await chats.send(chat.id, input("Keep the old API."));
  await chats.compact(chat.id);
  await settled(4);
  await chats.send(chat.id, input("@codex Go on"));
  await settled(6);
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) => c.turn.input[0].text as string)
    .find((text) => text.startsWith("My request: Go on"))!;
  expect(prompt).toContain("Keep the old API.");
}, 20000);
it("keeps what Claude compacted to beside the compaction, not as its answer", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const settled = (count: number) =>
    vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await settled(2);
  await chats.compact(chat.id);
  await settled(3);
  const compaction = (await chats.get(chat.id)).messages.at(-1)!;
  expect(compaction.compaction).toBe(true);
  expect(compaction.body).toBe("");
  expect(compaction.compactSummary).toBe("Summary:\n1. Keep the old API.");
}, 20000);
it("brings the sidebar summary up to date when a compaction finishes", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const finished = () =>
    vi.waitFor(
      async () => {
        expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
          "complete",
        );
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await finished();
  await chats.triage(chat.id, { kind: "settle" });
  await chats.compact(chat.id);
  await finished();
  await vi.waitFor(async () => {
    const summary = chats.list(projectId).find((c) => c.id === chat.id)!;
    expect(summary.updated).toBe((await chats.get(chat.id)).updated);
  });
}, 20000);
it("generates a title for Claude conversations, which have no thread-name event", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await vi.waitFor(
    async () => {
      const saved = await chats.get(chat.id);
      expect(saved.title).toBe("Cache guard behavior");
      expect(saved.messages.at(-1)?.status).toBe("complete");
    },
    { timeout: 8000 },
  );
  const titling = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && r.prompt.includes("short title"));
  expect(titling).toHaveLength(1);
  expect(titling[0].args.join(" ")).toContain(
    "--model fixture-model --effort low",
  );
  expect((await chats.get(chat.id)).messages).toHaveLength(2);
}, 12000);
it("shows a turn Claude starts by itself as its own answer, so later answers stay under their questions", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task"),
  );
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.find((m) => m.unprompted)?.status,
      ).toBe("complete"),
    { timeout: 8000 },
  );
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 8000 },
  );
  expect(
    (await chats.get(chat.id)).messages.map((m) => [
      m.role,
      !!m.unprompted,
      m.body,
    ]),
  ).toEqual([
    ["user", false, "@claude Start the fixture background task"],
    ["assistant", false, "Started the background task."],
    ["assistant", true, "The background task finished."],
    ["user", false, "@claude Explain the cache guard"],
    ["assistant", false, "Claude found the same cache guard."],
  ]);
}, 15000);
it("steers a turn Claude started by itself", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task to steer"),
  );
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.find((m) => m.unprompted)?.body,
      ).toBe("Looking into it."),
    { timeout: 8000 },
  );
  await chats.send(chat.id, {
    ...claude("@claude Use the blue one"),
    delivery: "steer",
  });
  await vi.waitFor(
    async () => {
      expect(chats.hasActiveProject(projectId)).toBe(false);
      expect((await chats.get(chat.id)).messages).toHaveLength(5);
    },
    { timeout: 8000 },
  );
  expect(
    (await chats.get(chat.id)).messages.map((m) => [
      m.role,
      m.body,
      !!m.unprompted,
      !!m.steered,
    ]),
  ).toEqual([
    [
      "user",
      "@claude Start the fixture background task to steer",
      false,
      false,
    ],
    ["assistant", "Started the background task.", false, false],
    ["assistant", "Looking into it.", true, false],
    ["user", "@claude Use the blue one", false, true],
    ["assistant", "Noted: Use the blue one", false, false],
  ]);
}, 15000);
it.each([
  ["reads it mid-turn", "fixture wait for steer", "Looking into it."],
  ["reads it after finishing", "fixture late steer", "Done before your note."],
])(
  "continues Claude's answer below a steering message once Claude %s",
  async (_, prompt, earlier) => {
    const chat = await chats.create(projectId, { kind: "project" });
    const claude = (body: string) => ({
      ...input(body),
      provider: "claude" as const,
    });
    await chats.send(chat.id, claude(`@claude ${prompt}`));
    await vi.waitFor(
      async () =>
        expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
          "Looking into it.",
        ),
      { timeout: 8000 },
    );
    await chats.send(chat.id, {
      ...claude("@claude Use the blue one"),
      delivery: "steer",
    });
    await vi.waitFor(
      async () => {
        expect(chats.hasActiveProject(projectId)).toBe(false);
        expect((await chats.get(chat.id)).messages).toHaveLength(4);
      },
      { timeout: 8000 },
    );
    const messages = (await chats.get(chat.id)).messages;
    expect(
      messages.map((m) => [m.role, m.body, m.status, !!m.steered]),
    ).toEqual([
      ["user", `@claude ${prompt}`, "complete", false],
      ["assistant", earlier, "complete", false],
      ["user", "@claude Use the blue one", "complete", true],
      ["assistant", "Noted: Use the blue one", "complete", false],
    ]);
    expect(messages[3]!.created).toBeGreaterThan(messages[2]!.created);
    // Shown as waiting until Claude picks it up.
    const steerEvents = events.filter((e) => e.message.id === messages[2]!.id);
    expect(steerEvents[0]?.message.unread).toBe(true);
    expect(steerEvents.at(-1)?.message.unread).toBeUndefined();
    expect(messages[2]!.unread).toBeUndefined();
    expect((await chats.get(chat.id)).sessions?.claude?.through).toBe(
      messages[3]!.id,
    );
  },
  15000,
);
it("continues Codex's answer below a steering message once Codex reads it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture codex steer"));
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.at(-1)?.trace?.length,
      ).toBeGreaterThan(0),
    { timeout: 15000 },
  );
  const steer = {
    ...input("@codex Use the blue one"),
    delivery: "steer" as const,
  };
  await chats.send(chat.id, steer);
  await vi.waitFor(
    async () => {
      expect(chats.hasActiveProject(projectId)).toBe(false);
      expect((await chats.get(chat.id)).messages).toHaveLength(4);
    },
    { timeout: 15000 },
  );
  const messages = (await chats.get(chat.id)).messages;
  expect(messages.map((m) => [m.role, m.body, m.status])).toEqual([
    ["user", "@codex fixture codex steer", "complete"],
    ["assistant", "", "complete"],
    ["user", "@codex Use the blue one", "complete"],
    ["assistant", "Noted: Use the blue one", "complete"],
  ]);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls.find((c) => c.steer)?.steer.clientUserMessageId).toBe(steer.id);
}, 30000);
it("keeps a question's answer under it when Claude's own turn follows it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(
    chat.id,
    claude("@claude Start the fixture background task"),
  );
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 8000 },
  );
  // Sent before the task ends, so Claude's own turn arrives after this answer.
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await vi.waitFor(
    async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages.find((m) => m.unprompted)?.status).toBe("complete");
      expect(messages.every((m) => m.status === "complete")).toBe(true);
    },
    { timeout: 8000 },
  );
  const messages = (await chats.get(chat.id)).messages;
  const question = messages.findIndex(
    (m) => m.body === "@claude Explain the cache guard",
  );
  expect(messages.find((m, i) => i > question && !m.unprompted)?.body).toBe(
    "Claude found the same cache guard.",
  );
  expect(messages.filter((m) => m.unprompted).map((m) => m.body)).toEqual([
    "The background task finished.",
  ]);
}, 15000);
const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=";
it("saves a pasted screenshot outside chat JSON and sends a local image to Codex", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@codex What is in this screenshot?"),
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  // The thread stays active a moment after its answer reads complete.
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 6000 },
  );
  const image = (await chats.get(chat.id)).messages[0].images?.[0];
  expect(image).toMatchObject({ name: "screen.png", mimeType: "image/png" });
  expect(await chats.image(chat.id, image!.id)).toBe(
    `data:image/png;base64,${tinyPng}`,
  );
  await expect(chats.image(chat.id, randomUUID())).rejects.toThrow(
    "Screenshot not found",
  );
  await expect(chats.share(chat.id)).rejects.toThrow("private screenshots");
  expect(
    await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
  ).not.toContain(tinyPng);
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.find((r) => r.turn).turn.input[1]).toMatchObject({
    type: "localImage",
  });
  await expect(
    chats.send(chat.id, {
      ...input("@codex bad image"),
      images: [
        {
          name: "bad.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,YmFk",
        },
      ],
    }),
  ).rejects.toThrow("Screenshot is invalid");
}, 10000);
it("passes a pasted screenshot as an image block to Claude", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Describe this image"),
    provider: "claude",
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const message = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  );
  expect(message.message.content[1]).toMatchObject({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: tinyPng },
  });
}, 10000);
it("sends a screenshot on its own without inventing a request", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude"),
    provider: "claude",
    images: [
      {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const saved = await chats.get(chat.id);
  expect(saved.messages[0].body).toBe("@claude");
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const content = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  ).message.content;
  expect(content.at(-1)).toMatchObject({ type: "image" });
  for (const block of content.filter(
    (b: { type: string }) => b.type === "text",
  )) {
    expect(block.text).not.toBe("");
    expect(block.text).not.toContain("My request");
  }
}, 10000);
it("sends a Claude slash command as the whole prompt so Claude runs it", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude /security-review focus on auth"),
    provider: "claude",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const message = JSON.parse(
    requests.find((r) => r.provider === "claude").prompt,
  );
  expect(message.message.content[0].text).toBe(
    "/security-review focus on auth",
  );
}, 10000);
it("tells a Claude session begun with a command what the thread is about on its next turn", async () => {
  const chat = await chats.create(projectId, {
    kind: "pr",
    ref: { owner: "Web", name: "portal", number: 7 },
  });
  for (const body of ["@claude /security-review", "@claude Fix the first"]) {
    await chats.send(chat.id, { ...input(body), provider: "claude" });
    await vi.waitFor(
      async () => {
        expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
          "complete",
        );
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
  }
  const prompts = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && !r.args.includes("--print"))
    .map((r) => JSON.parse(r.prompt).message.content[0].text as string);
  expect(prompts[0]).toBe("/security-review");
  expect(prompts[1]).toContain("This discussion concerns PR #7 in Web/portal");
  // Nothing came before the command, so its session has heard it all.
  expect(prompts[1]).not.toContain("Conversation updates");
}, 15000);
it("tells Claude on its next turn what a command it began with couldn't carry", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const body of [
    "@codex Explain the cache guard",
    "@claude /security-review",
    "@claude Fix the first",
  ]) {
    const provider = body.startsWith("@claude") ? "claude" : "codex";
    await chats.send(chat.id, { ...input(body), provider });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages.at(-1)?.role).toBe("assistant");
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  }
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && !r.args.includes("--print"))
    .map((r) => JSON.parse(r.prompt).message.content[0].text as string)
    .find((text) => text.startsWith("My request: Fix the first"))!;
  expect(prompt).toContain("Explain the cache guard");
  expect(prompt).toContain("The cache guard prevents duplicate requests.");
  // A note Claude couldn't be given isn't asked of Codex.
  expect((await chats.get(chat.id)).messages.some((m) => m.handoff)).toBe(
    false,
  );
}, 30000);
it("keeps ordinary notes local, cancels a partial answer, and does not duplicate retried messages", async () => {
  const chat = await chats.create(projectId, { kind: "project" }),
    note = input("Consider a cache here.");
  await chats.send(chat.id, note);
  await chats.send(chat.id, note);
  expect((await chats.get(chat.id)).messages).toHaveLength(1);
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(() =>
    expect(
      events.some(
        (e) =>
          e.message.body === "The cache guard prevents duplicate requests.",
      ),
    ).toBe(true),
  );
  await chats.send(chat.id, input("@codex Another"));
  expect((await chats.get(chat.id)).queue).toHaveLength(1);
  chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
    "cache guard",
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.error).toBeUndefined();
  expect((await chats.get(chat.id)).queuePaused).toBe(true);
  // Asking again by hand lets the paused queue follow that answer.
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.send(chat.id, input("@codex Asked by hand"));
  await vi.waitFor(
    async () => {
      const saved = await chats.get(chat.id);
      expect(saved.queue ?? []).toHaveLength(0);
      expect(
        saved.messages.filter((m) => m.role === "user").map((m) => m.body),
      ).toEqual(
        expect.arrayContaining(["@codex Asked by hand", "@codex Another"]),
      );
    },
    { timeout: 15000 },
  );
});
it("lets a message's `to` decide who answers over its body's mention", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, { ...input("@codex later, maybe"), to: "message" });
  expect((await chats.get(chat.id)).messages).toHaveLength(1);
  expect(chats.hasActiveProject(projectId)).toBe(false);
  await chats.send(chat.id, {
    ...input("Explain the cache guard"),
    to: "codex",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
        role: "assistant",
        provider: "codex",
        status: "complete",
      }),
    { timeout: 6000 },
  );
  expect(chats.list(projectId).find((c) => c.id === chat.id)).toMatchObject({
    provider: "codex",
    contextAgent: "codex",
  });
}, 15000);
it("previews only the images a turn read, and only when they really are images", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const shot = join(root, "shot.png"),
    fake = join(root, "fake.png"),
    unread = join(root, "unread.png");
  await writeFile(shot, Buffer.from(tinyPng, "base64"));
  await writeFile(fake, "not an image");
  await writeFile(unread, Buffer.from(tinyPng, "base64"));
  const read = (label: string) => ({
    kind: "activity",
    id: label,
    activity: { id: label, kind: "read", label, status: "complete" },
  });
  const path = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const turn = randomUUID();
  saved.messages.push({
    id: turn,
    role: "assistant",
    provider: "claude",
    created: Date.now(),
    body: "Looked at it.",
    status: "complete",
    version: 1,
    trace: [read(shot), read(fake)],
  });
  await writeFile(path, JSON.stringify(saved));
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  expect(await chats.readImage(chat.id, turn, shot)).toBe(
    `data:image/png;base64,${tinyPng}`,
  );
  await expect(chats.readImage(chat.id, turn, fake)).rejects.toThrow(
    "isn't an image",
  );
  await expect(chats.readImage(chat.id, turn, unread)).rejects.toThrow(
    "didn't read or show that image",
  );
  await expect(chats.readImage(chat.id, randomUUID(), shot)).rejects.toThrow(
    "didn't read that image",
  );
  await rm(shot);
  await expect(chats.readImage(chat.id, turn, shot)).rejects.toThrow(
    "no longer on disk",
  );
});
it("recovers an interrupted on-disk stream without discarding its partial answer or restarting the agent", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const path = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.messages.push({
    id: randomUUID(),
    role: "assistant",
    provider: "codex",
    created: Date.now(),
    body: "Partially saved answer",
    status: "streaming",
    version: 2,
  });
  await writeFile(path, JSON.stringify(saved));
  chats = new ProjectChats(store, projects, join(root, "chats"), (event) =>
    events.push(event),
  );
  const recovered = await chats.get(chat.id);
  expect(recovered.messages[0]).toMatchObject({
    body: "Partially saved answer",
    status: "failed",
    version: 3,
  });
  expect(JSON.parse(await readFile(path, "utf8")).messages[0].status).toBe(
    "failed",
  );
  expect(events).toEqual([]);
});
it("validates selected PR evidence before saving a question and passes exact old-side context to the agent", async () => {
  await chats.dispose();
  const evidence = vi.fn(async () => ({
    revision: "b".repeat(40),
    side: "Before this PR (merge base)",
    path: "old-name.ts",
    lines: [{ line: 7, text: "const oldValue = 1;" }],
  }));
  chats = new ProjectChats(
    store,
    projects,
    join(root, "chats"),
    (e) => events.push(e),
    undefined,
    evidence,
  );
  const chat = await chats.create(projectId, {
    kind: "pr",
    ref: { owner: "Web", name: "portal", number: 7 },
  });
  const request = {
    ...input("@codex Why was this removed?"),
    selection: {
      head: "a".repeat(40),
      base: "b".repeat(40),
      path: "new-name.ts",
      start: 7,
      end: 7,
      side: "deletions" as const,
      question: "Why was this removed?",
    },
  };
  evidence.mockRejectedValueOnce(
    new Error("This PR changed. Refresh before asking about these lines."),
  );
  await expect(chats.send(chat.id, request)).rejects.toThrow("This PR changed");
  expect((await chats.get(chat.id)).messages).toEqual([]);
  await chats.send(chat.id, request);
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const prompt = calls.find((c) => c.turn).turn.input[0].text;
  expect(prompt).toContain("old-name.ts");
  expect(prompt).toContain("Before this PR");
  expect(prompt).toContain("b".repeat(40));
  expect(prompt).toContain("not necessarily the local checkout");
});

it("keeps replies one level deep, isolates their agent session, and retains local-only activity", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const ask = async (body: string, parentId?: string) => {
    const request = { ...input(body), ...(parentId ? { parentId } : {}) };
    await chats.send(chat.id, request);
    await vi.waitFor(
      async () => {
        const saved = await chats.get(chat.id);
        const index = saved.messages.findIndex((m) => m.id === request.id);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(saved.messages[index + 1]?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
    return (await chats.get(chat.id)).messages.at(-1)!;
  };
  const main = await ask("@codex MAIN question");
  const first = await ask("@codex BRANCH question", main.id);
  const second = await ask("@codex BRANCH followup", first.id);
  expect(first.parentId).toBe(main.id);
  expect(second.parentId).toBe(main.id);
  await ask("@codex MAIN followup");
  const saved = await chats.get(chat.id);
  expect(saved.messages.at(-1)?.parentId).toBeUndefined();
  expect(saved.replySessions?.[main.id]?.codex?.through).toBe(second.id);
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  // The side conversation continues Codex's own session, cut after its answer.
  expect(requests.filter((r) => r.thread).map((r) => r.method)).toEqual([
    "thread/start",
    "thread/fork",
  ]);
  expect(requests.find((r) => r.method === "thread/fork").thread).toMatchObject(
    { threadId: "fixture-thread", lastTurnId: "fixture-turn" },
  );
  expect(main.forkPoint).toEqual({
    thread: "fixture-thread",
    at: "fixture-turn",
  });
  const prompts = requests
    .filter((r) => r.turn)
    .map((r) => r.turn.input[0].text);
  expect(prompts[0]).toContain("general discussion of the linked project");
  // The fork already holds the main conversation and the scope.
  expect(prompts[1]).toContain("side conversation branching off your answer");
  expect(prompts[1]).not.toContain("MAIN question");
  expect(prompts[1]).not.toContain("general discussion");
  expect(prompts[2]).not.toContain("side conversation");
  expect(prompts[2]).not.toContain("MAIN question");
  expect(prompts[3]).not.toContain("BRANCH");
  expect(prompts[3]).not.toContain("general discussion");
  expect(
    saved.messages
      .at(-1)
      ?.trace?.flatMap((e) => (e.kind === "activity" ? [e.activity] : [])),
  ).toMatchObject([
    {
      kind: "command",
      status: "complete",
      label: "git diff --stat",
      detail: "example.ts | 2 +-",
    },
  ]);
  expect(saved.messages.at(-1)?.activity).toBeUndefined();
  await expect(
    chats.send(chat.id, {
      ...input("@codex Unknown reply"),
      parentId: randomUUID(),
    }),
  ).rejects.toThrow("Reply target is missing");
  expect((await chats.get(chat.id)).messages).toHaveLength(
    saved.messages.length,
  );
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  expect((await chats.get(chat.id)).replySessions).toEqual(saved.replySessions);
}, 25000);

it("forks Claude's session for a side conversation, and gives another agent the conversation up to its message", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const ask = async (
    body: string,
    provider: "codex" | "claude",
    count: number,
    parentId?: string,
  ) => {
    await chats.send(chat.id, {
      ...input(body),
      provider,
      ...(parentId ? { parentId } : {}),
    });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
    return (await chats.get(chat.id)).messages.at(-1)!;
  };
  const main = await ask("@claude MAIN question", "claude", 2);
  expect(main.forkPoint).toEqual({
    thread: "fixture-claude",
    at: "fixture-assistant",
  });
  await ask("@claude BRANCH question", "claude", 4, main.id);
  // Codex joins the side conversation: Claude's side session hands off first.
  await ask("@codex OTHER question", "codex", 7, main.id);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const claudeText = (call: { prompt: string }) =>
    JSON.parse(call.prompt).message.content.find(
      (p: { type: string }) => p.type === "text",
    ).text as string;
  const branch = calls.find(
    (c) => c.provider === "claude" && c.prompt?.includes("BRANCH question"),
  );
  expect(branch.args).toEqual(
    expect.arrayContaining([
      "--resume=fixture-claude",
      "--fork-session",
      "--resume-session-at=fixture-assistant",
    ]),
  );
  expect(claudeText(branch)).toContain(
    "side conversation branching off your answer",
  );
  expect(claudeText(branch)).not.toContain("MAIN question");
  const codex = calls.find((c) => c.turn)!.turn.input[0].text as string;
  expect(codex).toContain('side conversation about the message marked "focus"');
  expect(codex).toContain("general discussion of the linked project");
  expect(codex).toContain("Handoff note from Claude");
  const history = JSON.parse(
    codex.slice(codex.indexOf("[", codex.indexOf("Conversation updates"))),
  );
  expect(history.map((m: { body: string }) => m.body)).toEqual([
    "@claude MAIN question",
    main.body,
    "@claude BRANCH question",
    "Claude found the same cache guard.",
  ]);
  expect(history[1].focus).toBe(true);
  // Codex answered last, on the side; Claude still holds the main conversation.
  expect(chats.list(projectId).find((c) => c.id === chat.id)).toMatchObject({
    provider: "codex",
    contextAgent: "claude",
  });
}, 30000);

it("forks a thread at an answer, and its first turn continues that answer's session", async () => {
  const ask = async (chatId: string, body: string, count: number) => {
    await chats.send(chatId, { ...input(body), provider: "claude" });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chatId)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
    return (await chats.get(chatId)).messages.at(-1)!;
  };
  const chat = await chats.create(projectId, { kind: "project" });
  const first = await ask(chat.id, "@claude FIRST question", 2);
  await ask(chat.id, "@claude LATER question", 4);
  const fork = await chats.fork(chat.id, first.id);
  const forked = await chats.get(fork.id);
  expect(forked.messages.map((m) => m.body)).toEqual([
    "@claude FIRST question",
    first.body,
  ]);
  expect(forked.messages.map((m) => m.id)).not.toContain(first.id);
  expect(forked.forkedAt).toBe(forked.messages[1].id);
  expect((await chats.get(chat.id)).messages).toHaveLength(4);

  await ask(fork.id, "@claude FORKED question", 4);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const call = calls.find(
    (c) => c.provider === "claude" && c.prompt?.includes("FORKED question"),
  );
  expect(call.args).toEqual(
    expect.arrayContaining([
      "--resume=fixture-claude",
      "--fork-session",
      "--resume-session-at=fixture-assistant",
    ]),
  );
  const text = JSON.parse(call.prompt).message.content.find(
    (p: { type: string }) => p.type === "text",
  ).text as string;
  expect(text).toContain("forked from another after your answer");
  expect(text).not.toContain("FIRST question");
  expect(text).not.toContain("LATER question");
}, 30000);

it("discovers an enabled skill and sends its native input to Codex without trusting a renderer path", async () => {
  const { codexSkills } = await import("../agents/provider-commands");
  const skills = await codexSkills(join(root, "repo"));
  expect(skills.map((s) => s.name)).toEqual(["explain"]);
  const discovery = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(discovery).toEqual([expect.objectContaining({ discovery: true })]);
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(
    chats.send(chat.id, input("@codex /skill:disabled-skill check it")),
  ).rejects.toThrow(/no longer available/);
  expect((await chats.get(chat.id)).messages).toHaveLength(0);
  await chats.send(chat.id, input("@codex Explain the cache using $explain"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.turn).turn.input).toContainEqual({
    type: "skill",
    name: "explain",
    path: join(root, "repo/.agents/skills/explain/SKILL.md"),
  });
});

it("steers an active Codex turn natively and resumes its saved session after stop", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Focus only on the cache key"),
    parentId: null,
    delivery: "steer" as const,
  };
  await chats.send(chat.id, followup);
  expect((await chats.get(chat.id)).queue).toHaveLength(0);
  expect((await chats.get(chat.id)).messages.at(-1)?.id).toBe(followup.id);
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages.find((m) => m.role === "assistant")
        ?.status,
    ).toBe("cancelled"),
  );
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.resume(chat.id);
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.steer)?.steer).toMatchObject({
    threadId: "fixture-thread",
    expectedTurnId: "fixture-turn",
    input: [{ type: "text", text: "Focus only on the cache key" }],
  });
  expect(calls.some((c) => c.interrupt)).toBe(true);
  expect(calls.filter((c) => c.turn).at(-1).turn.input[0].text).not.toContain(
    "Focus only on the cache key",
  );
  expect(calls.filter((c) => c.thread).map((c) => c.method)).toEqual([
    "thread/start",
    "thread/resume",
  ]);
}, 15000);

it("steers an active Codex turn with a screenshot", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Look at this"),
    parentId: null,
    delivery: "steer" as const,
    images: [
      {
        name: "screen.png",
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  };
  await chats.send(chat.id, followup);
  const saved = await chats.get(chat.id);
  expect(saved.queue).toHaveLength(0);
  const steered = saved.messages.find((m) => m.id === followup.id);
  expect(steered?.steered).toBe(true);
  expect(steered?.images).toHaveLength(1);
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  expect(calls.find((c) => c.steer)?.steer.input).toEqual([
    expect.objectContaining({ type: "text", text: "Look at this" }),
    expect.objectContaining({ type: "localImage" }),
  ]);
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
});

it("shows a stop at once and sends the next message once the agent lets go", async () => {
  vi.stubEnv("RELAY_FIXTURE_STOP_DELAY", "1500");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
        "cache guard",
      ),
    { timeout: 6000 },
  );
  const answerId = (await chats.get(chat.id)).messages.at(-1)!.id;
  const stoppedAt = Date.now();
  await chats.cancel(chat.id);
  const shown = events.filter((e) => e.message.id === answerId).at(-1)?.message;
  expect(shown?.status).toBe("cancelled");
  expect(Date.now() - stoppedAt).toBeLessThan(500);
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.running,
  ).toBeUndefined();
  // The agent is still winding down; the next message waits for it.
  expect(chats.hasActiveProject(projectId)).toBe(true);
  const next = input("@codex carry on");
  await chats.send(chat.id, next);
  expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(1400);
  const saved = await chats.get(chat.id);
  expect(saved.queue ?? []).toHaveLength(0);
  expect(saved.messages.find((m) => m.id === answerId)?.status).toBe(
    "cancelled",
  );
  expect(saved.messages.some((m) => m.id === next.id)).toBe(true);
}, 15000);

it("resumes a stopped answer with the agent picked since", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
        "cache guard",
      ),
    { timeout: 6000 },
  );
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  const choice = { model: "", reasoningEffort: "" as const, fast: false };
  await chats.resume(chat.id, {
    provider: "claude",
    choice,
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 8000 },
  );
  const after = await chats.get(chat.id);
  expect(after.messages.at(-1)?.provider).toBe("claude");
  expect(after.lastInput).toMatchObject({ provider: "claude", choice });
  expect(after.lastInput?.body).toMatch(/^@claude Continue/);
}, 15000);

it("tells an agent about steering that went to the other agent", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const idle = () =>
    vi.waitFor(
      async () => {
        expect((await chats.get(chat.id)).messages.at(-1)?.status).not.toBe(
          "streaming",
        );
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude Explain the cache guard"));
  await idle();
  await chats.send(chat.id, input("@codex wait for cancellation"));
  // Claude's handoff note comes first; steer Codex's own answer.
  await vi.waitFor(
    async () => {
      const last = (await chats.get(chat.id)).messages.at(-1);
      expect(last?.provider).toBe("codex");
      expect(last?.body).toContain("cache guard");
    },
    { timeout: 6000 },
  );
  await chats.send(chat.id, {
    ...input("@codex Focus only on the cache key"),
    delivery: "steer",
  });
  expect((await chats.get(chat.id)).messages.at(-1)?.steered).toBe(true);
  await chats.cancel(chat.id);
  await idle();
  await chats.send(chat.id, claude("@claude Carry on"));
  await idle();
  const prompt = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.provider === "claude" && !c.args.includes("--print"))
    .map((c) => JSON.parse(c.prompt).message.content[0].text as string)
    .find((text) => text.startsWith("My request: Carry on"))!;
  expect(prompt).toContain("Focus only on the cache key");
}, 30000);

it("drains queued follow-ups in order and retains a paused queue across restart", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2600");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex First"));
  const second = input("@codex Second"),
    third = input("@codex Third");
  await chats.send(chat.id, second);
  await chats.send(chat.id, third);
  await chats.send(chat.id, second);
  expect((await chats.get(chat.id)).queue).toHaveLength(2);
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.filter(
          (m) => m.role === "assistant" && m.status === "complete",
        ),
      ).toHaveLength(3),
    { timeout: 15000 },
  );
  expect(
    (await chats.get(chat.id)).messages
      .filter((m) => m.role === "user")
      .map((m) => m.body),
  ).toEqual(["@codex First", "@codex Second", "@codex Third"]);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.send(chat.id, input("@codex wait for cancellation"));
  const held = input("@codex Held for later");
  await chats.send(chat.id, held);
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), (e) =>
    events.push(e),
  );
  expect((await chats.get(chat.id)).queuePaused).toBe(true);
  expect((await chats.get(chat.id)).queue?.[0].input.id).toBe(held.id);
  await chats.queueAction(chat.id, "remove", held.id);
  expect((await chats.get(chat.id)).queue).toHaveLength(0);
}, 20000);

it("leaves a paused queue paused when Relay sends Claude's wake-up itself", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  const held = input("@codex Held for later");
  await chats.send(chat.id, held);
  await chats.dispose();
  // Kept when Relay closed; sent once it's due after the restart.
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.heldWakeups = [{ id: "w", prompt: "Compare", at: Date.now() }];
  await writeFile(file, JSON.stringify(saved));
  chats = new ProjectChats(store, projects, join(root, "chats"), (e) =>
    events.push(e),
  );
  await (
    chats as unknown as {
      schedule: { fireWakeup(id: string, w: string): Promise<void> };
    }
  ).schedule.fireWakeup(chat.id, "w");
  await vi.waitFor(
    () => expect(chats.hasActiveProject(projectId)).toBe(false),
    { timeout: 10000 },
  );
  const after = await chats.get(chat.id);
  expect(after.queuePaused).toBe(true);
  expect(after.queue?.map((q) => q.input.id)).toEqual([held.id]);
}, 20000);

/** Fires a thread's planned resume now instead of after the limit lifts. */
const fireLimitResume = (id: string) =>
  (
    chats as unknown as { limits: { fire(id: string): Promise<void> } }
  ).limits.fire(id);

it("resumes an answer a usage limit stopped once the limit lifts, and picks its queue back up", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "1500");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit"));
  await chats.send(chat.id, input("@codex Queued meanwhile"));
  await vi.waitFor(
    () => expect(chats.list(projectId)[0].limitResume).toBeDefined(),
    { timeout: 8000 },
  );
  const plan = chats.list(projectId)[0].limitResume!;
  const stopped = await chats.get(chat.id);
  const failed = stopped.messages.at(-1)!;
  expect(failed).toMatchObject({
    status: "failed",
    error: "You've hit your usage limit.",
  });
  expect(plan).toMatchObject({ messageId: failed.id, provider: "codex" });
  // Codex said seconds; the plan keeps milliseconds, ten minutes out.
  expect(plan.at - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(plan.at - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  expect(stopped.queuePaused).toBe(true);
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), (e) =>
    events.push(e),
  );
  expect(chats.list(projectId)[0].limitResume).toEqual(plan);
  await fireLimitResume(chat.id);
  await vi.waitFor(
    async () => {
      const after = await chats.get(chat.id);
      expect(
        after.messages.filter((m) => m.role === "user").map((m) => m.body),
      ).toEqual([
        "@codex fixture usage limit",
        expect.stringMatching(/^@codex Continue from where/),
        "@codex Queued meanwhile",
      ]);
      expect(after.messages.at(-1)?.status).toBe("complete");
    },
    { timeout: 15000 },
  );
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
}, 30000);

it("carries an answer a usage limit stopped on with the next account at once, and keeps the thread on it", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "1500");
  vi.stubEnv("CODEX_HOME", join(root, "codex-home"));
  setProfilesRoot(join(root, "agent-accounts"));
  await store.update((s) => {
    s.agentAccounts = {
      accounts: [
        { provider: "codex", id: "default", label: "Personal" },
        { provider: "codex", id: "work", label: "Work" },
      ],
    };
  });
  const work = await prepareProfile("codex", "work");
  await writeFile(
    join(work, "auth.json"),
    JSON.stringify({ tokens: { access_token: "work-token" } }),
  );
  const room = async (provider: "claude" | "codex") => ({
    provider,
    message: null,
    windows: [],
  });
  new AgentAccounts(store, () => {}, room);
  try {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, input("@codex fixture usage limit"));
    await vi.waitFor(
      async () => {
        const after = await chats.get(chat.id);
        expect(after.messages.at(-1)?.status).toBe("complete");
        expect(
          after.messages.filter((m) => m.role === "user").map((m) => m.body),
        ).toEqual([
          "@codex fixture usage limit",
          expect.stringMatching(/^@codex Continue from where/),
        ]);
      },
      { timeout: 15000 },
    );
    const after = await chats.get(chat.id);
    expect(after.messages.find((m) => m.status === "failed")).toMatchObject({
      accountMove: { provider: "codex", from: "Personal", to: "Work" },
    });
    expect(after.accounts).toEqual({ codex: "work" });
    expect(after.limitResume).toBeUndefined();
    // New threads start on it too.
    expect(accountFor("codex")).toBe("work");
  } finally {
    await store.update((s) => {
      delete s.agentAccounts;
    });
  }
}, 30000);

it("fails a turn whose agent is signed out with that agent's sign-in offered, and plans no resume", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture codex signed out"));
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("failed");
    },
    { timeout: 8000 },
  );
  const failed = (await chats.get(chat.id)).messages.at(-1)!;
  expect(failed).toMatchObject({
    signIn: "codex",
    error: "Codex is signed out. Sign in again, then resume the answer.",
  });
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
});

it("plans no resume for a usage limit that says nothing of when it lifts", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit without reset"));
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("failed");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 8000 },
  );
  const failed = (await chats.get(chat.id)).messages.at(-1)!;
  expect(failed).toMatchObject({ error: "You've hit your usage limit." });
  expect(failed.signIn).toBeUndefined();
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
}, 20000);

it("drops the planned resume when the thread moves on, and resumes nothing it no longer fits", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture usage limit"));
  await vi.waitFor(
    () => expect(chats.list(projectId)[0].limitResume).toBeDefined(),
    { timeout: 8000 },
  );
  const plan = chats.list(projectId)[0].limitResume!;
  await chats.setLimitResume(chat.id, false);
  expect(chats.list(projectId)[0].limitResume?.off).toBe(true);
  await chats.setLimitResume(chat.id, true);
  expect(chats.list(projectId)[0].limitResume?.off).toBeUndefined();
  await chats.send(chat.id, input("@codex Something else first"));
  expect(chats.list(projectId)[0].limitResume).toBeUndefined();
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 8000 },
  );
  // A plan left over from before, as a save from another build might hold.
  await chats.dispose();
  const file = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.limitResume = plan;
  await writeFile(file, JSON.stringify(saved));
  chats = new ProjectChats(store, projects, join(root, "chats"), (e) =>
    events.push(e),
  );
  const before = (await chats.get(chat.id)).messages.length;
  await fireLimitResume(chat.id);
  const after = await chats.get(chat.id);
  expect(after.messages).toHaveLength(before);
  expect(after.limitResume).toBeUndefined();
  expect(chats.hasActiveProject(projectId)).toBe(false);
}, 30000);

it("holds a Send later message until its time, sends it now on request, and keeps it across restart", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const soon = input("Check the deploy.");
  await chats.send(chat.id, { ...soon, sendAt: Date.now() + 400 });
  let saved = await chats.get(chat.id);
  expect(saved.messages).toHaveLength(0);
  expect(saved.scheduled?.[0]).toMatchObject({ input: { id: soon.id } });
  expect(saved.scheduled?.[0].input.sendAt).toBeUndefined();
  expect(chats.list(projectId)[0].nextSend).toBe(saved.scheduled?.[0].at);
  // A thread started with Send later stays in the sidebar while it waits.
  expect(chats.list(projectId)[0].empty).toBe(false);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.map((m) => m.id)).toEqual([
      soon.id,
    ]),
  );
  expect((await chats.get(chat.id)).scheduled).toBeUndefined();
  expect(chats.list(projectId)[0].nextSend).toBeUndefined();

  await expect(
    chats.send(chat.id, { ...input("Too late"), sendAt: Date.now() - 1000 }),
  ).rejects.toThrow("future");
  const now = input("Send me early."),
    dropped = input("Never mind.");
  await chats.send(chat.id, { ...now, sendAt: Date.now() + 3_600_000 });
  const shot = {
    name: "s.png",
    mimeType: "image/png" as const,
    dataUrl: "data:image/png;base64,AAAA",
  };
  await chats.send(chat.id, {
    ...dropped,
    images: [shot],
    sendAt: Date.now() + 3_600_000,
  });
  // A phone takes a waiting message's screenshots before it takes the message out.
  expect(await chats.queuedImages(chat.id, dropped.id)).toEqual([shot]);
  expect(await chats.queuedImages(chat.id, now.id)).toEqual([]);
  await chats.queueAction(chat.id, "steer", now.id);
  await chats.queueAction(chat.id, "remove", dropped.id);
  await expect(chats.queuedImages(chat.id, dropped.id)).rejects.toThrow(
    "no longer waiting",
  );
  saved = await chats.get(chat.id);
  expect(saved.messages.map((m) => m.id)).toEqual([soon.id, now.id]);
  expect(saved.scheduled).toBeUndefined();

  // Due while Relay was closed: it goes out once Relay arms it again.
  const missed = input("Sent after restart.");
  await chats.send(chat.id, { ...missed, sendAt: Date.now() + 300 });
  await chats.dispose();
  await new Promise((r) => setTimeout(r, 400));
  chats = new ProjectChats(store, projects, join(root, "chats"), (e) =>
    events.push(e),
  );
  expect((await chats.get(chat.id)).scheduled).toHaveLength(1);
  chats.armWakeups();
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.id).toBe(missed.id),
  );
});
it("lists and rolls back only the files a turn's agent changed", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input("@codex fixture edit files and a stray file"),
  );
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 10000 },
  );
  const answer = (await chats.get(chat.id)).messages.at(-1)!;
  expect(answer.changes?.map((f) => f.path)).toEqual([
    "README.md",
    "src/guard.ts",
  ]);
  const repo = join(root, "repo");
  await chats.rewindTurn(chat.id, answer.id, null, "revert", false);
  await expect(readFile(join(repo, "src", "guard.ts"))).rejects.toThrow();
  expect(await readFile(join(repo, "stray.md"), "utf8")).toBe("Stray.\n");
}, 20000);
it("shows the branch a turn left the checkout on, not the one it started on", async () => {
  const repo = join(root, "repo");
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=T", "-c", "user.email=t@t", ...args],
      { cwd: repo },
    );
  git("switch", "-q", "-c", "main");
  git("commit", "-q", "--allow-empty", "-m", "start");
  git("switch", "-q", "-c", "feature");
  const chat = await chats.create(projectId, { kind: "project" });
  const turn = async (body: string) => {
    const sent = input(body);
    await chats.send(chat.id, sent);
    await vi.waitFor(
      async () => {
        const saved = await chats.get(chat.id);
        expect(saved.messages.at(-1)?.status).toBe("complete");
        expect(saved.messages.at(-2)?.id).toBe(sent.id);
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
    return (await chats.get(chat.id)).branch;
  };
  expect(await turn("@codex fixture switch branch to main")).toBe("main");
  // A detached checkout is on no branch; the old name would be a lie.
  expect(
    await turn("@codex fixture switch branch to detached"),
  ).toBeUndefined();
}, 30000);
it("stops during provider initialization without waiting for the RPC timeout", async () => {
  vi.stubEnv("RELAY_AGENT_HOLD_INITIALIZE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Start"));
  await vi.waitFor(async () =>
    expect(await agentCalls()).toContain('"initializing"'),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
        status: "cancelled",
        body: "",
      });
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 2000 },
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.error).toBeUndefined();
});

it("has saved the stopped answer and its sidebar summary once dispose returns", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  await chats.dispose();
  const saved = JSON.parse(
    await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
  );
  expect(saved.messages.at(-1).status).toBe("cancelled");
  expect(store.get().chats?.find((c) => c.id === chat.id)?.updated).toBe(
    saved.updated,
  );
});

it("queues incompatible steering first without pausing or changing permissions", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  const followup = {
    ...input("@codex Change the cache"),
    runtimeMode: "auto-accept-edits" as const,
    delivery: "steer" as const,
  };
  await chats.send(chat.id, input("@codex Earlier"));
  await chats.send(chat.id, followup);
  const saved = await chats.get(chat.id);
  expect(saved.queuePaused).toBeFalsy();
  expect(saved.queue?.map((q) => q.input.id)[0]).toBe(followup.id);
  expect(saved.queue?.[0].error).toBeUndefined();
  expect(saved.messages.some((m) => m.id === followup.id)).toBe(false);
  expect(await agentCalls()).not.toContain('"steer"');
  await chats.queueAction(chat.id, "move", followup.id, 1);
  expect((await chats.get(chat.id)).queue?.map((q) => q.input.body)).toEqual([
    "@codex Earlier",
    "@codex Change the cache",
  ]);
  await chats.queueAction(chat.id, "remove", followup.id);
  expect((await chats.get(chat.id)).queue).toHaveLength(1);
});

it.each(["accept", "decline", "acceptForSession"] as const)(
  "waits for a local %s approval and never persists the request",
  async (decision) => {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, input("@codex fixture request approval"));
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    const request = (await chats.sync(chat.id)).requests![0];
    expect(request).toMatchObject({
      kind: "approval",
      detail: expect.stringContaining("npm test"),
    });
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "streaming",
    );
    expect(await agentCalls()).not.toContain('"response"');
    expect(
      await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
    ).not.toContain("Run this command?");
    expect(() =>
      chats.respond(chat.id, request.id, { kind: "question", answers: {} }),
    ).toThrow("Invalid response type");
    chats.respond(chat.id, request.id, { kind: "approval", decision });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.find((c) => c.response).response.result).toEqual({ decision });
    expect((await chats.get(chat.id)).requests).toEqual([]);
    expect(() =>
      chats.respond(chat.id, request.id, { kind: "approval", decision }),
    ).toThrow();
  },
  10000,
);

it("stops while awaiting approval without leaving a request or replaying queued work", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture request approval"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  await chats.send(chat.id, input("@codex keep this queued"));
  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  const state = await chats.get(chat.id);
  expect(state.requests).toEqual([]);
  expect(state.queuePaused).toBe(true);
  expect(state.queue).toHaveLength(1);
  expect(state.messages.at(-1)?.error).toBeUndefined();
}, 10000);

it("uses native Plan mode and answers harness questions without adding answers to chat", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@codex fixture ask question"),
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  const request = (await chats.get(chat.id)).requests![0];
  expect(request.kind).toBe("question");
  expect(() =>
    chats.respond(chat.id, request.id, { kind: "question", answers: {} }),
  ).toThrow("Answer each question");
  chats.respond(chat.id, request.id, {
    kind: "question",
    answers: { approach: ["Small change"] },
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls.find((c) => c.turn).turn).toMatchObject({
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
    collaborationMode: { mode: "plan" },
  });
  expect(calls.find((c) => c.response).response.result).toEqual({
    answers: { approach: { answers: ["Small change"] } },
  });
  expect(
    await readFile(join(root, "chats", chat.id + ".json"), "utf8"),
  ).not.toContain("Small change");
}, 10000);

it("replaces automatic review policy when returning to Full access in a saved thread", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const runtimeMode of [
    "auto",
    "auto-accept-edits",
    "full-access",
  ] as const) {
    await chats.send(chat.id, {
      ...input("@codex Explain the cache"),
      runtimeMode,
    });
    await vi.waitFor(
      async () =>
        expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
          "complete",
        ),
      { timeout: 6000 },
    );
    await vi.waitFor(() =>
      expect(chats.hasActiveProject(projectId)).toBe(false),
    );
  }
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter((c) => c.turn).map((c) => c.turn);
  expect(
    turns.map((t) => [
      t.approvalPolicy,
      t.approvalsReviewer,
      t.sandboxPolicy.type,
    ]),
  ).toEqual([
    ["on-request", "auto_review", "workspaceWrite"],
    ["on-request", "user", "workspaceWrite"],
    ["never", "user", "dangerFullAccess"],
  ]);
  expect(calls.filter((c) => c.thread)).toHaveLength(1);
}, 15000);

it("treats the approval menu's Cancel as a neutral stop", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture request approval"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  const request = (await chats.get(chat.id)).requests![0];
  await chats.respond(chat.id, request.id, {
    kind: "approval",
    decision: "cancel",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "cancelled",
    ),
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.error).toBeUndefined();
}, 10000);

it.each(["accept", "decline", "acceptForSession"] as const)(
  "answers Claude SDK permission callbacks with %s",
  async (decision) => {
    const chat = await chats.create(projectId, { kind: "project" });
    await chats.send(chat.id, {
      ...input("@claude fixture request approval"),
      provider: "claude",
      runtimeMode: "auto-accept-edits",
    });
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    const request = (await chats.get(chat.id)).requests![0];
    expect(request.title).toBe("Allow Bash?");
    chats.respond(chat.id, request.id, { kind: "approval", decision });
    await vi.waitFor(
      async () =>
        expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
          "complete",
        ),
      { timeout: 6000 },
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const call = calls.find((c) => c.claudeResponse);
    expect(call.args).toContain("acceptEdits");
    expect(call.claudeResponse.response.response.behavior).toBe(
      decision === "decline" ? "deny" : "allow",
    );
    if (decision === "acceptForSession")
      expect(call.claudeResponse.response.response.updatedPermissions).toEqual([
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "npm test" }],
          behavior: "allow",
          destination: "session",
        },
      ]);
  },
  10000,
);

it("shows Claude planning questions and captures ExitPlanMode as a proposal without granting edits", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude fixture ask question"),
    provider: "claude",
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).requests).toHaveLength(1),
  );
  chats.respond(chat.id, (await chats.get(chat.id)).requests![0].id, {
    kind: "question",
    answers: { "0": ["Small change"] },
  });
  // "complete" shows a moment before the turn gives the thread back.
  await vi.waitFor(
    async () => {
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      );
      expect(chats.hasActiveProject(projectId)).toBe(false);
    },
    { timeout: 6000 },
  );
  await chats.send(chat.id, {
    ...input("@claude fixture propose plan"),
    provider: "claude",
    interactionMode: "plan",
    runtimeMode: "full-access",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const state = await chats.get(chat.id);
  expect(state.messages.at(-1)).toMatchObject({
    proposedPlan: true,
    body: expect.stringContaining("## Proposed plan"),
  });
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const responses = calls.filter((c) => c.claudeResponse);
  expect(responses[0].args).toContain("plan");
  expect(
    responses[0].claudeResponse.response.response.updatedInput.answers,
  ).toEqual({
    "Which approach should the plan use?": ["Small change"].join(", "),
  });
  expect(responses.at(-1).claudeResponse.response.response.behavior).toBe(
    "deny",
  );
}, 15000);

it.each(["codex", "claude"] as const)(
  "keeps %s session approvals across turns but isolates a new thread",
  async (provider) => {
    const chat = await chats.create(projectId, { kind: "project" });
    const request = () => ({
      ...input(`@${provider} fixture request approval`),
      provider,
    });
    await chats.send(chat.id, request());
    await vi.waitFor(async () =>
      expect((await chats.get(chat.id)).requests).toHaveLength(1),
    );
    chats.respond(chat.id, (await chats.get(chat.id)).requests![0].id, {
      kind: "approval",
      decision: "acceptForSession",
    });
    await vi.waitFor(async () =>
      expect(chats.hasActiveProject(projectId)).toBe(false),
    );
    await chats.send(chat.id, request());
    await vi.waitFor(
      async () =>
        expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
          "complete",
        ),
      { timeout: 6000 },
    );
    const calls = (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const turns = calls.filter((c) =>
      provider === "codex"
        ? c.turn && !c.turn.input[0].text.startsWith("Generate a short title")
        : c.provider === "claude" &&
          c.args.includes("--permission-prompt-tool") &&
          c.prompt.includes("fixture request approval"),
    );
    expect(turns).toHaveLength(2);
    expect(turns[0].pid).toBe(turns[1].pid);
    expect(calls.filter((c) => c.response || c.claudeResponse)).toHaveLength(1);
    const other = await chats.create(projectId, { kind: "project" });
    await chats.send(other.id, request());
    await vi.waitFor(async () =>
      expect((await chats.get(other.id)).requests).toHaveLength(1),
    );
    await chats.cancel(other.id);
  },
  12000,
);

it("resumes Claude's own saved session after restart without mixing Codex's cursor", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  // An answer reads complete before its turn lets go of the thread; asked
  // then, Claude would only queue, and the restart would drop it.
  const finished = (provider: "codex" | "claude") =>
    vi.waitFor(
      async () => {
        expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
          provider,
          status: "complete",
        });
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 6000 },
    );
  await chats.send(chat.id, input("@codex Explain cache guard"));
  await finished("codex");
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await finished("claude");
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const saved = await chats.get(chat.id);
  expect(saved.sessions?.codex?.thread).toBe("fixture-thread");
  expect(saved.sessions?.claude?.thread).toBe("fixture-claude");
  await chats.send(chat.id, {
    ...input("@claude Continue with the next step"),
    provider: "claude",
  });
  await finished("claude");
  const calls = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const turns = calls.filter(
    (c) =>
      c.provider === "claude" && c.args.includes("--permission-prompt-tool"),
  );
  expect(turns.at(-1).args).toContain("--resume=fixture-claude");
  expect(turns.at(-1).args.join(" ")).not.toContain("fixture-thread");
  expect(turns.at(-1).prompt).not.toContain(
    "Claude found the same cache guard.",
  );
}, 12000);
it("keeps a shared thread's local handoff note where it happened when others' messages arrive", async () => {
  let seq = 0;
  const others: ChatMessage[] = [];
  const sharing = {
    allow: async () => {},
    share: async () => ({
      roomId: "room",
      server: "https://relay.invalid",
      memberId: "me",
    }),
    send: async (_: unknown, messages: ChatMessage[]) =>
      messages.map((m) => ({ ...m, author: "Me", seq: ++seq })),
    poll: async (_: unknown, after: number) => ({
      conversation: { updated: 0 },
      messages: others.filter((m) => m.seq! > after),
      next: seq,
      more: false,
    }),
  } as unknown as ConstructorParameters<typeof ProjectChats>[4];
  await chats.dispose();
  chats = new ProjectChats(
    store,
    projects,
    join(root, "chats"),
    () => {},
    sharing,
  );
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.share(chat.id);
  for (const [body, count] of [
    ["@codex Explain the cache guard", 2],
    ["@claude Now fix it", 5],
  ] as const) {
    await chats.send(chat.id, {
      ...input(body),
      provider: body.startsWith("@claude") ? "claude" : "codex",
    });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  }
  others.push({
    id: randomUUID(),
    role: "user",
    body: "Bob: looks good",
    status: "complete",
    created: Date.now(),
    provider: "codex",
    version: 1,
    author: "Bob",
    seq: ++seq,
  });
  const synced = await chats.sync(chat.id);
  expect(synced.messages.map((m) => (m.handoff ? "handoff" : m.body))).toEqual([
    "@codex Explain the cache guard",
    "The cache guard prevents duplicate requests.",
    "@claude Now fix it",
    "handoff",
    "Claude found the same cache guard.",
    "Bob: looks good",
  ]);
}, 30000);
const captured = async () =>
  (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
it("answers /btw from Claude's session beside its running turn, and remembers the side thread", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude fixture wait for steer"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).sessions?.claude?.thread).toBeTruthy(),
    { timeout: 6000 },
  );
  const question = {
    ...claude("@claude where is the cache guard?"),
    side: true as const,
  };
  await chats.send(chat.id, question);
  const answered = async () => {
    const saved = await chats.get(chat.id);
    const answers = saved.messages.filter(
      (m) => m.parentId === question.id && m.role === "assistant",
    );
    expect(answers.every((m) => m.status === "complete")).toBe(true);
    return { saved, answers };
  };
  const first = await vi.waitFor(answered, { timeout: 6000 });
  expect(first.answers.map((m) => m.body)).toEqual([
    "On the side: where is the cache guard?",
  ]);
  expect(first.saved.messages.find((m) => m.id === question.id)?.side).toBe(
    true,
  );
  // The main turn kept running, and nothing waited behind it.
  expect(first.saved.messages[1]!.status).toBe("streaming");
  expect(first.saved.queue ?? []).toEqual([]);
  // Claude's side question is text only: a screenshot fails loudly, not silently.
  await expect(
    chats.send(chat.id, {
      ...claude("@claude what's in this?"),
      parentId: question.id,
      images: [
        {
          name: "screen.png",
          mimeType: "image/png",
          dataUrl: `data:image/png;base64,${tinyPng}`,
        },
      ],
    }),
  ).rejects.toThrow("can't see screenshots in a side conversation");
  await chats.send(chat.id, {
    ...claude("@claude and why?"),
    parentId: question.id,
  });
  await vi.waitFor(
    async () => expect((await answered()).answers).toHaveLength(2),
    { timeout: 6000 },
  );
  const asked = (await captured()).filter((c) => c.side);
  expect(asked.map((c) => c.side.question)).toEqual([
    "where is the cache guard?",
    "and why?",
  ]);
  expect(asked[1].side.history).toEqual([
    {
      question: "where is the cache guard?",
      response: "On the side: where is the cache guard?",
    },
  ]);
});
it("fails a /btw question outright when its folder is gone, instead of leaving an answer streaming", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const claude = (body: string) => ({
    ...input(body),
    provider: "claude" as const,
  });
  await chats.send(chat.id, claude("@claude fixture wait for steer"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).sessions?.claude?.thread).toBeTruthy(),
    { timeout: 6000 },
  );
  vi.spyOn(projects, "root").mockRejectedValue(new Error("Folder is gone."));
  const before = (await chats.get(chat.id)).messages.length;
  await expect(
    chats.send(chat.id, {
      ...claude("@claude where is the cache guard?"),
      side: true as const,
    }),
  ).rejects.toThrow("Folder is gone.");
  expect((await chats.get(chat.id)).messages).toHaveLength(before);
});
it("asks /btw of a read-only Codex fork while its turn runs, and keeps it from the main session", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex wait for cancellation"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).sessions?.codex?.thread).toBeTruthy(),
    { timeout: 6000 },
  );
  const question = {
    ...input("@codex which test covers the guard?"),
    side: true as const,
    images: [
      {
        name: "screen.png",
        mimeType: "image/png" as const,
        dataUrl: `data:image/png;base64,${tinyPng}`,
      },
    ],
  };
  await chats.send(chat.id, question);
  await vi.waitFor(
    async () =>
      expect(
        (await chats.get(chat.id)).messages.find(
          (m) => m.parentId === question.id,
        )?.status,
      ).toBe("complete"),
    { timeout: 6000 },
  );
  expect((await chats.get(chat.id)).messages[1]!.status).toBe("streaming");
  const fork = (await captured()).find((c) => c.method === "thread/fork");
  // The whole thread, its running turn included, in a sandbox that can't write.
  expect(fork.thread.lastTurnId).toBeUndefined();
  expect(fork.thread.sandbox).toBe("read-only");
  expect(fork.thread.developerInstructions).toContain(
    "You are in a side conversation",
  );
  const asked = (await captured()).find((c) =>
    c.turn?.input.some((i: { text?: string }) =>
      i.text?.includes("which test covers"),
    ),
  );
  expect(asked.turn.input).toContainEqual(
    expect.objectContaining({ type: "localImage" }),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages[1]!.status).toBe("cancelled"),
    { timeout: 6000 },
  );
  await chats.send(chat.id, input("@codex Now fix it"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  const main = (await captured()).filter((c) =>
    c.turn?.input.some((i: { text?: string }) =>
      i.text?.includes("Now fix it"),
    ),
  );
  expect(main).toHaveLength(1);
  expect(JSON.stringify(main[0].turn.input)).not.toContain("which test covers");
}, 20000);
it("keeps a handed-over thread's briefing for the retry when its first turn fails", async () => {
  const cli = await findExecutable("codex");
  vi.mocked(findExecutable).mockRejectedValue(
    new Error("Codex isn't installed"),
  );
  const { id } = await chats.adopt(
    projectId,
    {
      from: "Laptop",
      repositories: [],
      title: "Changelog",
      scope: { kind: "project" },
      settings: { ...input(""), body: undefined, id: undefined } as never,
      messages: [],
      git: {} as never,
    },
    { id: randomUUID(), computer: "Laptop", deviceId: "d", at: 1, tip: "x" },
    { path: projects.get(projectId)!.path, branch: "main" },
  );
  const settled = (status: string) =>
    vi.waitFor(
      async () => {
        expect((await chats.get(id)).messages.at(-1)?.status).toBe(status);
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 8000 },
    );
  await settled("failed");
  vi.mocked(findExecutable).mockResolvedValue(cli);
  const prompts = async () =>
    (await agentCalls())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((c) => c.turn)
      .map((c) =>
        (c.turn.input as { text?: string }[]).map((i) => i.text).join("\n"),
      );
  await chats.send(id, input("@codex Try again"));
  await settled("complete");
  expect((await prompts()).at(-1)).toContain(
    "handed over from another computer",
  );
  // Told once it went through.
  await chats.send(id, input("@codex And then?"));
  await settled("complete");
  expect((await prompts()).at(-1)).not.toContain(
    "handed over from another computer",
  );
}, 30000);

it("pushes the thread list as a turn runs, waits and ends, and as it's triaged", async () => {
  // As main.ts wires it, without waiting for more changes.
  const pushed: ChatSummary[][] = [];
  const feed = new ChatSummaryFeed(
    (id) => chats.list(id),
    (e) => pushed.push(e.chats),
    0,
  );
  chats.onSummaries((id) => feed.changed(id));
  const chat = await chats.create(projectId, { kind: "project" });
  const latest = () => pushed.at(-1)?.find((c) => c.id === chat.id);
  await chats.send(chat.id, input("@codex fixture request approval"));
  await vi.waitFor(() => expect(latest()?.waiting).toBe(true));
  expect(latest()?.running).toBe(true);
  const [request] = (await chats.get(chat.id)).requests!;
  chats.respond(chat.id, request!.id, { kind: "approval", decision: "accept" });
  await vi.waitFor(() => expect(latest()?.waiting).toBe(false));
  await vi.waitFor(() => expect(latest()?.running).toBeUndefined(), {
    timeout: 6000,
  });
  const until = Date.now() + 60_000;
  await chats.triage(chat.id, { kind: "snooze", until });
  await vi.waitFor(() => expect(latest()?.snoozedUntil).toBe(until));
  // What went out last is what the sidebar would have fetched.
  feed.flush();
  expect(pushed.at(-1)).toEqual(chats.list(projectId));
  // Nothing goes out twice in a row.
  const sent = pushed.map((list) => JSON.stringify(list));
  expect(sent.filter((s, i) => s === sent[i - 1])).toEqual([]);
}, 15000);

it("lists the answering agent while its answer streams, not once the turn ends", async () => {
  vi.stubEnv("RELAY_AGENT_TURN_MS", "2000");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
      "streaming",
    ),
  );
  // The answer's first save had no summary write of its own to ride on.
  await vi.waitFor(() =>
    expect(chats.list(projectId)[0]).toMatchObject({
      running: true,
      provider: "codex",
      contextAgent: "codex",
    }),
  );
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
}, 15000);

it("forks from the latest finished answer when none is named, on that answer's agent", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  for (const [body, count] of [
    ["@codex Cache guard behavior", 2],
    ["@claude Now fix it", 5],
  ] as const) {
    await chats.send(chat.id, {
      ...input(body),
      provider: body.startsWith("@claude") ? "claude" : "codex",
    });
    await vi.waitFor(
      async () => {
        const messages = (await chats.get(chat.id)).messages;
        expect(messages).toHaveLength(count);
        expect(messages.at(-1)?.status).toBe("complete");
        expect(chats.hasActiveProject(projectId)).toBe(false);
      },
      { timeout: 10000 },
    );
  }
  const source = (await chats.get(chat.id)).messages;
  const fork = await chats.fork(chat.id);
  expect(fork.provider).toBe("claude");
  const forked = await chats.get(fork.id);
  // The handoff note Codex left on the way out came along, but isn't the fork point.
  expect(forked.messages.map((m) => m.body)).toEqual(source.map((m) => m.body));
  expect(forked.forkedAt).toBe(forked.messages.at(-1)!.id);
}, 25000);

it("regenerates a title from the whole thread, even over a name you typed", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(chats.regenerateTitle(chat.id)).rejects.toThrow("first answer");
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () => {
      const saved = await chats.get(chat.id);
      expect(saved.title).toBe("Cache guard behavior");
      expect(saved.messages.at(-1)?.status).toBe("complete");
    },
    { timeout: 8000 },
  );
  await chats.rename(chat.id, "My name for it");
  expect(await chats.regenerateTitle(chat.id)).toMatchObject({
    title: "Cache guard rework",
  });
  expect((await chats.get(chat.id)).renamed).toBeUndefined();
  const prompt = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .map((r) => r.turn?.input[0].text ?? "")
    .find((text: string) =>
      text.startsWith("This coding-agent thread already has the title"),
    );
  expect(prompt).toContain('already has the title "My name for it"');
  expect(prompt).toContain("USER:\nExplain the cache guard");
}, 15000);

it("marks a thread unread until it's read again", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.triage(chat.id, { kind: "unread" });
  expect(chats.list(projectId)[0].markedUnread).toBe(true);
  // Reading what was already read still clears the mark.
  await chats.markSeen(chat.id, 0);
  expect(chats.list(projectId)[0].markedUnread).toBeUndefined();
});

it("undoes a settle back to the snooze it cleared, but not once something newer moved the thread", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const until = Date.now() + 3_600_000;
  const snoozed = await chats.triage(chat.id, { kind: "snooze", until });
  const before = triageState(snoozed);
  const settled = await chats.triage(chat.id, { kind: "settle" });
  await chats.triage(chat.id, {
    kind: "restore",
    from: triageState(settled),
    to: before,
  });
  expect(triageState(chats.list(projectId)[0])).toEqual(before);

  const archived = await chats.triage(chat.id, { kind: "archive" });
  // Unsettled from the phone, say, before the archive was undone.
  await chats.triage(chat.id, { kind: "unsettle" });
  await expect(
    chats.triage(chat.id, {
      kind: "restore",
      from: triageState(archived),
      to: before,
    }),
  ).rejects.toThrow("changed since");
  expect(chats.list(projectId)[0].archivedAt).toBe(archived.archivedAt);
});

it("settles a quiet thread by itself until it's moved back by hand", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(chat.updated + 3 * 86_400_000);
    expect(chats.list(projectId)[0]).toMatchObject({
      settledAt: chat.updated,
      autoSettled: true,
    });
    await chats.triage(chat.id, { kind: "auto-settle", enabled: false });
    expect(chats.list(projectId)[0].autoSettled).toBeUndefined();
    await chats.triage(chat.id, { kind: "auto-settle", enabled: true });
    expect(chats.list(projectId)[0].autoSettled).toBe(true);
    await chats.triage(chat.id, { kind: "unsettle" });
    vi.setSystemTime(chat.updated + 30 * 86_400_000);
    expect(chats.list(projectId)[0].settledAt).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
it("keeps a note closed with I know this as known in its thread, and its line in the known list", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.dispose();
  const path = join(root, "chats", chat.id + ".json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const turn = randomUUID();
  const note = (id: string, title: string) => ({
    id,
    tag: "Heads up",
    line: `${title}, in one line.`,
    title,
    points: [],
    created: Date.now(),
  });
  saved.messages.push({
    id: turn,
    role: "assistant",
    provider: "claude",
    created: Date.now(),
    body: "Done.",
    status: "complete",
    version: 1,
    notes: [
      note("n1", "Reruns can't be stopped"),
      note("n2", "Retries hide failures"),
    ],
  });
  await writeFile(path, JSON.stringify(saved));
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  await chats.closeWatchNote(chat.id, turn, "n1", "known", true);
  await chats.closeWatchNote(chat.id, turn, "n2", "told");
  const notes = (await chats.get(chat.id)).messages.find(
    (m) => m.id === turn,
  )!.notes!;
  expect(notes.map((n) => [n.closed, n.known, n.how, n.read])).toEqual([
    [true, true, "known", true],
    [true, undefined, "told", undefined],
  ]);
  expect(store.get().watchKnown).toEqual([
    "Reruns can't be stopped: Reruns can't be stopped, in one line.",
  ]);
});

it("starts a thread whose named branch got taken before its first message on relay/…, and keeps why", async () => {
  const repo = join(root, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "First",
  );
  await expect(
    chats.create(
      projectId,
      { kind: "project" },
      "worktree",
      undefined,
      "my branch",
    ),
  ).rejects.toThrow("Branch names can't contain spaces.");
  const chat = await chats.create(
    projectId,
    { kind: "project" },
    "worktree",
    undefined,
    "feature/cache",
  );
  // Someone else took the name while the thread waited to send.
  git("branch", "feature/cache");
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  expect((await chats.get(chat.id)).worktree).toMatchObject({
    branch: "relay/explain-the-cache-guard",
    wanted: {
      branch: "feature/cache",
      problem: "feature/cache already exists.",
    },
  });
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.worktree?.wanted,
  ).toBeDefined();
}, 15000);
