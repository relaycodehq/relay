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

it("cancels an undelivered steer at turn completion so Relay can keep it queued", async () => {
  setScenario({ turn: [{ waitNative: true }, say("Original answer.")] });
  native.controls.deliver = false;
  const controls = vi.fn(),
    onSteered = vi.fn();
  const running = openCodeRuntime.run(opts({ onControl: controls, onSteered }));
  await vi.waitFor(() => expect(native.active.size).toBe(1));
  const steering = controls.mock.calls[0][0].steer("Too late", "late");
  const rejected = expect(steering).rejects.toThrow("queued message");
  await vi.waitFor(() => expect(native.inbox.size).toBe(1));
  // Let the ACP fixture finish without delivering this late admission.
  await fetch(native.url + "/fixture/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID: [...native.active][0] }),
  });
  await running;
  await rejected;
  expect(onSteered).not.toHaveBeenCalled();
  expect(native.inbox.size).toBe(0);
  expect(native.calls.filter((c) => c.path.endsWith("/prompt"))).toHaveLength(
    1,
  );
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
