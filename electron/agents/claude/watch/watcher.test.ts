import { describe, expect, it, vi } from "vitest";
import type { WatchNote } from "../../../../shared/watch";
import type { AgentWatch } from "../../types";
import { WatchChecks } from "../../watch/checks";
import { SubagentWatch } from "./subagents";
import { TurnWatcher } from "../../watch/watcher";

const none = "learn: none";
const note = (line: string) => `learn: ${line}\ntag: Heads up\n- a point`;

function setup(answer: (question: string) => string = () => none) {
  const notes: WatchNote[] = [];
  const asked: string[] = [];
  const abort = new AbortController();
  const checks = new WatchChecks(async (question) => {
    asked.push(question);
    return { reply: answer(question) };
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
  it("looks back once when a turn that did some work ends", async () => {
    const { checks, asked, abort, watch } = setup();
    const turn = new TurnWatcher(watch("main"), checks, abort.signal);
    turn.called(calls(0, 3));
    turn.called(calls(0, 3));
    await checks.idle();
    // Nothing while it works.
    expect(asked).toHaveLength(0);
    turn.ended();
    turn.ended();
    await checks.idle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("The turn just ended");
  });

  it("asks it to skip the whole topic of what this thread said it knows, not other threads'", async () => {
    const { checks, asked, abort } = setup();
    const turn = new TurnWatcher(
      {
        scope: "main",
        // Said in other threads: only a note saying the same is skipped.
        known: ["Already known topic"],
        topics: ["Full plan is being built now: The agent is building it all."],
        onNote: () => {},
      },
      checks,
      abort.signal,
    );
    turn.called(calls(0, 3));
    turn.ended();
    await checks.idle();
    expect(asked[0]).toContain(
      "skip it and anything else about the same feature or decision",
    );
    expect(asked[0]).toContain(
      "- Full plan is being built now: The agent is building it all.",
    );
    expect(asked[0]).not.toContain("Already known topic");
  });

  it("leaves a turn that barely did anything alone", async () => {
    const { checks, asked, abort, watch } = setup();
    const turn = new TurnWatcher(watch("main"), checks, abort.signal);
    turn.called(calls(0, 2));
    turn.ended();
    await checks.idle();
    expect(asked).toHaveLength(0);
  });

  it("skips what the person said they know, and a point already made", async () => {
    const { checks, notes, abort, watch } = setup(() =>
      note("Retries hide failures."),
    );
    for (let i = 0; i < 2; i++) {
      const turn = new TurnWatcher(watch("main"), checks, abort.signal);
      turn.called(calls(i * 10, 3));
      turn.ended();
      await checks.idle();
    }
    expect(notes.map((n) => n.line)).toEqual(["Retries hide failures."]);
    const known = setup(() => note("Already known topic"));
    const turn = new TurnWatcher(
      known.watch("main"),
      known.checks,
      known.abort.signal,
    );
    turn.called(calls(0, 3));
    turn.ended();
    await known.checks.idle();
    expect(known.notes).toHaveLength(0);
  });

  it("doesn't look back at a turn that was stopped", async () => {
    const { checks, asked, abort, watch } = setup();
    const turn = new TurnWatcher(watch("main"), checks, abort.signal);
    turn.called(calls(0, 12));
    abort.abort();
    turn.ended();
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

const loosen = (id: string) =>
  subCall(
    id,
    "Edit",
    {
      file_path: "tests/checkout.spec.ts",
      old_string: 'expect(total).toBe("42.00")',
      new_string: "expect(total).toMatch(/\\d+/)",
    },
    "Loosening the assertion.",
  );

describe("SubagentWatch", () => {
  it("hands a background subagent's edits to the next look back, once", async () => {
    const { checks, asked, abort, watch } = setup();
    const agents = new SubagentWatch();
    const turn = { watch: watch("subagents"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    agents.observe(started("a1", true), turn);
    // The placeholder result of a background launch isn't its end.
    agents.observe(result("a1"), turn);
    expect(agents.take()).toEqual([]);
    // The turn that started it is over; its work goes on.
    const between = { signal: new AbortController().signal };
    agents.observe(loosen("a1"), between);
    agents.observe(finished("a1"), between);
    // Claude's own turn about the finished subagent ends with a look back.
    const next = new TurnWatcher(watch("subagents"), checks, abort.signal, () =>
      agents.take(),
    );
    next.ended();
    await checks.idle();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('<subagent-run task="Fix tests">');
    expect(asked[0]).toContain('- expect(total).toBe("42.00")');
    expect(asked[0]).toContain("It said: Loosening the assertion.");
    expect(agents.take()).toEqual([]);
  });

  it("leaves out a subagent that only read", () => {
    const { abort, watch } = setup();
    const agents = new SubagentWatch();
    const turn = { watch: watch("subagents"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    agents.observe(started("a1", false), turn);
    agents.observe(subCall("a1", "Read", { file_path: "a.ts" }), turn);
    agents.observe(result("a1"), turn);
    agents.observe(finished("a1"), turn);
    expect(agents.take()).toEqual([]);
  });

  it("leaves subagents alone when the turn watches only the main thread", () => {
    const { abort, watch } = setup();
    const agents = new SubagentWatch();
    const turn = { watch: watch("main"), signal: abort.signal };
    agents.observe(launch("a1"), turn);
    agents.observe(loosen("a1"), turn);
    agents.observe(finished("a1"), turn);
    expect(agents.take()).toEqual([]);
  });
});

describe("WatchChecks", () => {
  const titled = (title: string, line: string) =>
    `learn: ${line}\ntag: Heads up\ntitle: ${title}\n- a point`;

  it("remembers the thread's notes across a restart, and doesn't repeat one reworded", async () => {
    const asked: string[] = [];
    const notes: WatchNote[] = [];
    // A fresh session's checks: nothing in memory, only the thread's saved notes.
    const checks = new WatchChecks(async (question) => {
      asked.push(question);
      return {
        reply: titled(
          "Setup reruns can't be stopped",
          "A slow rerun only ends after the timeout.",
        ),
      };
    });
    checks.enqueue({
      key: "main",
      prompt: (shown) => shown.join("\n"),
      watch: {
        scope: "main",
        known: [],
        shown: [
          "Setup reruns can't be stopped: The rerun has no Stop of its own.",
        ],
        onNote: (n) => notes.push(n),
      },
      signal: new AbortController().signal,
    });
    await checks.idle();
    expect(asked[0]).toContain("The rerun has no Stop of its own.");
    expect(notes).toHaveLength(0);
  });

  it("drops a note the answer already makes, by the quote it gives", async () => {
    const answer =
      "It isn't reachable yet: **the domain has no DNS record**. Add one in Cloudflare.";
    for (const [said, kept] of [
      ["the domain has no DNS record. Add one in Cloudflare", 0],
      ["a DNS lookup earlier came back empty", 1],
      ["never", 1],
    ] as const) {
      const notes: WatchNote[] = [];
      const checks = new WatchChecks(async () => ({
        reply: `${titled("Deploy needs a DNS record", "The deploy can't go live yet.")}\nsaid: ${said}`,
      }));
      checks.enqueue({
        key: "main",
        prompt: () => "look",
        watch: { scope: "main", known: [], onNote: (n) => notes.push(n) },
        signal: new AbortController().signal,
        answer,
      });
      await checks.idle();
      expect(notes).toHaveLength(kept);
      expect(notes[0] && "said" in notes[0]).toBeFalsy();
    }
  });

  it("takes a known topic saved with its line, or as a bare title from before", async () => {
    for (const known of [
      "Full plan is being built now: The agent is building the whole plan.",
      "Full plan is being built now",
    ]) {
      const notes: WatchNote[] = [];
      const checks = new WatchChecks(async () => ({
        reply: titled("Full plan is being built now", "Something new."),
      }));
      checks.enqueue({
        key: "main",
        prompt: () => "look",
        watch: { scope: "main", known: [known], onNote: (n) => notes.push(n) },
        signal: new AbortController().signal,
      });
      await checks.idle();
      expect(notes).toHaveLength(0);
    }
  });

  it("runs one check at a time and doesn't queue the same one twice", async () => {
    let release!: () => void;
    const ask = vi.fn(
      () =>
        new Promise<{ reply: string }>((resolve) => {
          release = () => resolve({ reply: none });
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
