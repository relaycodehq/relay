import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { openCodeNativeFixture } from "../../../tests/fixtures/opencode-native";
import { setLinkedAgents } from "../../platform/executables";
import type { AgentOptions } from "../types";
import { openCodeRuntime } from "./index";

let root: string;
let native: Awaited<ReturnType<typeof openCodeNativeFixture>>;
let scenario: Record<string, unknown>;
let log: string;
const say = (text: string) => ({
  update: {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  },
});
const opts = (extra: Partial<AgentOptions> = {}): AgentOptions => ({
  job: { kind: "prompt" },
  cwd: root,
  prompt: "Write notes",
  request: "Write notes",
  signal: new AbortController().signal,
  choice: { model: "", reasoningEffort: "", fast: false },
  session: { key: "thread", onId: async () => {} },
  onText() {},
  ...extra,
});
const setScenario = (extra: Record<string, unknown>) => {
  scenario = {
    nativeUrl: native.url,
    serviceUrl: native.url,
    resume: true,
    turn: [say("Done.")],
    ...extra,
  };
  vi.stubEnv("RELAY_ACP_SCENARIO", JSON.stringify(scenario));
};
beforeEach(async () => {
  root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-opencode-native-")),
  );
  log = join(root, "sent.jsonl");
  native = await openCodeNativeFixture();
  setLinkedAgents({
    opencode: await fakeCli(
      join(root, "opencode"),
      await readFile(resolve("tests/fixtures/acp-agent.cjs"), "utf8"),
      "opencode v2.0.32",
    ),
  });
  vi.stubEnv("RELAY_ACP_LOG", log);
  setScenario({});
});
afterEach(async () => {
  await openCodeRuntime.dispose?.();
  await native.close();
  setLinkedAgents({});
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("streams through ACP, reports per-request native cost and saves a fork point without double counting", async () => {
  const onUsage = vi.fn(),
    onCost = vi.fn(),
    onPoint = vi.fn(),
    onId = vi.fn();
  expect(
    await openCodeRuntime.run(
      opts({ onUsage, onCost, session: { key: "thread", onId, onPoint } }),
    ),
  ).toBe("Done.");
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "opencode/big-pickle",
      usd: 0.03,
      tokens: { input: 10, output: 5, cacheRead: 4, cacheWrite: 1 },
    }),
  );
  expect(onCost).toHaveBeenCalledExactlyOnceWith(0.03);
  expect(onPoint).toHaveBeenCalledWith(expect.stringMatching(/^msg_answer_/));
  const id = onId.mock.calls[0][0];
  await openCodeRuntime.run(
    opts({ onUsage, onCost, session: { id, key: "thread", onId } }),
  );
  expect(onUsage).toHaveBeenCalledTimes(2);
  expect(onCost.mock.calls).toEqual([[0.03], [0.03]]);
});

it("delivers a steer with images at a step boundary, acknowledges its chat id, and never cancels ACP", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Changed course.")] });
  const onSteered = vi.fn();
  const controls = vi.fn();
  const image = join(root, "image.png");
  await writeFile(image, "sample-png");
  const running = openCodeRuntime.run(opts({ onControl: controls, onSteered }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  await controls.mock.calls[0][0].steer("Use the small version", "chat-steer", [
    { path: image, mimeType: "image/png" },
  ]);
  expect(await running).toBe("Changed course.");
  expect(onSteered).toHaveBeenCalledExactlyOnceWith("chat-steer");
  const sent = native.calls.find((c) => c.path.endsWith("/prompt"))!;
  expect(sent.body).toMatchObject({
    text: "Use the small version",
    delivery: "steer",
    resume: false,
    files: [{ uri: "data:image/png;base64,c2FtcGxlLXBuZw==" }],
  });
  expect(await readFile(log, "utf8")).not.toContain(
    '"method":"session/cancel"',
  );
});

it("recovers a delivered steer after its HTTP reply is lost, without submitting twice", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Steer received.")] });
  native.controls.lostPromptReply = true;
  const controls = vi.fn(),
    onSteered = vi.fn();
  const running = openCodeRuntime.run(opts({ onControl: controls, onSteered }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  await controls.mock.calls[0][0].steer("Correction", "steer");
  await running;
  expect(native.calls.filter((c) => c.path.endsWith("/prompt"))).toHaveLength(
    1,
  );
  expect(onSteered).toHaveBeenCalledTimes(1);
});

it("answers /btw without adding to the main transcript and runs stateless helpers", async () => {
  await openCodeRuntime.run(opts());
  const session = [...native.sessions.keys()][0];
  const before = structuredClone(native.messages.get(session));
  expect(
    await openCodeRuntime.askSide!({
      key: "thread",
      thread: session,
      cwd: root,
      choice: opts().choice,
      question: "Why?",
      history: [],
      signal: opts().signal,
    }),
  ).toBe("An answer beside the thread");
  expect(native.messages.get(session)).toEqual(before);
  expect(
    await openCodeRuntime.run(
      opts({
        job: { kind: "helper", instructions: "Write a commit title" },
        prompt: "Some changes",
      }),
    ),
  ).toBe("A helpful commit message");
  expect(
    native.calls.some((c) => c.path === "/api/experimental/generate"),
  ).toBe(true);
});

it("branches through the selected answer, preserves the original and resumes the native fork over ACP", async () => {
  const onId = vi.fn();
  await openCodeRuntime.run(opts({ session: { key: "thread", onId } }));
  const original = onId.mock.calls[0][0];
  const at = native.messages.get(original)!.at(-1).id;
  native.messages.get(original)!.push({
    id: "msg_later",
    type: "user",
    text: "Later prompt",
    time: { created: Date.now() },
  });
  const onForkId = vi.fn();
  await openCodeRuntime.run(
    opts({
      session: { key: "fork", fork: { thread: original, at }, onId: onForkId },
    }),
  );
  const sent = native.calls.find((c) => c.path.endsWith("/fork"))!;
  expect(sent.body).toEqual({ before: "msg_later" });
  expect(onForkId).toHaveBeenCalledTimes(1);
  expect(native.messages.get(original)!.at(-1).id).toBe("msg_later");
  expect(await readFile(log, "utf8")).toContain('"method":"session/resume"');
});

it("shows native question forms, maps option labels to values and leaves approvals on ACP", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Using SQLite.")] });
  const ask = vi.fn(async () => ({
    kind: "question" as const,
    answers: { database: ["SQLite"] },
  }));
  const running = openCodeRuntime.run(opts({ onRequest: ask }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const sessionID = [...native.active][0];
  const form = {
    id: "frm_db",
    sessionID,
    title: "Choose a database",
    fields: [
      {
        key: "database",
        type: "string",
        title: "Database",
        options: [
          { value: "sqlite", label: "SQLite" },
          { value: "postgres", label: "PostgreSQL" },
        ],
      },
    ],
    state: { status: "pending" },
  };
  native.forms.set(form.id, form);
  native.emit("form.created", { form }, false);
  expect(await running).toBe("Using SQLite.");
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Choose a database",
      questions: [
        expect.objectContaining({
          id: "database",
          options: [{ label: "SQLite" }, { label: "PostgreSQL" }],
        }),
      ],
    }),
    expect.anything(),
  );
  expect(native.calls.find((c) => c.path.endsWith("/reply"))!.body).toEqual({
    answer: { database: "sqlite" },
  });
});

it("cancels a form the service rejects with its constraints and keeps the turn going", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Asked again.")] });
  native.controls.rejectReply = true;
  const ask = vi.fn(async () => ({
    kind: "question" as const,
    answers: { size: ["2"] },
  }));
  const running = openCodeRuntime.run(opts({ onRequest: ask }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const sessionID = [...native.active][0];
  const form = {
    id: "frm_size",
    sessionID,
    title: "Pick a size",
    fields: [{ key: "size", type: "number", minimum: 5 }],
    state: { status: "pending" },
  };
  native.forms.set(form.id, form);
  native.emit("form.created", { form }, false);
  await vi.waitFor(() =>
    expect(native.forms.get("frm_size")!.state.status).toBe("cancelled"),
  );
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID }),
  });
  expect(await running).toBe("Asked again.");
  expect(
    native.calls.find(
      (c) => c.method === "DELETE" && c.path.endsWith("/form/frm_size"),
    )?.query,
  ).toMatchObject({ message: expect.stringContaining("constraints") });
});

it("changes the running session's effort for the next provider request", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Done.")] });
  const controls = vi.fn();
  const running = openCodeRuntime.run(opts({ onControl: controls }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  expect(
    await controls.mock.calls[0][0].retune({
      model: "opencode/big-pickle",
      reasoningEffort: "high",
      fast: false,
    }),
  ).toBe(true);
  expect(
    native.calls.find((c) => c.method === "POST" && c.path.endsWith("/model"))!
      .body,
  ).toEqual({
    model: { providerID: "opencode", id: "big-pickle", variant: "high" },
  });
  await controls.mock.calls[0][0].steer("Continue");
  await running;
});

it("reloads configuration with an explicit shared scope and refuses while any OpenCode session runs", async () => {
  native.active.add("ses_external");
  await expect(openCodeRuntime.reloadSession!("thread")).rejects.toThrow(
    "every project",
  );
  expect(native.calls.some((c) => c.path.endsWith("/reload"))).toBe(false);
  native.active.clear();
  expect(await openCodeRuntime.reloadSession!("thread")).toEqual({
    scope: "service",
  });
});

it("lets the thread go once a steer is admitted, then gives back one the turn never read", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Original answer.")] });
  native.controls.deliver = false;
  const controls = vi.fn(),
    onSteered = vi.fn(),
    onSteerUnread = vi.fn();
  const running = openCodeRuntime.run(
    opts({ onControl: controls, onSteered, onSteerUnread }),
  );
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  // Admitted while the turn still runs: steering doesn't wait for delivery.
  await controls.mock.calls[0][0].steer("Too late", "late");
  expect(native.inbox.size).toBe(1);
  expect(native.active.size).toBe(1);
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID: [...native.active][0] }),
  });
  expect(await running).toBe("Original answer.");
  expect(onSteered).not.toHaveBeenCalled();
  expect(onSteerUnread).toHaveBeenCalledExactlyOnceWith("late", undefined);
  expect(native.inbox.size).toBe(0);
  expect(native.calls.filter((c) => c.path.endsWith("/prompt"))).toHaveLength(
    1,
  );
});

it("reports an admitted steer whose cancellation fails as uncertain, keeping the answer", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Original answer.")] });
  native.controls.deliver = false;
  const controls = vi.fn(),
    onSteerUnread = vi.fn();
  const running = openCodeRuntime.run(
    opts({ onControl: controls, onSteerUnread }),
  );
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  await controls.mock.calls[0][0].steer("Correction", "unsure");
  native.controls.failCancel = true;
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID: [...native.active][0] }),
  });
  expect(await running).toBe("Original answer.");
  expect(onSteerUnread).toHaveBeenCalledExactlyOnceWith(
    "unsure",
    expect.objectContaining({ name: "UncertainSteerError" }),
  );
});

it("answers a steer below it without repeating what was said before it", async () => {
  setScenario({
    turn: [say("Before."), { waitNative: true }, say("After.")],
  });
  const controls = vi.fn(),
    onText = vi.fn(),
    onSteered = vi.fn();
  const running = openCodeRuntime.run(
    opts({ onControl: controls, onText, onSteered }),
  );
  await vi.waitFor(() => expect(onText).toHaveBeenCalledWith("Before."));
  await controls.mock.calls[0][0].steer("Shorter, please", "steer");
  expect(await running).toBe("After.");
  expect(onSteered).toHaveBeenCalledExactlyOnceWith("steer");
  expect(onText.mock.calls.at(-1)).toEqual(["After."]);
  expect(onText.mock.calls.flat().join("|")).not.toContain("Before.After.");
});

it.each([false, true])(
  "keeps ambiguous steering failures distinct from a safe queued fallback when recovery fails: %s",
  async (failRead) => {
    setScenario({ turn: [{ waitNative: true }, say("Original answer.")] });
    native.controls.deliver = false;
    native.controls.lostPromptReply = true;
    native.controls.failCancel = true;
    const controls = vi.fn();
    const abort = new AbortController();
    const running = openCodeRuntime.run(
      opts({ onControl: controls, signal: abort.signal }),
    );
    void running.catch(() => {});
    await vi.waitFor(() => expect(native.active.size).toBe(1));
    native.controls.failRead = failRead;
    await expect(
      controls.mock.calls[0][0].steer("Correction", "uncertain"),
    ).rejects.toMatchObject({ name: "UncertainSteerError" });
    abort.abort();
    await expect(running).rejects.toThrow();
    expect(native.calls.filter((c) => c.path.endsWith("/prompt"))).toHaveLength(
      1,
    );
  },
);

it("tracks nested subagents, their file edits and cost, and stops only the selected worker", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Done.")] });
  const controls = vi.fn(),
    onUsage = vi.fn(),
    onEdit = vi.fn(),
    onActivity = vi.fn();
  const running = openCodeRuntime.run(
    opts({ onControl: controls, onUsage, onEdit, onActivity }),
  );
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const parentID = [...native.active][0];
  native.create("ses_child", {
    parentID,
    title: "Check cache",
    agent: "explore",
  });
  native.active.add("ses_child");
  native.emit("session.execution.started", { sessionID: "ses_child" });
  native.create("ses_nested", {
    parentID: "ses_child",
    title: "Inspect tests",
  });
  native.active.add("ses_nested");
  native.emit("session.execution.started", { sessionID: "ses_nested" });
  native.emit("session.tool.input.started", {
    sessionID: "ses_child",
    id: "edit1",
    name: "edit",
    assistantMessageID: "msg_child",
  });
  native.emit("session.tool.called", {
    sessionID: "ses_child",
    id: "edit1",
    input: { filePath: "cache.ts" },
    assistantMessageID: "msg_child",
    executed: true,
  });
  native.emit("session.tool.success", {
    sessionID: "ses_child",
    id: "edit1",
    content: [{ type: "text", text: "Fixed cache" }],
    assistantMessageID: "msg_child",
    executed: true,
  });
  await vi.waitFor(() =>
    expect(openCodeRuntime.subagents!("thread")!.list()).toHaveLength(2),
  );
  expect(
    openCodeRuntime.subagents!("thread")!
      .list()
      .find((r) => r.id === "ses_nested")!.parentId,
  ).toBe("ses_child");
  await vi.waitFor(() =>
    expect(onEdit).toHaveBeenCalledWith(["/fixture/cache.ts"]),
  );
  await openCodeRuntime.subagents!("thread")!.stop("ses_nested");
  expect(native.active.has(parentID)).toBe(true);
  expect(native.active.has("ses_child")).toBe(true);
  native.finish("ses_child", "The cache is fixed.");
  await vi.waitFor(() =>
    expect(
      openCodeRuntime.subagents!("thread")!.detail("ses_child")!.report,
    ).toBe("The cache is fixed."),
  );
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({ subagent: true, model: "opencode/big-pickle" }),
  );
  expect(onActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "edit1",
      parentId: "ses_child",
      kind: "file",
    }),
  );
  await controls.mock.calls[0][0].steer("Finish");
  await running;
});

it("performs watch checks from session context after meaningful work", async () => {
  const nativeSteps = Array.from({ length: 3 }, (_, i) => ({
    native: {
      type: "session.tool.input.started",
      data: { id: `tool${i}`, name: "read", assistantMessageID: "msg_a" },
    },
  }));
  setScenario({ turn: [...nativeSteps, say("Done.")] });
  native.controls.watchReply =
    "learn: The database schema still needs migrating before deployment.\ntag: Heads up\ntitle: Run the database migration\n- The code expects the new schema.\n- Deployment needs a migration step.\nsaid: never";
  const onNote = vi.fn();
  await openCodeRuntime.run(
    opts({ watch: { scope: "main", known: [], onNote } }),
  );
  expect(onNote).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ title: "Run the database migration" }),
  );
  expect(native.calls.filter((c) => c.path.endsWith("/generate"))).toHaveLength(
    1,
  );
});

it("recovers events missed during a socket disconnect without charging the same request twice", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Done.")] });
  const controls = vi.fn(),
    onUsage = vi.fn();
  const running = openCodeRuntime.run(opts({ onControl: controls, onUsage }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const parentID = [...native.active][0];
  native.disconnect();
  native.messages.get(parentID)!.push({
    id: "msg_missed",
    type: "assistant",
    model: { providerID: "openai", id: "fixture" },
    agent: "build",
    content: [],
    time: { created: Date.now(), completed: Date.now() },
    tokens: {
      input: 5,
      output: 1,
      reasoning: 1,
      cache: { read: 0, write: 0 },
    },
    cost: 0.01,
  });
  native.emit("session.step.started", {
    sessionID: parentID,
    assistantMessageID: "msg_missed",
    agent: "build",
    model: { providerID: "openai", id: "fixture" },
    started: Date.now(),
  });
  native.emit("session.step.ended", {
    sessionID: parentID,
    assistantMessageID: "msg_missed",
    finish: "tool-calls",
    tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 0, write: 0 } },
    cost: 0.01,
  });
  await vi.waitFor(() =>
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/fixture" }),
    ),
  );
  await controls.mock.calls[0][0].steer("Finish");
  await running;
  expect(
    onUsage.mock.calls.filter(([r]) => r.model === "openai/fixture"),
  ).toHaveLength(1);
});

it("reconnects after every outage of a long-lived session, not just the first three", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Done.")] });
  const running = openCodeRuntime.run(opts());
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const sessionID = [...native.active][0];
  const subscribed = () =>
    native.calls.filter((c) => c.path === "/api/event").length;
  for (let outage = 1; outage <= 4; outage++) {
    const before = subscribed();
    native.disconnect();
    await vi.waitFor(() => expect(subscribed()).toBe(before + 1), {
      timeout: 3000,
    });
  }
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID }),
  });
  expect(await running).toBe("Done.");
});

it("saves the fork point at the final step even when its event was lost", async () => {
  setScenario({
    turn: [
      {
        native: {
          type: "session.step.ended",
          data: {
            assistantMessageID: "msg_early",
            finish: "tool-calls",
            tokens: {
              input: 1,
              output: 1,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            cost: 0,
          },
        },
      },
      { waitNative: true },
      say("Done."),
    ],
  });
  const onPoint = vi.fn();
  const running = openCodeRuntime.run(
    opts({ session: { key: "thread", onId: async () => {}, onPoint } }),
  );
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const sessionID = [...native.active][0];
  await vi.waitFor(() =>
    expect(native.logs.get(sessionID)?.at(-1)?.type).toBe("session.step.ended"),
  );
  // The final step's events go into a dead socket.
  native.disconnect();
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID }),
  });
  await running;
  expect(onPoint).toHaveBeenCalledExactlyOnceWith(
    native.messages.get(sessionID)!.at(-1).id,
  );
  expect(onPoint).not.toHaveBeenCalledWith("msg_early");
});

it("looks the service up once for a turn's burst of requests", async () => {
  await openCodeRuntime.run(opts());
  const lookups = (await readFile(log, "utf8"))
    .split("\n")
    .filter((line) => line.includes('"cli":["service","status"]'));
  expect(native.calls.length).toBeGreaterThan(5);
  expect(lookups.length).toBeLessThanOrEqual(2);
});

it("refuses a reload while a turn here is still starting, before OpenCode runs it", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Done.")] });
  const running = openCodeRuntime.run(opts());
  expect(native.active.size).toBe(0);
  await expect(openCodeRuntime.reloadSession!("other")).rejects.toThrow(
    "every project",
  );
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID: [...native.active][0] }),
  });
  expect(await running).toBe("Done.");
  expect(native.calls.some((c) => c.path.endsWith("/reload"))).toBe(false);
});

it("settles subagents that never ran and finds workers of a finished one", async () => {
  const onId = vi.fn();
  await openCodeRuntime.run(opts({ session: { key: "thread", onId } }));
  const thread = onId.mock.calls[0][0];
  native.create("ses_idle_child", { parentID: thread, title: "Never ran" });
  native.create("ses_done_child", {
    parentID: thread,
    title: "Finished",
    outcome: "succeeded",
  });
  await openCodeRuntime.run(
    opts({ session: { id: thread, key: "thread", onId } }),
  );
  const book = openCodeRuntime.subagents!("thread")!;
  expect(book.detail("ses_idle_child")?.status).toBe("stopped");
  expect(book.detail("ses_done_child")?.status).toBe("completed");
  // A background worker of the finished one ends while its parent stays unchanged.
  const parent = native.sessions.get("ses_done_child");
  const updated = parent.time.updated;
  native.create("ses_grandchild", {
    parentID: "ses_done_child",
    title: "Background check",
    outcome: "succeeded",
  });
  native.messages.get("ses_grandchild")!.push({
    type: "assistant",
    id: "msg_grandchild",
    agent: "build",
    model: { providerID: "opencode", id: "big-pickle" },
    content: [{ type: "text", text: "All clear." }],
    time: { created: Date.now(), completed: Date.now() },
  });
  parent.time.updated = updated;
  await openCodeRuntime.run(
    opts({ session: { id: thread, key: "thread", onId } }),
  );
  expect(book.detail("ses_grandchild")).toMatchObject({
    status: "completed",
    report: "All clear.",
  });
});

it("keeps a helper's answer when removing its temporary session fails", async () => {
  const image = join(root, "sample.png");
  await writeFile(image, "sample-image");
  native.controls.failRemove = true;
  expect(
    await openCodeRuntime.run(
      opts({
        job: { kind: "helper", instructions: "Describe this screenshot" },
        images: [{ path: image, mimeType: "image/png" }],
      }),
    ),
  ).toBe("An image helper answer");
});

it("picks up the service's rotated credential on the next operation", async () => {
  await openCodeRuntime.run(opts());
  const thread = [...native.sessions.keys()][0];
  native.controls.password = "rotated-fixture-password";
  vi.stubEnv(
    "RELAY_ACP_SCENARIO",
    JSON.stringify({ ...scenario, servicePassword: native.controls.password }),
  );
  await expect(
    openCodeRuntime.askSide!({
      thread,
      key: "thread",
      cwd: root,
      question: "Why?",
      history: [],
      choice: opts().choice,
      signal: opts().signal,
    }),
  ).resolves.toBe("An answer beside the thread");
  expect(native.calls.at(-1)!.authorization).toBe(
    "Basic " +
      Buffer.from("opencode:rotated-fixture-password").toString("base64"),
  );
});

it("includes screenshots in helper jobs and removes only the owned tool-denied temporary session", async () => {
  const image = join(root, "sample.png");
  await writeFile(image, "sample-image");
  native.create("ses_saved", { title: "Keep this conversation" });
  const onUsage = vi.fn();
  expect(
    await openCodeRuntime.run(
      opts({
        job: { kind: "helper", instructions: "Describe this screenshot" },
        images: [{ path: image, mimeType: "image/png" }],
        onUsage,
      }),
    ),
  ).toBe("An image helper answer");
  const create = native.calls.find(
    (c) => c.method === "POST" && c.path === "/api/session",
  )!;
  expect(create.body.permissions).toEqual([
    { action: "*", resource: "*", effect: "deny" },
  ]);
  expect(
    native.calls.find((c) => c.path.endsWith("/prompt"))!.body.files,
  ).toEqual([{ uri: "data:image/png;base64,c2FtcGxlLWltYWdl" }]);
  expect([...native.sessions.keys()]).toEqual(["ses_saved"]);
  expect(onUsage).toHaveBeenCalledWith(
    expect.objectContaining({ model: "opencode/big-pickle" }),
  );
});

it("moves an owned fork to the requested worktree without moving its original session", async () => {
  const onId = vi.fn();
  await openCodeRuntime.run(opts({ session: { key: "thread", onId } }));
  const original = onId.mock.calls[0][0];
  const at = native.messages.get(original)!.at(-1).id;
  const moved = vi.fn();
  const cwd = join(root, "new-worktree");
  await mkdir(cwd);
  await openCodeRuntime.run(
    opts({
      cwd,
      session: { key: "worktree", fork: { thread: original, at }, onId: moved },
    }),
  );
  expect(native.sessions.get(original).location.directory).toBe(root);
  expect(native.sessions.get(moved.mock.calls[0][0]).location.directory).toBe(
    cwd,
  );
});
