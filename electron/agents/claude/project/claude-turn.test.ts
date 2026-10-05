import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeProject } from "./index";
import type {
  AgentRequest,
  AgentResponse,
} from "../../../../shared/agent-modes";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("../../../platform/executables", () => ({
  findExecutable: async (name: string) => `/usr/bin/${name}`,
}));

type Options = NonNullable<Parameters<typeof query>[0]["options"]>;
type Sent = { uuid: string; message: { content: unknown }; priority?: string };

const session_id = "session";
const lifecycle = (command_uuid: string, state: string) => ({
  type: "command_lifecycle",
  command_uuid,
  state,
  session_id,
});
const assistant = (id: string, content: object[]) => ({
  type: "assistant",
  parent_tool_use_id: null,
  session_id,
  message: { id, content, usage: {} },
});
const says = (id: string, text: string) =>
  assistant(id, [{ type: "text", text }]);
const toolResult = (id: string, content: string) => ({
  type: "user",
  parent_tool_use_id: null,
  session_id,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content }],
  },
});
const event = (e: object) => ({
  type: "stream_event",
  parent_tool_use_id: null,
  session_id,
  event: e,
});
const result = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  session_id,
});

/**
 * Claude Code as one scripted session: `script` reads what Relay sends and
 * yields the frames the CLI would write. The session stays open after it.
 */
function claude(
  script: (io: {
    next: () => Promise<Sent>;
    options: Options;
  }) => AsyncGenerator<object>,
) {
  let options!: Options;
  vi.mocked(query).mockImplementation((params) => {
    options = params.options!;
    const input = (params.prompt as AsyncIterable<Sent>)[
      Symbol.asyncIterator
    ]();
    const next = async () => (await input.next()).value as Sent;
    return Object.assign(
      (async function* () {
        yield* script({ next, options });
        await new Promise(() => {});
      })(),
      { close() {}, getContextUsage: async () => ({}) },
    ) as unknown as ReturnType<typeof query>;
  });
  return () => options;
}

/** Every callback a turn makes, in order. */
function recorder() {
  const log: string[] = [];
  return {
    log,
    callbacks: {
      onText: (text: string) => log.push(`text ${JSON.stringify(text)}`),
      onCommentary: (id: string, text: string | null) =>
        log.push(`commentary ${id} ${JSON.stringify(text)}`),
      onActivity: (a: { id: string; status: string; detail?: string }) =>
        log.push(
          `activity ${a.id} ${a.status}${a.detail ? ` ${a.detail}` : ""}`,
        ),
      onEdit: (paths: string[]) => log.push(`edit ${paths.join(",")}`),
      onPlan: (plan: string) => log.push(`plan ${JSON.stringify(plan)}`),
      onSteered: (id: string) => log.push(`steered ${id}`),
      onContext: (usage: object) =>
        log.push(`context ${JSON.stringify(usage)}`),
    },
  };
}

const run = (patch: Partial<Parameters<typeof runClaudeProject>[0]> = {}) =>
  runClaudeProject({
    job: { kind: "prompt" },
    cwd: "/project",
    prompt: "Go.",
    choice: {} as never,
    model: "",
    effort: "",
    signal: new AbortController().signal,
    onText() {},
    session: { key: crypto.randomUUID(), id: session_id, async onId() {} },
    ...patch,
  });

it("keeps commentary out of the answer and appends the findings Claude reported", async () => {
  claude(async function* ({ next }) {
    const sent = await next();
    yield lifecycle(sent.uuid, "started");
    yield event({ type: "message_start", message: { id: "m1" } });
    yield event({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Let me look." },
    });
    yield event({
      type: "content_block_start",
      content_block: { type: "tool_use" },
    });
    yield assistant("m1", [
      { type: "text", text: "Let me look." },
      {
        type: "tool_use",
        id: "t1",
        name: "Edit",
        input: { file_path: "/project/a.ts" },
      },
    ]);
    yield toolResult("t1", "edited");
    yield assistant("m2", [
      {
        type: "tool_use",
        id: "t2",
        name: "ReportFindings",
        input: { findings: [{ summary: "Off by one", file: "a.ts", line: 3 }] },
      },
    ]);
    yield toolResult("t2", "ok");
    yield says("m3", "Done.");
    yield result("Done.");
  });
  const { log, callbacks } = recorder();
  await expect(run(callbacks)).resolves.toBe(
    "Done.\n\nFindings:\n- Off by one `a.ts:3`",
  );
  expect(log).toMatchInlineSnapshot(`
    [
      "text "Let me look."",
      "commentary m1 "Let me look."",
      "text """,
      "commentary m1 "Let me look."",
      "activity t1 running",
      "edit /project/a.ts",
      "activity t1 complete edited",
      "activity t2 running",
      "activity t2 complete ok",
      "text "Done."",
      "text "Done.\\n\\nFindings:\\n- Off by one \`a.ts:3\`"",
    ]
  `);
});

it("answers a steer below it once Claude reads it", async () => {
  let steer!: (text: string, id?: string) => Promise<void>;
  const sent: Sent[] = [];
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", "Working on it");
    const steered = await next();
    sent.push(steered);
    yield lifecycle(steered.uuid, "queued");
    yield lifecycle(steered.uuid, "started");
    yield says("m2", "Also done.");
    yield result("Also done.");
  });
  const { log, callbacks } = recorder();
  const answer = run({
    ...callbacks,
    onControl: (control) => (steer = control.steer),
    onText: (text) => {
      callbacks.onText(text);
      if (text === "Working on it") void steer("And this", "msg-2");
    },
  });
  await expect(answer).resolves.toBe("Also done.");
  expect(sent[0]).toMatchObject({
    priority: "now",
    message: { content: "And this" },
  });
  expect(log).toMatchInlineSnapshot(`
    [
      "text "Working on it"",
      "steered msg-2",
      "text "Also done."",
      "text "Also done."",
    ]
  `);
  await expect(steer("Late", "msg-3")).rejects.toThrow(
    "This turn has finished. Send the queued message as a new turn.",
  );
});

it("answers a steer that cut a running tool short", async () => {
  let steer!: (text: string, id?: string) => Promise<void>;
  // The frames Claude Code 2.1.289 writes when a "now" steer lands mid-Bash.
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield assistant("m1", [
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "sleep 25" } },
    ]);
    const steered = await next();
    yield lifecycle(steered.uuid, "queued");
    yield toolResult("t1", "<error>Command was aborted before completion</error>");
    yield { ...result(""), terminal_reason: "aborted_tools" };
    yield lifecycle(prompt.uuid, "cancelled");
    yield lifecycle(steered.uuid, "started");
    yield { type: "system", subtype: "init", session_id };
    yield says("m2", "Stopped.");
    yield result("Stopped.");
  });
  const { log, callbacks } = recorder();
  await expect(
    run({
      ...callbacks,
      onControl: (control) => (steer = control.steer),
      onActivity: (a) => {
        callbacks.onActivity(a);
        if (a.status === "running") void steer("Stop that", "msg-2");
      },
    }),
  ).resolves.toBe("Stopped.");
  expect(log).toContain("steered msg-2");
  expect(log.at(-1)).toBe('text "Stopped."');
});

it("turns a steer away when the turn ends while its screenshot is read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "claude-turn-"));
  const shot = join(dir, "shot.png");
  await writeFile(shot, "png");
  let steering: Promise<string> | undefined;
  const late: Sent[] = [];
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", "Done.");
    yield result("Done.");
    late.push(await next());
  });
  const { log, callbacks } = recorder();
  try {
    await expect(
      run({
        ...callbacks,
        onControl: (control) => {
          steering = control
            .steer("And this", "msg-2", [{ path: shot, mimeType: "image/png" }])
            .then(
              () => "sent",
              (e: Error) => e.message,
            );
        },
      }),
    ).resolves.toBe("Done.");
    // Turned away, it stays queued and goes out as a turn of its own.
    expect(await steering).toBe(
      "This turn has finished. Send the queued message as a new turn.",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(late).toEqual([]);
    expect(log).not.toContain("steered msg-2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("follows a steer the CLI doesn't report into the turn Claude runs for it", async () => {
  let steer!: (text: string, id?: string) => Promise<void>;
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", "First.");
    await next();
    yield result("First.");
    yield { type: "system", subtype: "init", session_id };
    yield says("m2", "Second.");
    yield result("Second.");
  });
  const texts: string[] = [];
  await expect(
    run({
      onControl: (control) => (steer = control.steer),
      onText: (text) => {
        texts.push(text);
        if (texts.length === 1) void steer("And this");
      },
    }),
  ).resolves.toBe("First.\n\nSecond.");
  expect(texts.at(-1)).toBe("First.\n\nSecond.");
});

it("compacts the session and answers with the summary Claude kept", async () => {
  let prompt!: Sent;
  claude(async function* ({ next }) {
    prompt = await next();
    yield {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "manual",
        pre_tokens: 90_000,
        post_tokens: 12_000,
      },
      session_id,
    };
    yield {
      type: "user",
      isSynthetic: true,
      parent_tool_use_id: null,
      session_id,
      message: { role: "user", content: "Summary of the conversation" },
    };
    yield result("");
  });
  const { log, callbacks } = recorder();
  const control = vi.fn();
  await expect(
    run({
      ...callbacks,
      prompt: "keep the API notes",
      job: { kind: "compact" },
      onControl: control,
    }),
  ).resolves.toBe("Summary of the conversation");
  expect(prompt.message.content).toBe("/compact keep the API notes");
  expect(control).not.toHaveBeenCalled();
  expect(log).toEqual(['context {"usedTokens":12000}']);
});

it("answers a plan turn with the plan Claude wrote", async () => {
  const decisions: unknown[] = [];
  const options = claude(async function* ({ next, options }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    decisions.push(
      await options.canUseTool!(
        "ExitPlanMode",
        { plan: "1. Do it" },
        {
          signal: new AbortController().signal,
          toolUseID: "p",
          requestId: "r",
        },
      ),
    );
    yield says("m1", "I wrote a plan.");
    yield result("I wrote a plan.");
  });
  const { log, callbacks } = recorder();
  await expect(
    run({
      ...callbacks,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      onRequest: vi.fn(),
    }),
  ).resolves.toBe("1. Do it");
  expect(options().permissionMode).toBe("plan");
  expect(decisions).toEqual([
    {
      behavior: "deny",
      message:
        "Your plan is shown in Relay. Wait for the user's feedback or implementation request in a later turn.",
    },
  ]);
  expect(log).toMatchInlineSnapshot(`
    [
      "plan "1. Do it"",
      "text "1. Do it"",
      "text "I wrote a plan."",
      "text "1. Do it"",
    ]
  `);
});

it("asks the user what Claude's tools need, and passes their answers back", async () => {
  const options = claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", "ok");
    yield result("ok");
  });
  const asked: Omit<AgentRequest, "id">[] = [];
  let reply!: AgentResponse;
  const onRequest = vi.fn(async (request: Omit<AgentRequest, "id">) => {
    asked.push(request);
    return reply;
  });
  const ask = (
    tool: string,
    input: Record<string, unknown>,
    suggestions?: object[],
  ) =>
    options().canUseTool!(tool, input, {
      signal: new AbortController().signal,
      toolUseID: "tool",
      requestId: "request",
      ...(suggestions ? { suggestions: suggestions as never } : {}),
    });

  await run({
    runtimeMode: "approval-required",
    interactionMode: "default",
    onRequest,
  });
  const questions = {
    questions: [
      {
        header: "Pick",
        question: "Which?",
        multiSelect: true,
        options: [{ label: "A" }, { label: "B" }],
      },
    ],
  };
  reply = { kind: "question", answers: { "0": ["A", "B"] } };
  expect(await ask("AskUserQuestion", questions)).toEqual({
    behavior: "allow",
    updatedInput: { ...questions, answers: { "Which?": "A, B" } },
  });
  expect(asked.at(-1)).toEqual({
    kind: "question",
    title: "Claude needs your input",
    questions: [
      {
        id: "0",
        header: "Pick",
        question: "Which?",
        multiple: true,
        options: [{ label: "A" }, { label: "B" }],
      },
    ],
  });
  reply = { kind: "approval", decision: "accept" };
  expect(await ask("AskUserQuestion", questions)).toEqual({
    behavior: "deny",
    message: "No answers provided.",
  });

  const rule = {
    type: "addRules",
    rules: [{ toolName: "Bash" }],
    behavior: "allow",
  };
  reply = { kind: "approval", decision: "acceptForSession" };
  expect(await ask("Bash", { command: "ls" }, [rule])).toEqual({
    behavior: "allow",
    updatedInput: { command: "ls" },
    updatedPermissions: [{ ...rule, destination: "session" }],
  });
  expect(asked.at(-1)).toEqual({
    kind: "approval",
    title: "Allow Bash?",
    detail: JSON.stringify({ command: "ls" }, null, 2),
    decisions: ["accept", "acceptForSession", "decline", "cancel"],
  });
  reply = { kind: "approval", decision: "cancel" };
  expect(await ask("Bash", { command: "ls" })).toEqual({
    behavior: "deny",
    message: "Denied by the user.",
    interrupt: true,
  });
  expect(asked.at(-1)).toMatchObject({
    decisions: ["accept", "decline", "cancel"],
  });
  reply = { kind: "question", answers: {} };
  expect(await ask("Bash", { command: "ls" })).toEqual({
    behavior: "deny",
    message: "Invalid response.",
  });

  onRequest.mockClear();
  await run({
    runtimeMode: "full-access",
    interactionMode: "default",
    onRequest,
  });
  expect(await ask("Bash", { command: "ls" })).toEqual({
    behavior: "allow",
    updatedInput: { command: "ls" },
  });
  expect(onRequest).not.toHaveBeenCalled();

  await run({ runtimeMode: "full-access", interactionMode: "default" });
  expect(await ask("Bash", { command: "ls" })).toEqual({
    behavior: "deny",
    message: "This caller cannot answer permission requests.",
  });
});

it("shows a turn Claude starts by itself between prompts", async () => {
  let later!: () => void;
  const between = new Promise<void>((resolve) => (later = resolve));
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", "Started the build.");
    yield result("Started the build.");
    await between;
    yield says("m2", "The build passed.");
    yield result("The build passed.");
  });
  const key = crypto.randomUUID();
  let shown: Promise<string> | undefined;
  const session = {
    key,
    id: session_id,
    async onId() {},
    onUnprompted: async () => {
      shown = run({ job: { kind: "adopt" }, session });
      await shown.catch(() => {});
    },
  };
  await expect(run({ session })).resolves.toBe("Started the build.");
  later();
  await vi.waitFor(() => expect(shown).toBeDefined());
  await expect(shown).resolves.toBe("The build passed.");
  await expect(run({ job: { kind: "adopt" }, session })).rejects.toThrow(
    "Claude has no turn of its own to show.",
  );
});

it("reads a turn nobody shows to its end before the next prompt goes out", async () => {
  let later!: () => void, finish!: () => void;
  const between = new Promise<void>((resolve) => (later = resolve));
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const order: string[] = [];
  claude(async function* ({ next }) {
    for (let turn = 1; ; turn++) {
      const prompt = await next();
      order.push(`prompt ${turn}`);
      yield lifecycle(prompt.uuid, "started");
      yield says(`m${turn}`, `Answer ${turn}.`);
      yield result(`Answer ${turn}.`);
      if (turn === 1) {
        await between;
        yield says("own", "Claude's own words.");
        await finished;
        order.push("own result");
        yield result("Claude's own words.");
      }
    }
  });
  const session = {
    key: crypto.randomUUID(),
    id: session_id,
    async onId() {},
    onUnprompted: vi.fn(async () => {}),
  };
  await expect(run({ session })).resolves.toBe("Answer 1.");
  later();
  await vi.waitFor(() => expect(session.onUnprompted).toHaveBeenCalled());
  const texts: string[] = [];
  const second = run({ session, onText: (text) => texts.push(text) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(order).toEqual(["prompt 1"]);
  finish();
  await expect(second).resolves.toBe("Answer 2.");
  expect(order).toEqual(["prompt 1", "own result", "prompt 2"]);
  expect(texts).not.toContain("Claude's own words.");
});

it("holds an answer with follow-ups to the size limit", async () => {
  let steer!: (text: string, id?: string) => Promise<void>;
  const long = "x".repeat(60_000);
  claude(async function* ({ next }) {
    const prompt = await next();
    yield lifecycle(prompt.uuid, "started");
    yield says("m1", long);
    await next();
    yield result(long);
    yield { type: "system", subtype: "init", session_id };
    yield says("m2", long);
    yield result(long);
  });
  let shown = "";
  await expect(
    run({
      onControl: (control) => (steer = control.steer),
      onText: (text) => {
        if (!shown) void steer("And this");
        shown = text;
      },
    }),
  ).rejects.toThrow("Answer size limit reached.");
  // What was shown before the limit stays, and never past it.
  expect(shown).toBe(long);
});
