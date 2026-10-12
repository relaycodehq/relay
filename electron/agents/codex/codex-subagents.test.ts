import { expect, it, vi } from "vitest";
import type { AgentActivity } from "../../../shared/projects";
import { parseCodexNotification } from "./codex-schemas";
import { CodexSubagents } from "./codex-subagents";

const n = (method: string, params: Record<string, unknown>) =>
  parseCodexNotification(method, params)!;

const tracked = (
  read: () => Promise<unknown> = () => new Promise(() => {}),
) => {
  const rows = new Map<string, AgentActivity>();
  const interrupt = vi.fn(async () => {});
  const agents = new CodexSubagents({
    onActivity: (a) => rows.set(a.id, a),
    onFileChange() {},
    onUsage() {},
    read,
    interrupt,
  });
  return { rows, interrupt, agents };
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
