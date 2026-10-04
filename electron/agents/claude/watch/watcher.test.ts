import { describe, expect, it, vi } from "vitest";
import type { WatchNote } from "../../../../shared/watch";
import type { AgentWatch } from "../../types";
import { WatchChecks } from "./checks";
import { SubagentWatch } from "./subagents";
import { TurnWatcher } from "./watcher";

const none = "learn: none";
const note = (line: string) => `learn: ${line}\ntag: Heads up\n- a point`;

function setup(answer: (question: string) => string = () => none) {
  const notes: WatchNote[] = [];
  const asked: string[] = [];
  const abort = new AbortController();
  const checks = new WatchChecks(async (question) => {
    asked.push(question);
    return answer(question);
  });
  const watch = (scope: AgentWatch["scope"]): AgentWatch => ({
    scope,
    known: ["Already known topic"],
    onNote: (n) => notes.push(n),
  });
  return { checks, notes, asked, abort, watch };
}

const calls = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => `call-${from + i}`);

describe("TurnWatcher", () => {
  it("checks the thread every sixth main call, counting each call once", async () => {
    const { checks, asked, abort, watch } = setup();
    const turn = new TurnWatcher(watch("main"), checks, abort.signal);
    turn.called(calls(0, 5));
    turn.called(calls(0, 5));
    await checks.idle();
    expect(asked).toHaveLength(0);
    turn.called(calls(5, 1));
    await checks.idle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Already known topic");
  });

  it("shows a note once and waits longer before the next look", async () => {
    const { checks, notes, asked, abort, watch } = setup(() =>
      note("Retries hide failures."),
    );
    const turn = new TurnWatcher(watch("main"), checks, abort.signal);
    turn.called(calls(0, 6));
    await checks.idle();
    expect(notes.map((n) => n.line)).toEqual(["Retries hide failures."]);
    turn.called(calls(6, 6));
    await checks.idle();
    expect(asked).toHaveLength(1);
    turn.called(calls(12, 6));
    await checks.idle();
    expect(asked).toHaveLength(2);
    // The same point again isn't shown twice.
    expect(notes).toHaveLength(1);
  });

  it("skips what the person said they know", async () => {
    const { checks, notes, abort, watch } = setup(() =>
      note("Already known topic"),
    );
    new TurnWatcher(watch("main"), checks, abort.signal).called(calls(0, 6));
    await checks.idle();
    expect(notes).toHaveLength(0);
  });

  it("stops asking once the turn is aborted", async () => {
    const { checks, asked, abort, watch } = setup();
    abort.abort();
    new TurnWatcher(watch("main"), checks, abort.signal).called(calls(0, 12));
    await checks.idle();
    expect(asked).toHaveLength(0);
  });
});

// Frames as the SDK sends them, cut to what the watch reads.
const launch = (id: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: {
    content: [
      {
        type: "tool_use",
        id,
        name: "Agent",
        input: { description: "Fix tests", prompt: "Make checkout tests pass" },
      },
    ],
  },
});
const started = (id: string, background: boolean) => ({
  type: "system",
  subtype: "task_started",
  task_id: `task-${id}`,
  tool_use_id: id,
  is_backgrounded: background,
});
let callId = 0;
const subCall = (parent: string, name: string, input: unknown, text = "") => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: {
    content: [
      ...(text ? [{ type: "text", text }] : []),
      { type: "tool_use", id: `${parent}-${callId++}`, name, input },
    ],
  },
});
const result = (id: string) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_result", tool_use_id: id, content: "" }] },
});
const finished = (id: string) => ({
  type: "system",
  subtype: "task_notification",
  task_id: `task-${id}`,
  status: "completed",
});

describe("SubagentWatch", () => {
  it("checks a background subagent's edits when it finishes, after its turn ended", async () => {
    const { checks, notes, asked, abort, watch } = setup((q) =>
      q.includes("subagent-run") ? note("The test was loosened.") : none,
    );
    const agents = new SubagentWatch(checks);
    const turn = { watch: watch("subagents"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    agents.observe(started("a1", true), turn);
    // The placeholder result of a background launch isn't its end.
    agents.observe(result("a1"), turn);
    // The turn that started it is over; its work goes on.
    const between = { signal: new AbortController().signal };
    agents.observe(
      subCall(
        "a1",
        "Edit",
        {
          file_path: "tests/checkout.spec.ts",
          old_string: 'expect(total).toBe("42.00")',
          new_string: "expect(total).toMatch(/\\d+/)",
        },
        "Loosening the assertion.",
      ),
      between,
    );
    await checks.idle();
    expect(asked).toHaveLength(0);
    agents.observe(finished("a1"), between);
    await checks.idle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('- expect(total).toBe("42.00")');
    expect(asked[0]).toContain("It said: Loosening the assertion.");
    expect(notes[0].agent).toEqual({ id: "a1", label: "Fix tests" });
  });

  it("checks a foreground subagent when its result comes back, once", async () => {
    const { checks, asked, abort, watch } = setup();
    const agents = new SubagentWatch(checks);
    const turn = { watch: watch("subagents"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    agents.observe(started("a1", false), turn);
    agents.observe(subCall("a1", "Read", { file_path: "a.ts" }), turn);
    agents.observe(result("a1"), turn);
    agents.observe(finished("a1"), turn);
    await checks.idle();
    expect(asked).toHaveLength(1);
  });

  it("leaves subagents alone when the turn watches only the main thread", async () => {
    const { checks, asked, abort, watch } = setup();
    const agents = new SubagentWatch(checks);
    const turn = { watch: watch("main"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    for (let i = 0; i < 10; i++)
      agents.observe(subCall("a1", "Read", { file_path: `f${i}` }), turn);
    agents.observe(finished("a1"), turn);
    await checks.idle();
    expect(asked).toHaveLength(0);
  });
});

describe("WatchChecks", () => {
  it("runs one check at a time and doesn't queue the same one twice", async () => {
    let release!: () => void;
    const ask = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve(none);
        }),
    );
    const checks = new WatchChecks(ask);
    const check = {
      prompt: () => "q",
      watch: { scope: "main" as const, known: [], onNote: () => {} },
      signal: new AbortController().signal,
    };
    checks.enqueue({ ...check, key: "main" });
    checks.enqueue({ ...check, key: "a" });
    checks.enqueue({ ...check, key: "a" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ask).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ask).toHaveBeenCalledTimes(2);
    release();
    await checks.idle();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
