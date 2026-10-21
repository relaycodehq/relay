import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { findExecutable } from "../../platform/executables";
import { runCodex } from "./codex";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
import { agentError } from "../../../shared/agent-error";
import type { AgentActivity } from "../../../shared/projects";
import type { AgentOptions } from "../types";
vi.mock("../../platform/executables");

type Wire = Record<string, unknown>;
// Answers like `codex app-server` whose config.toml sets `model_reasoning_effort = "xhigh"`.
// `said` goes out after turn/start's answer; `ending` replaces the usual turn/completed.
const fakeCodex = (
  log: string,
  {
    thread = {
      thread: { id: "thread" },
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    },
    turn = { turn: { id: "turn" } },
    said = [
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          item: {
            id: "a",
            type: "agentMessage",
            phase: "final_answer",
            text: "Done.",
          },
        },
      },
    ],
    ending = {
      method: "turn/completed",
      params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
    },
    refusing,
    crash,
    stops,
  }: {
    thread?: Wire;
    turn?: Wire;
    said?: Wire[];
    ending?: Wire | null;
    /** A JSON-RPC error answering `method` instead of its result. */
    refusing?: { method: string; error: Wire };
    /** Dies at turn/start like a CLI whose runtime can't load. */
    crash?: boolean;
    /** Takes turn/interrupt, logging it in place of the turn, and ends the turn as interrupted. */
    stops?: boolean;
  } = {},
) => `
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === ${JSON.stringify(refusing?.method ?? "")})
    send({ id: m.id, error: ${JSON.stringify(refusing?.error ?? {})} });
  else if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (${JSON.stringify(!!stops)} && m.method === "turn/interrupt") {
    require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(m.params));
    send({ id: m.id, result: {} });
    send({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "interrupted" } } });
  }
  else if (m.method === "config/read") send({ id: m.id, result: { config: {} } });
  else if (m.method === "thread/start")
    send({ id: m.id, result: ${JSON.stringify(thread)} });
  else if (m.method === "turn/start" || m.method === "review/start") {
    if (${JSON.stringify(!!crash)}) {
      process.stderr.write("dyld: Library not loaded: libfixture.dylib\\n");
      process.exit(134);
    }
    require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(m.params));
    send({ id: m.id, result: ${JSON.stringify(turn)} });
    for (const said of ${JSON.stringify(said)}) send(said);
    if (${JSON.stringify(!!ending)}) send(${JSON.stringify(ending)});
  }
});
`;

async function ask(
  wire?: Parameters<typeof fakeCodex>[1],
  more?: Partial<AgentOptions>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-codex-")));
  const log = join(root, "turn.json");
  const cli = await fakeCli(join(root, "codex"), fakeCodex(log, wire));
  vi.mocked(findExecutable).mockResolvedValue(cli);
  const answer = runCodex({
    job: { kind: "prompt" },
    cwd: root,
    prompt: "Hi",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText() {},
    ...more,
  });
  return { answer, log };
}

it("runs a turn at Codex's own effort when the default is chosen", async () => {
  const run = await ask();
  const log = run.log;
  const answer = await run.answer;
  expect(answer).toBe("Done.");
  const turn = JSON.parse(await readFile(log, "utf8"));
  // The collaboration mode's settings win over `effort`.
  expect(turn.collaborationMode.settings).toMatchObject({
    model: "gpt-6-astra",
    reasoning_effort: "xhigh",
  });
});

it("says what is missing when Codex's answer to starting the thread or the turn lacks it", async () => {
  await expect(
    (await ask({ thread: { model: "gpt-6-astra" } })).answer,
  ).rejects.toThrow(/unexpected thread\/start response \(thread/);
  await expect(
    (await ask({ turn: { started: true }, said: [], ending: null })).answer,
  ).rejects.toThrow(/unexpected turn\/start response \(turn/);
});

it("says how Codex died and keeps what it said last for the details", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const failed = await (await ask({ crash: true })).answer.catch((e) => e);
  expect(agentError(failed.message)).toEqual({
    message: "Codex stopped before finishing (exit code 134).",
    details: "dyld: Library not loaded: libfixture.dylib",
  });
  expect(warn).toHaveBeenCalledWith(
    "Codex stopped before finishing (exit code 134):",
    "dyld: Library not loaded: libfixture.dylib",
  );
  warn.mockRestore();
});

it("fails the turn with the notification named when one it reads arrives malformed", async () => {
  const delta = (params: Wire) => ({
    method: "item/agentMessage/delta",
    params: { threadId: "thread", ...params },
  });
  await expect(
    (await ask({ said: [delta({ itemId: "a", delta: 5 })] })).answer,
  ).rejects.toThrow(
    /unexpected item\/agentMessage\/delta notification \(delta/,
  );
  await expect(
    (
      await ask({
        ending: {
          method: "turn/completed",
          params: { threadId: "thread", turn: { id: "turn" } },
        },
      })
    ).answer,
  ).rejects.toThrow(/unexpected turn\/completed notification \(turn\.status/);
});

it("ignores notifications it doesn't read, and fields it doesn't know", async () => {
  const { answer } = await ask({
    thread: {
      thread: { id: "thread", newer: true },
      model: "gpt-6-astra",
      reasoningEffort: null,
      somethingNew: 1,
    },
    said: [
      { method: "mcpServer/startupStatus/updated", params: 5 },
      { method: "thread/status/changed", params: { threadId: "thread" } },
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: {
            id: "a",
            type: "agentMessage",
            phase: null,
            text: "Done.",
            memoryCitation: { entries: [] },
          },
        },
      },
    ],
  });
  expect(await answer).toBe("Done.");
});

const on = (method: string, params: Wire) => ({
  method,
  params: { threadId: "thread", ...params },
});
const review = (method: string, type: string, more: Wire = {}) =>
  on(method, { turnId: "turn", item: { id: type, type, ...more } });
const reviewJob = {
  kind: "review",
  target: { type: "uncommittedChanges" },
} as const;

it("ends a /review when Codex completes it, past the turn it starts for the review itself", async () => {
  // In the order a real `codex app-server` sends them.
  const { answer } = await ask(
    {
      said: [
        review("item/started", "enteredReviewMode"),
        review("item/completed", "enteredReviewMode"),
        on("turn/started", { turn: { id: "inner" } }),
        review("item/started", "exitedReviewMode"),
        review("item/completed", "exitedReviewMode", {
          review: "[P1] Wrong sign.",
        }),
      ],
    },
    { job: reviewJob },
  );
  expect(await answer).toBe("[P1] Wrong sign.");
});

it("stops a /review in the turn Codex runs it in, as Codex refuses the outer one", async () => {
  const stop = new AbortController();
  const { answer, log } = await ask(
    {
      said: [
        review("item/started", "enteredReviewMode"),
        on("turn/started", { turn: { id: "inner" } }),
        review("item/started", "commandExecution", { command: "git diff" }),
      ],
      ending: null,
      stops: true,
    },
    {
      job: reviewJob,
      signal: stop.signal,
      onActivity: (a) => {
        if (a.kind !== "command") return;
        // Held, Codex's 3s to acknowledge can't run out on a busy machine
        // before the fake has taken the interrupt.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        stop.abort();
      },
    },
  );
  await expect(answer).rejects.toThrow();
  // The answer ends at Stop, before the fake has written the interrupt down.
  const interrupted = async () => {
    const text = await readFile(log, "utf8");
    try {
      return JSON.parse(text).turnId === "inner";
    } catch {
      return false; // Read mid-write.
    }
  };
  try {
    while (!(await interrupted()))
      await new Promise((resolve) => setImmediate(resolve));
  } finally {
    vi.useRealTimers();
  }
  expect(JSON.parse(await readFile(log, "utf8"))).toEqual({
    threadId: "thread",
    turnId: "inner",
  });
});

it("ends a turn Codex rejected the login of as signed out, and a spent plan as a limit", async () => {
  const failing = (error: Wire) => ({
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "failed", error },
    },
  });
  await expect(
    (
      await ask({
        ending: failing({
          message: "token refresh failed",
          codexErrorInfo: "unauthorized",
        }),
      })
    ).answer,
  ).rejects.toMatchObject({ kind: "signedOut", provider: "codex" });
  const limit = await (
    await ask({
      ending: failing({
        message: "You've hit your usage limit.",
        codexErrorInfo: "usageLimitExceeded",
      }),
    })
  ).answer.catch((e) => e);
  expect(limit).toMatchObject({ kind: "usageLimit", provider: "codex" });
  expect(limit.resetsAt).toBeUndefined();
  // Anything else Codex says stays its own words.
  await expect(
    (
      await ask({
        ending: failing({
          message: "The model is overloaded.",
          codexErrorInfo: "serverOverloaded",
        }),
      })
    ).answer,
  ).rejects.toThrow("The model is overloaded.");
});

it.each(["thread/start", "turn/start"])(
  "ends a turn whose %s request Codex refused as unauthorized as signed out",
  async (method) => {
    for (const error of [
      {
        code: -32603,
        message: "unexpected status 401 Unauthorized: Missing bearer",
      },
      {
        code: -32603,
        message: "Request failed",
        data: { codexErrorInfo: "unauthorized" },
      },
    ]) {
      const { answer } = await ask({ refusing: { method, error } });
      await expect(answer).rejects.toMatchObject({
        kind: "signedOut",
        provider: "codex",
      });
    }
  },
);

it("leaves a refused request that isn't about the login as Codex's own words", async () => {
  const { answer } = await ask({
    refusing: {
      method: "turn/start",
      error: { code: -32600, message: "Invalid request: no such model." },
    },
  });
  const error = await answer.catch((e) => e);
  expect(error).not.toHaveProperty("kind");
  expect(error.message).toContain("Invalid request: no such model.");
});

it("folds a subagent's calls under its agent row and keeps its words out of the answer", async () => {
  const on = (threadId: string, method: string, params: Wire) => ({
    method,
    params: { threadId, ...params },
  });
  const rows = new Map<string, AgentActivity>();
  const edits: string[] = [];
  const { answer } = await ask(
    {
      said: [
        // As Codex does, the run's own turn starts before anything spawns.
        on("thread", "turn/started", { turn: { id: "turn" } }),
        on("thread", "item/completed", {
          item: {
            id: "call",
            type: "subAgentActivity",
            kind: "started",
            agentThreadId: "child",
            agentPath: "/root/check_alpha",
          },
        }),
        on("child", "turn/started", { turn: { id: "ct", rootTurnId: "turn" } }),
        on("child", "item/completed", {
          item: {
            id: "patch",
            type: "fileChange",
            changes: [{ path: "/repo/c.txt" }],
            status: "completed",
          },
        }),
        // The parent answers before its subagent's last word arrives.
        on("thread", "item/completed", {
          item: {
            id: "a",
            type: "agentMessage",
            phase: "final_answer",
            text: "Done.",
          },
        }),
        on("child", "item/completed", {
          item: {
            id: "said",
            type: "agentMessage",
            phase: "final_answer",
            text: "CHILD-SECRET",
          },
        }),
        on("child", "turn/completed", {
          turn: { id: "ct", status: "completed" },
        }),
        // Another run's subagent on the same server isn't this turn's.
        on("other", "turn/started", { turn: { id: "ot", rootTurnId: "else" } }),
        on("other", "item/completed", {
          item: { id: "x", type: "commandExecution", command: "ls" },
        }),
      ],
    },
    {
      onActivity: (a) => rows.set(a.id, a),
      onEdit: (paths) => edits.push(...paths),
    },
  );
  expect(await answer).toBe("Done.");
  expect(rows.get("agent:child")).toEqual({
    id: "agent:child",
    kind: "agent",
    label: "Check alpha",
    status: "complete",
    detail: "CHILD-SECRET",
  });
  expect(rows.get("patch")).toMatchObject({
    kind: "file",
    parentId: "agent:child",
  });
  expect(rows.has("x")).toBe(false);
  expect(edits).toEqual(["/repo/c.txt"]);
});

const answered = {
  method: "item/completed",
  params: {
    threadId: "thread",
    item: {
      id: "a",
      type: "agentMessage",
      phase: "final_answer",
      text: "Done.",
    },
  },
};

it("reports each request's tokens on the thread's model, and how full the window is", async () => {
  const usage: unknown[] = [];
  const context: unknown[] = [];
  const { answer } = await ask(
    {
      said: [
        {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread",
            tokenUsage: {
              last: {
                totalTokens: 1200,
                inputTokens: 1000,
                cachedInputTokens: 400,
                outputTokens: 200,
              },
              total: { totalTokens: 5000 },
              modelContextWindow: 200000,
            },
          },
        },
        answered,
      ],
    },
    {
      onUsage: (u) => usage.push(u),
      onContext: (c) => context.push(c),
    },
  );
  expect(await answer).toBe("Done.");
  expect(usage).toEqual([
    expect.objectContaining({
      model: "gpt-6-astra",
      tokens: { input: 600, cacheRead: 400, cacheWrite: 0, output: 200 },
      fast: false,
    }),
  ]);
  expect(context).toEqual([
    expect.objectContaining({
      usedTokens: 1200,
      maxTokens: 200000,
      totalTokens: 5000,
    }),
  ]);
});

it("fails the turn on an error Codex won't retry, and waits out one it will", async () => {
  const error = (message: string, willRetry: boolean) => ({
    method: "error",
    params: {
      threadId: "thread",
      error: { message, codexErrorInfo: null },
      willRetry,
    },
  });
  const retried = await ask({ said: [error("Hiccup", true), answered] });
  expect(await retried.answer).toBe("Done.");
  const failed = await ask({ said: [error("Boom", false)], ending: null });
  await expect(failed.answer).rejects.toThrow("Boom");
});

it("answers with the plan when Codex plans, showing each new step list once", async () => {
  const rows: AgentActivity[] = [];
  const plans: string[] = [];
  const steps = {
    method: "turn/plan/updated",
    params: {
      threadId: "thread",
      plan: [{ step: "Read the code", status: "completed" }],
    },
  };
  const { answer } = await ask(
    {
      said: [
        steps,
        steps,
        {
          method: "item/plan/delta",
          params: { threadId: "thread", delta: "1. Read" },
        },
        {
          method: "item/plan/delta",
          params: { threadId: "thread", delta: " the code" },
        },
        answered,
      ],
    },
    {
      onActivity: (a) => rows.push(a),
      onPlan: (plan) => plans.push(plan),
    },
  );
  expect(await answer).toBe("1. Read the code");
  expect(plans).toEqual(["1. Read", "1. Read the code"]);
  expect(rows.filter((r) => r.label === "Updated the plan")).toHaveLength(1);
});

it("interrupts the running turn when stopped, even if Codex refuses the interrupt", async () => {
  const stop = new AbortController();
  const { answer } = await ask(
    {
      said: [],
      ending: null,
      refusing: {
        method: "turn/interrupt",
        error: { code: -32600, message: "No turn." },
      },
    },
    {
      signal: stop.signal,
      onControl: () => stop.abort(),
    },
  );
  await expect(answer).rejects.toThrow("Cancelled by you.");
});

it("stops waiting when Codex never acknowledges the interrupt", async () => {
  const stop = new AbortController();
  let running!: () => void;
  const started = new Promise<void>((resolve) => (running = resolve));
  const { answer } = await ask(
    { said: [], ending: null },
    { signal: stop.signal, onControl: () => running() },
  );
  await started;
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    stop.abort();
    vi.advanceTimersByTime(3000);
    await expect(answer).rejects.toThrow("Cancelled by you.");
  } finally {
    vi.useRealTimers();
  }
});
