import { expect, it, vi } from "vitest";
import type { AgentActivity } from "../../../shared/projects";
import { parseCodexNotification } from "./codex-schemas";
import { CodexSubagents } from "./codex-subagents";
import { SubagentBook } from "../subagent-book";

const n = (method: string, params: Record<string, unknown>) =>
  parseCodexNotification(method, params)!;

const tracked = (
  read: () => Promise<unknown> = () => new Promise(() => {}),
) => {
  const rows = new Map<string, AgentActivity>();
  const interrupt = vi.fn(async () => {});
  const book = new SubagentBook();
  const agents = new CodexSubagents({
    book,
    onActivity: (a) => rows.set(a.id, a),
    onFileChange() {},
    onUsage() {},
    read,
    interrupt,
  });
  return { rows, interrupt, agents, book };
};

it("names a subagent no spawn item announced by the task its thread was given", async () => {
  // Multi-agent v1 shows no item on the parent: the child's thread says what it was asked.
  const { rows, agents } = tracked(async () => ({
    thread: {
      preview: "Run `cat a.txt`, then reply DONE.\nMore detail.",
      agentNickname: "Euler",
    },
  }));
  agents.notification(
    n("turn/started", {
      threadId: "child",
      turn: { id: "ct", rootTurnId: "turn" },
    }),
    "turn",
  );
  expect(rows.get("agent:child")?.label).toBe("Subagent");
  await vi.waitFor(() =>
    expect(rows.get("agent:child")?.label).toBe(
      "Run cat a.txt, then reply DONE.",
    ),
  );
});

it("stops subagents still working when the run ends, and hears nothing from them after", async () => {
  const { rows, interrupt, agents } = tracked();
  agents.notification(
    n("turn/started", {
      threadId: "child",
      turn: { id: "ct", rootTurnId: "turn" },
    }),
    "turn",
  );
  agents.notification(
    n("item/started", {
      threadId: "child",
      item: { id: "cmd", type: "commandExecution", command: "sleep 40" },
    }),
    "turn",
  );
  expect(rows.get("agent:child")).toMatchObject({
    status: "running",
    progress: "1 tool",
  });
  await agents.stop();
  expect(interrupt).toHaveBeenCalledWith("child", "ct");
  expect(rows.get("agent:child")?.status).toBe("stopped");
  expect(rows.get("agent:child")).not.toHaveProperty("progress");
  agents.notification(
    n("turn/completed", {
      threadId: "child",
      turn: { id: "ct", status: "completed" },
    }),
    "turn",
  );
  expect(rows.get("agent:child")?.status).toBe("stopped");
});

it("keeps each subagent for the side thread, where Stop interrupts that one alone", async () => {
  const { interrupt, agents, book } = tracked(async () => ({
    thread: { preview: "Count the files in src.", model: "gpt-6-luna" },
  }));
  const say = (threadId: string, method: string, params: object) =>
    agents.notification(n(method, { threadId, ...params }), "turn");
  for (const child of ["a", "b"])
    say(child, "turn/started", {
      turn: { id: `t${child}`, rootTurnId: "turn" },
    });
  say("a", "item/completed", {
    item: {
      id: "ls",
      type: "commandExecution",
      command: "ls src",
      status: "completed",
    },
  });
  await vi.waitFor(() =>
    expect(book.detail("agent:a")).toMatchObject({
      description: "Count the files in src.",
      brief: "Count the files in src.",
      model: "gpt-6-luna",
      status: "running",
      calls: 1,
      trace: [{ kind: "activity", activity: { label: "ls src" } }],
    }),
  );
  await book.stop("agent:a");
  expect(interrupt).toHaveBeenCalledWith("a", "ta");
  expect(interrupt).toHaveBeenCalledTimes(1);
  say("b", "item/completed", {
    item: {
      id: "said",
      type: "agentMessage",
      phase: "final_answer",
      text: "12 files.",
    },
  });
  say("b", "turn/completed", { turn: { id: "tb", status: "completed" } });
  expect(book.list().map((r) => [r.id, r.status])).toEqual([
    ["agent:a", "stopped"],
    ["agent:b", "completed"],
  ]);
  // Its last word is the report, not repeated in its run.
  expect(book.detail("agent:b")).toMatchObject({
    report: "12 files.",
    trace: [],
  });
});
