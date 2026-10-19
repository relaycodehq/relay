import { it, expect, vi } from "vitest";
import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { triageState } from "../../shared/chat-activity";
import { applyChatPatch, type ChatSummary } from "../../shared/projects";
import { ChatSummaryFeed } from "./chat-summaries";
import * as titleHelpers from "../agents/thread-titles";
import {
  root,
  store,
  chats,
  projectId,
  events,
  recordEvent,
  waitForChatEvent,
  waitForSummary,
  agentCalls,
  input,
  restart,
  useProjectChats,
  tinyPng,
} from "../../tests/fixtures/project-chats-harness";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

useProjectChats();

it("answers async Codex questions inside the running turn without interrupting or queueing", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture async question live"));
  await waitForChatEvent(
    chat.id,
    ({ message }) =>
      message.questions?.length === 1 &&
      !!message.trace?.some((entry) => entry.id === "after-question"),
  );
  const current = await chats.get(chat.id);
  const message = current.messages[1];
  expect(message.status).toBe("streaming");
  expect(message.trace?.some((e) => e.id === "after-question")).toBe(true);
  expect(current.requests).toEqual([]);
  // Needs the user, but the agent can keep working without this answer.
  const waiting = () =>
    chats.list(projectId).find((c) => c.id === chat.id)?.waiting;
  // Listed from the saved summary, which a running answer writes each second.
  await waitForSummary(chat.id, (summary) => summary.waiting === true);
  expect(
    chats.list(projectId).find((c) => c.id === chat.id)?.blocked,
  ).toBeUndefined();
  const answers = { "0": ["Private while preparing"], "1": ["fixture-owner"] };
  const beforeAnswer = events.length;
  await chats.answerQuestion(chat.id, message.id, "fixture-async-question", {
    kind: "question",
    answers,
  });
  await waitForChatEvent(
    chat.id,
    ({ message }) => message.status === "complete",
    beforeAnswer,
  );
  await waitForSummary(
    chat.id,
    (summary) => !summary.waiting && !summary.running,
  );
  const answered = await chats.get(chat.id);
  expect(answered.messages.at(-1)?.status).toBe("complete");
  expect(
    answered.messages.find((m) => m.id === message.id)?.questions?.[0].answers,
  ).toEqual(answers);
  expect(waiting()).toBeFalsy();
  expect(
    answered.messages.some(
      (m) => m.role === "user" && m.steered && m.body.includes("fixture-owner"),
    ),
  ).toBe(true);
  expect(answered.queue ?? []).toEqual([]);
  const calls = (await agentCalls())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(calls.filter((call) => call.turn)).toHaveLength(1);
  expect(calls.some((call) => call.interrupt)).toBe(false);
  expect(calls.find((call) => call.steer).steer).toMatchObject({
    threadId: "fixture-thread",
    expectedTurnId: "fixture-turn",
    input: [
      {
        type: "text",
        text: expect.stringContaining("Private while preparing"),
      },
    ],
  });
  expect(
    calls.find((call) => call.thread).thread.config.features
      .send_message_to_user_async,
  ).toBe(true);
  await expect(
    chats.answerQuestion(chat.id, message.id, "fixture-async-question", {
      kind: "question",
      answers,
    }),
  ).rejects.toThrow("already been answered");
});

it("keeps unanswered async questions across a restart and answers them as a follow-up", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex fixture async question finished"));
  await waitForChatEvent(
    chat.id,
    ({ message }) => message.status === "complete",
  );
  await waitForSummary(chat.id, (summary) => !summary.running);
  const message = (await chats.get(chat.id)).messages[1];
  expect(message.questions?.[0].questions).toEqual([
    {
      id: "0",
      question: "Which visibility should I use?",
      options: [{ label: "Private while preparing" }, { label: "Public now" }],
    },
    { id: "1", question: "Which account should own it?" },
  ]);
  await chats.dispose();
  restart(recordEvent);
  expect((await chats.get(chat.id)).messages[1].questions).toEqual(
    message.questions,
  );
  // The turn is over and Relay restarted: the list still says it waits.
  const waiting = () =>
    chats.list(projectId).find((c) => c.id === chat.id)?.waiting;
  expect(waiting()).toBe(true);
  const dismiss = (dismissed: boolean) =>
    chats.setQuestionDismissed(
      chat.id,
      message.id,
      "fixture-async-question",
      dismissed,
    );
  await dismiss(true);
  expect(waiting()).toBeFalsy();
  await dismiss(false);
  expect(waiting()).toBe(true);
  const beforeAnswer = events.length;
  await chats.answerQuestion(chat.id, message.id, "fixture-async-question", {
    kind: "question",
    answers: { "0": ["An unlisted choice"], "1": ["fixture-owner"] },
  });
  await waitForChatEvent(
    chat.id,
    ({ message }) => message.status === "complete",
    beforeAnswer,
  );
  await waitForSummary(
    chat.id,
    (summary) => !summary.waiting && !summary.running,
  );
  expect(waiting()).toBeFalsy();
  expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
  const saved = await chats.get(chat.id);
  const group = saved.messages.find((m) => m.id === message.id)!.questions![0];
  expect(
    saved.messages.find((m) => m.id === group.answerMessageId),
  ).toMatchObject({
    role: "user",
    asyncQuestionAnswer: true,
    questionMessageId: message.id,
    body: expect.stringContaining("An unlisted choice"),
  });
  const calls = (await agentCalls())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const turns = calls.filter((call) => call.turn);
  expect(turns).toHaveLength(2);
  expect(turns[1].turn.input[0].text).toContain("An unlisted choice");
  expect(calls.some((call) => call.interrupt || call.steer)).toBe(false);
});
it("resumes after a question reply without carrying its hidden-response markers into the resume", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, {
    ...input("@codex wait for cancellation"),
    asyncQuestionAnswer: true,
    questionMessageId: "original-question",
    pageAnswer: { title: "Pick a sound" },
  });
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.body).toContain(
      "cache guard",
    ),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  await chats.resume(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const resumed = (await chats.get(chat.id)).messages.find((m) => m.resumed)!;
  expect(resumed).toBeDefined();
  expect(resumed.asyncQuestionAnswer).toBeUndefined();
  expect(resumed.questionMessageId).toBeUndefined();
  expect(resumed.pageAnswer).toBeUndefined();
});

it("sends only messages the renderer doesn't hold at their current version", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  expect((await chats.get(chat.id)).messages.at(-1)?.body).toBe(
    "The cache guard prevents duplicate requests.",
  );
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
  expect(events.some((e) => e.title === "Cache guard behavior")).toBe(true);
  await chats.dispose();
  restart(recordEvent);
  await chats.send(chat.id, input("@codex And why is that useful?"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
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
});
it("names a thread from its first message while the answer is still running", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  vi.stubEnv("RELAY_AGENT_TURN_MS", "4000");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
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
  restart(() => {});
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
});
it("retries a missing title once, not every time the thread is read", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const generate = vi.spyOn(titleHelpers, "generateThreadTitle");
  const chat = await chats.create(projectId, { kind: "project" });
  // The generated title is the prompt excerpt already.
  await chats.send(chat.id, input("@codex Cache guard behavior"));
  const titleRuns = async () =>
    (await agentCalls({ helpers: true }))
      .split("\n")
      .filter((line) => line.includes("Generate a short title")).length;
  await waitForChatEvent(
    chat.id,
    ({ message }) => message.status === "complete",
  );
  await waitForSummary(chat.id, (summary) => !summary.running);
  expect(generate).toHaveBeenCalledTimes(1);
  // A helper can return the existing excerpt; wait for that actual result before rereading.
  await generate.mock.results[0].value;
  for (let read = 0; read < 3; read++) {
    await chats.get(chat.id);
    chats.ensureTitle(chat.id);
  }
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await titleRuns()).toBe(1);
  expect((await chats.get(chat.id)).title).toBe("Cache guard behavior");
});
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
    await vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  }
  await chats.dispose();
  restart(() => {});
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
});
it("waits for the first answer to name a thread of only screenshots", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex [Image #1]"));
  expect((await chats.get(chat.id)).title).toBe("[Image #1]");
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).title).toBe("Cache guard behavior"),
  );
  const titling = (await agentCalls({ helpers: true }))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.turn?.input[0].text.startsWith("Generate a short title"));
  expect(titling.turn.input[0].text).toContain('"answer"');
});
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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
  const requests = (await agentCalls())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests.filter((r) => r.turn)).toHaveLength(1);
  await chats.dispose();
  restart(() => {});
  expect(chats.list(projectId)[0].title).toBe("Cache work");
});
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
  const another = input("@codex Another");
  await chats.send(chat.id, another);
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
  await vi.waitFor(() => expect(chats.hasActiveProject(projectId)).toBe(false));
  // Retrying the accepted first send mustn't unpause and drain the waiting follow-up.
  const accepted = (await chats.get(chat.id)).messages.find(
    (m) => m.role === "user" && m.body.startsWith("@codex"),
  )!;
  await chats.send(chat.id, {
    ...another,
    id: accepted.id,
    body: accepted.body,
  });
  expect((await chats.get(chat.id)).queuePaused).toBe(true);
  // A phone that never heard back sends it again: it still waits in the queue, once.
  await chats.send(chat.id, another);
  expect(chats.hasActiveProject(projectId)).toBe(false);
  expect((await chats.get(chat.id)).queue).toHaveLength(1);
  // Asking again by hand lets the paused queue follow that answer.
  await chats.send(chat.id, input("@codex Asked by hand"));
  await vi.waitFor(async () => {
    const saved = await chats.get(chat.id);
    expect(saved.queue ?? []).toHaveLength(0);
    expect(
      saved.messages.filter((m) => m.role === "user").map((m) => m.body),
    ).toEqual(
      expect.arrayContaining(["@codex Asked by hand", "@codex Another"]),
    );
  });
  expect(
    (await chats.get(chat.id)).messages.filter((m) => m.id === another.id),
  ).toHaveLength(1);
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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
      role: "assistant",
      provider: "codex",
      status: "complete",
    }),
  );
  expect(chats.list(projectId).find((c) => c.id === chat.id)).toMatchObject({
    provider: "codex",
    contextAgent: "codex",
  });
});
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
  restart(() => {});
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
it("keeps the images an answer shows as they were, also in a fork", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  const shot = join(root, "shot.png");
  await writeFile(shot, Buffer.from(tinyPng, "base64"));
  await chats.send(
    chat.id,
    input(`@codex fixture echo: Here ![the page](${shot})`),
  );
  const answer = await vi.waitFor(async () => {
    const last = (await chats.get(chat.id)).messages.at(-1)!;
    expect(last).toMatchObject({ role: "assistant", status: "complete" });
    expect(chats.hasActiveProject(projectId)).toBe(false);
    return last;
  });
  const shown = `data:image/png;base64,${tinyPng}`;
  // The agent's next screenshot lands on the same path.
  await writeFile(shot, "drawn over");
  expect(await chats.readImage(chat.id, answer.id, shot)).toBe(shown);
  await rm(shot);
  expect(await chats.readImage(chat.id, answer.id, shot)).toBe(shown);
  const fork = await chats.get((await chats.fork(chat.id)).id);
  const copied = fork.messages.find((m) => m.body === answer.body)!;
  expect(await chats.readImage(fork.id, copied.id, shot)).toBe(shown);
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
  restart((event) => events.push(event));
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
  restart((e) => events.push(e), evidence);
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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
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

it("lists and rolls back only the files a turn's agent changed", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(
    chat.id,
    input("@codex fixture edit files and a stray file"),
  );
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete");
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
  const answer = (await chats.get(chat.id)).messages.at(-1)!;
  expect(answer.changes?.map((f) => f.path)).toEqual([
    "README.md",
    "src/guard.ts",
  ]);
  const repo = join(root, "repo");
  await chats.rewindTurn(chat.id, answer.id, null, "revert", false);
  await expect(readFile(join(repo, "src", "guard.ts"))).rejects.toThrow();
  expect(await readFile(join(repo, "stray.md"), "utf8")).toBe("Stray.\n");
});
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
    await vi.waitFor(async () => {
      const saved = await chats.get(chat.id);
      expect(saved.messages.at(-1)?.status).toBe("complete");
      expect(saved.messages.at(-2)?.id).toBe(sent.id);
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
    const { branch, commit } = await chats.get(chat.id);
    return { branch, commit };
  };
  expect(await turn("@codex fixture switch branch to main")).toEqual({
    branch: "main",
  });
  // A detached checkout is on no branch; the old name would be a lie.
  const head = git("rev-parse", "--short", "HEAD").toString().trim();
  expect(await turn("@codex fixture switch branch to detached")).toEqual({
    commit: head,
  });
  expect(await turn("@codex fixture switch branch to main")).toEqual({
    branch: "main",
  });
});
it("stops during provider initialization without waiting for the RPC timeout", async () => {
  vi.stubEnv("RELAY_AGENT_HOLD_INITIALIZE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await chats.send(chat.id, input("@codex Start"));
  await vi.waitFor(async () =>
    expect(await agentCalls()).toContain('"initializing"'),
  );
  await chats.cancel(chat.id);
  await vi.waitFor(async () => {
    expect((await chats.get(chat.id)).messages.at(-1)).toMatchObject({
      status: "cancelled",
      body: "",
    });
    expect(chats.hasActiveProject(projectId)).toBe(false);
  });
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
  await vi.waitFor(() => expect(latest()?.running).toBeUndefined());
  const until = Date.now() + 60_000;
  await chats.triage(chat.id, { kind: "snooze", until });
  await vi.waitFor(() => expect(latest()?.snoozedUntil).toBe(until));
  // What went out last is what the sidebar would have fetched.
  feed.flush();
  expect(pushed.at(-1)).toEqual(chats.list(projectId));
  // Nothing goes out twice in a row.
  const sent = pushed.map((list) => JSON.stringify(list));
  expect(sent.filter((s, i) => s === sent[i - 1])).toEqual([]);
});

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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
  );
});

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
    await vi.waitFor(async () => {
      const messages = (await chats.get(chat.id)).messages;
      expect(messages).toHaveLength(count);
      expect(messages.at(-1)?.status).toBe("complete");
      expect(chats.hasActiveProject(projectId)).toBe(false);
    });
  }
  const source = (await chats.get(chat.id)).messages;
  const fork = await chats.fork(chat.id);
  expect(fork.provider).toBe("claude");
  const forked = await chats.get(fork.id);
  // The handoff note Codex left on the way out came along, but isn't the fork point.
  expect(forked.messages.map((m) => m.body)).toEqual(source.map((m) => m.body));
  expect(forked.forkedAt).toBe(forked.messages.at(-1)!.id);
});

it("regenerates a title from the whole thread, even over a name you typed", async () => {
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  const chat = await chats.create(projectId, { kind: "project" });
  await expect(chats.regenerateTitle(chat.id)).rejects.toThrow("first answer");
  await chats.send(chat.id, input("@codex Explain the cache guard"));
  await vi.waitFor(async () => {
    const saved = await chats.get(chat.id);
    expect(saved.title).toBe("Cache guard behavior");
    expect(saved.messages.at(-1)?.status).toBe("complete");
  });
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
});

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
it("keeps a pinned thread out of auto-settle and keeps when it was first pinned", async () => {
  const chat = await chats.create(projectId, { kind: "project" });
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(chat.updated + 3 * 86_400_000);
    const pinned = await chats.triage(chat.id, { kind: "pin", pinned: true });
    expect(chats.list(projectId)[0].autoSettled).toBeUndefined();
    vi.setSystemTime(chat.updated + 4 * 86_400_000);
    await chats.triage(chat.id, { kind: "pin", pinned: true });
    expect(chats.list(projectId)[0].pinnedAt).toBe(pinned.pinnedAt);
    await chats.triage(chat.id, { kind: "pin", pinned: false });
    expect(chats.list(projectId)[0]).toMatchObject({ autoSettled: true });
    expect(chats.list(projectId)[0].pinnedAt).toBeUndefined();
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
  restart(() => {});
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
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages.at(-1)?.status).toBe("complete"),
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
});
