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
import { Store } from "../../electron/store";
import { Projects } from "../../electron/projects";
import { ProjectChats } from "../../electron/project-chats";
import { findExecutable } from "../../electron/executables";
import { defaultAISettings } from "../../shared/settings";
import { applyChatPatch, type ChatMessage } from "../../shared/projects";
vi.mock("../../electron/executables", async (actual) => ({
  ...(await actual<typeof import("../../electron/executables")>()),
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
  const cli = join(root, "codex");
  await writeFile(
    cli,
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
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
  await rm(root, { recursive: true, force: true });
});
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
});
it("streams locally, persists final answers, and resumes the same Codex session with selected settings", async () => {
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
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
it("generates a separate title when Codex sends no thread name and persists it", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
    { timeout: 8000 },
  );
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.filter((r) => r.turn)).toHaveLength(2);
  expect(requests.filter((r) => r.turn)[1].turn.input[0].text).toContain(
    "Generate a short title",
  );
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
    (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  expect(after.providerThrough).toBe(after.messages[1]!.id);
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const codex = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const prompt = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) => c.turn.input[0].text as string)
    .find((text) => text.startsWith("My request: Go on"))!;
  expect(prompt).toContain("Keep the old API.");
}, 20000);
it("generates a title for Claude conversations, which have no thread-name event", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
    { timeout: 8000 },
  );
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.filter((r) => r.provider === "claude")).toHaveLength(2);
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
    expect((await chats.get(chat.id)).claudeThrough).toBe(messages[3]!.id);
  },
  15000,
);
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
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
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
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const prompts = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.provider === "claude" && !r.args.includes("--print"))
    .map((r) => JSON.parse(r.prompt).message.content[0].text as string);
  expect(prompts[0]).toBe("/security-review");
  expect(prompts[1]).toContain("This discussion concerns PR #7 in Web/portal");
}, 15000);
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  expect(saved.replySessions?.[main.id]?.through).toBe(second.id);
  const requests = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
}, 30000);

it("discovers an enabled skill and sends its native input to Codex without trusting a renderer path", async () => {
  const { codexSkills } = await import("../../electron/provider-commands");
  const skills = await codexSkills(join(root, "repo"));
  expect(skills.map((s) => s.name)).toEqual(["explain"]);
  const discovery = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
        "cache guard",
      ),
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
  const prompt = (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.provider === "claude" && !c.args.includes("--print"))
    .map((c) => JSON.parse(c.prompt).message.content[0].text as string)
    .find((text) => text.startsWith("My request: Carry on"))!;
  expect(prompt).toContain("Focus only on the cache key");
}, 30000);

it("drains queued follow-ups in order and retains a paused queue across restart", async () => {
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

it("holds a Send later message until its time, sends it now on request, and keeps it across restart", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const soon = input("Check the deploy.");
  await chats.send(chat.id, { ...soon, sendAt: Date.now() + 400 });
  let saved = await chats.get(chat.id);
  expect(saved.messages).toHaveLength(0);
  expect(saved.scheduled?.[0]).toMatchObject({ input: { id: soon.id } });
  expect(saved.scheduled?.[0].input.sendAt).toBeUndefined();
  expect(chats.list(projectId)[0].nextSend).toBe(saved.scheduled?.[0].at);
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
  await chats.send(chat.id, { ...dropped, sendAt: Date.now() + 3_600_000 });
  await chats.queueAction(chat.id, "steer", now.id);
  await chats.queueAction(chat.id, "remove", dropped.id);
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
it("stops during provider initialization without waiting for the RPC timeout", async () => {
  vi.stubEnv("RELAY_AGENT_HOLD_INITIALIZE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Start"));
  await vi.waitFor(async () =>
    expect(await readFile(join(root, "capture.jsonl"), "utf8")).toContain(
      '"initializing"',
    ),
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
  expect(await readFile(join(root, "capture.jsonl"), "utf8")).not.toContain(
    '"steer"',
  );
  await expect(chats.setScope(chat.id, { kind: "project" })).rejects.toThrow(
    "queued messages",
  );
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
    expect(await readFile(join(root, "capture.jsonl"), "utf8")).not.toContain(
      '"response"',
    );
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
    const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
    const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
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
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
    const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
  await chats.send(chat.id, input("@codex Explain cache guard"));
  await vi.waitFor(
    async () =>
      expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe(
        "complete",
      ),
    { timeout: 6000 },
  );
  await chats.send(chat.id, {
    ...input("@claude Explain the cache guard"),
    provider: "claude",
  });
  await vi.waitFor(async () =>
    expect(chats.hasActiveProject(projectId)).toBe(false),
  );
  await chats.dispose();
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
  const saved = await chats.get(chat.id);
  expect(saved.providerThread).toBe("fixture-thread");
  expect(saved.claudeThread).toBe("fixture-claude");
  await chats.send(chat.id, {
    ...input("@claude Continue with the next step"),
    provider: "claude",
  });
  await vi.waitFor(async () =>
    expect(chats.hasActiveProject(projectId)).toBe(false),
  );
  const calls = (await readFile(join(root, "capture.jsonl"), "utf8"))
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
