import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { findExecutable } from "../../platform/executables";
import type { ThreadGoal } from "../../../shared/goal";
import type { AgentJob, AgentOptions } from "../types";
import { runCodex } from "./codex";
import { fakeCli } from "../../../tests/fixtures/fake-cli";
vi.mock("../../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../../platform/executables")>()),
  findExecutable: vi.fn(),
}));
afterEach(() => void vi.unstubAllEnvs());

async function run(
  job: AgentJob,
  /** How many turns the goal takes, and the goal the thread starts with. */
  wire: {
    turns?: number;
    goal?: Record<string, unknown>;
    failTurn?: number;
  } = {},
  more: Partial<AgentOptions> = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-goal-")));
  const log = join(root, "requests.jsonl");
  vi.stubEnv("RELAY_GOAL_LOG", log);
  vi.stubEnv("RELAY_GOAL_TURNS", String(wire.turns ?? 3));
  vi.stubEnv("RELAY_GOAL", wire.goal ? JSON.stringify(wire.goal) : "");
  vi.stubEnv("RELAY_GOAL_FAIL_TURN", String(wire.failTurn ?? 0));
  vi.mocked(findExecutable).mockResolvedValue(
    await fakeCli(
      join(root, "codex"),
      await readFile(resolve("tests/fixtures/codex-goal.cjs"), "utf8"),
    ),
  );
  const goals: (ThreadGoal | null)[] = [];
  const notes: string[] = [];
  const answer = runCodex({
    job,
    cwd: root,
    prompt: "/goal",
    choice: { model: "", reasoningEffort: "", fast: false },
    runtimeMode: "full-access",
    interactionMode: "default",
    signal: new AbortController().signal,
    onText() {},
    onCommentary: (_, text) => void (text && notes.push(text)),
    onGoal: (goal) => goals.push(goal),
    session: { onId: async () => {} },
    ...more,
  });
  const requests = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; params: any })
      .filter((r) => r.method !== "initialize" && r.method !== "config/read");
  return { answer, goals, notes, requests };
}

const objective = "one.txt, two.txt and three.txt exist";
const set = { kind: "goal", command: { type: "set", objective } } as const;

it("keeps one run across the turns Codex starts for a goal, until it's met", async () => {
  const { answer, goals, notes, requests } = await run(set);
  expect(await answer).toBe("Turn 3 done.");
  // Earlier turns' answers stay above the last one as notes.
  expect(notes).toEqual(["Turn 1 done.", "Turn 2 done."]);
  expect(goals.at(-1)).toMatchObject({
    provider: "codex",
    objective,
    status: "complete",
    tokensUsed: 3000,
  });
  // Paused until the first turn runs on the thread's settings, then on.
  const sent = (await requests()).map((r) =>
    r.method === "thread/goal/set" ? `set ${r.params.status}` : r.method,
  );
  expect(sent).toEqual([
    "thread/start",
    "thread/goal/get",
    "set paused",
    "turn/start",
    "set active",
  ]);
  const start = (await requests()).find((r) => r.method === "turn/start")!;
  expect(start.params.input).toEqual([
    { type: "text", text: objective, text_elements: [] },
  ]);
});

it("pauses the goal before interrupting the turn when stopped", async () => {
  const stop = new AbortController();
  const { answer, goals, requests } = await run(
    set,
    { turns: 5 },
    {
      signal: stop.signal,
      onCommentary: (_, text) => {
        // Stopped in the goal's second turn.
        if (text === "Turn 1 done.") setTimeout(() => stop.abort(), 10);
      },
    },
  );
  await expect(answer).rejects.toThrow();
  const sent = (await requests()).map((r) =>
    r.method === "thread/goal/set" ? `set ${r.params.status}` : r.method,
  );
  expect(sent.slice(-2)).toEqual(["set paused", "turn/interrupt"]);
  expect(goals.at(-1)).toMatchObject({ status: "paused" });
});

it("lets the turn finish and starts no other when the goal is paused mid-run", async () => {
  let pause: (() => Promise<void>) | undefined;
  const { answer, goals, requests } = await run(
    set,
    { turns: 5 },
    {
      onControl: (control) => {
        pause ??= () => control.goal!("pause");
        void pause();
      },
    },
  );
  expect(await answer).toBe("Turn 1 done.");
  expect(goals.at(-1)).toMatchObject({ status: "paused" });
  expect(
    (await requests()).filter((r) => r.method === "turn/start"),
  ).toHaveLength(1);
});

it("answers /goal pause, clear and show without starting a turn", async () => {
  const goal = {
    threadId: "thread",
    objective,
    status: "active",
    tokenBudget: null,
    tokensUsed: 12000,
    timeUsedSeconds: 300,
  };
  const paused = await run(
    { kind: "goal", command: { type: "pause" } },
    { goal },
  );
  expect(await paused.answer).toBe(
    "Goal paused. Send /goal resume to continue.",
  );
  expect(paused.goals.at(-1)).toMatchObject({
    status: "paused",
    tokensUsed: 12000,
    timeUsedSeconds: 300,
  });
  const cleared = await run(
    { kind: "goal", command: { type: "clear" } },
    { goal },
  );
  expect(await cleared.answer).toBe("Goal cleared.");
  expect(cleared.goals.at(-1)).toBeNull();
  const shown = await run({ kind: "goal", command: { type: "show" } });
  expect(await shown.answer).toBe("No goal is set.");
  for (const { requests } of [paused, cleared, shown])
    expect((await requests()).some((r) => r.method === "turn/start")).toBe(
      false,
    );
});

const stopped = (status: string) => ({
  threadId: "thread",
  objective,
  status,
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
});

it("resumes a goal with a turn of its own on this message's settings, then lets Codex go on", async () => {
  const { answer, goals, requests } = await run(
    { kind: "goal", command: { type: "resume" } },
    { turns: 2, goal: stopped("paused") },
    {
      choice: { model: "gpt-6-sol", reasoningEffort: "high", fast: false },
      runtimeMode: "approval-required",
    },
  );
  expect(await answer).toBe("Turn 2 done.");
  expect(goals.at(-1)).toMatchObject({ status: "complete" });
  const sent = await requests();
  expect(
    sent.map((r) =>
      r.method === "thread/goal/set" ? `set ${r.params.status}` : r.method,
    ),
  ).toEqual(["thread/start", "thread/goal/get", "turn/start", "set active"]);
  // Codex refuses an empty turn, and one it starts takes the last turn's settings.
  const start = sent.find((r) => r.method === "turn/start")!.params;
  expect(start.input).toEqual([
    { type: "text", text: "Continue toward the goal.", text_elements: [] },
  ]);
  expect(start).toMatchObject({
    model: "gpt-6-sol",
    effort: "high",
    approvalPolicy: "untrusted",
    sandboxPolicy: { type: "readOnly" },
  });
});

it("doesn't resume a goal past its token budget", async () => {
  const { answer, requests } = await run(
    { kind: "goal", command: { type: "resume" } },
    { goal: stopped("budgetLimited") },
  );
  expect(await answer).toBe(`Goal budget limited: ${objective}`);
  expect((await requests()).some((r) => r.method === "turn/start")).toBe(false);
});

it("leaves the goal paused when a turn pursuing it fails", async () => {
  // The resumed goal's own turn, and one Codex starts for it later.
  for (const failTurn of [1, 2]) {
    const { answer, goals, requests } = await run(
      { kind: "goal", command: { type: "resume" } },
      { turns: 5, failTurn, goal: stopped("paused") },
    );
    await expect(answer).rejects.toThrow();
    expect(goals.at(-1)).toMatchObject({ status: "paused" });
    const sets = (await requests()).filter(
      (r) => r.method === "thread/goal/set",
    );
    expect(sets.at(-1)!.params.status).toBe("paused");
  }
});

it("pauses a goal left active before loading the thread for a prompt", async () => {
  const { answer, goals, requests } = await run(
    { kind: "prompt" },
    {
      turns: 1,
      goal: {
        threadId: "thread",
        objective,
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
      },
    },
    { session: { id: "thread", onId: async () => {} } },
  );
  expect(await answer).toBe("Turn 1 done.");
  expect(goals[0]).toMatchObject({ status: "paused" });
  const sent = (await requests()).map((r) =>
    r.method === "thread/goal/set" ? `set ${r.params.status}` : r.method,
  );
  expect(sent).toEqual([
    "thread/goal/get",
    "set paused",
    "thread/resume",
    "turn/start",
  ]);
});
