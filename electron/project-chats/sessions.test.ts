import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SubagentDetail } from "../../shared/subagents";

// One agent whose live session holds subagents until the session closes.
const live = new Map<string, SubagentDetail[]>();

const source = (key: string) => {
  const runs = live.get(key);
  return (
    runs && {
      list: () => runs.map(({ trace: _, report: __, ...run }) => run),
      detail: (id: string) => runs.find((run) => run.id === id),
      stop: async () => {},
    }
  );
};

const runtime = {
  closeSession: async (key: string) => void live.delete(key),
  subagents: source,
  contextReport: vi.fn(async () => null),
};

const claudeContextReport = vi.fn(async () => null);

vi.mock("../agents", () => ({
  agentRuntime: (provider: string) =>
    provider === "codex" ? runtime : { contextReport: claudeContextReport },
  agentRuntimes: () => [["codex", runtime]],
  everyAgentRuntime: () => [runtime],
}));

vi.mock("../agents/claude/project", () => ({
  claudePending: () => [],
  onClaudePending: () => () => {},
  readClaudeContext: async () => null,
}));

const { ProviderSessions } = await import("./sessions");

const run = (id: string, status: SubagentDetail["status"]): SubagentDetail => ({
  id,
  description: `Agent ${id}`,
  status,
  started: 1,
  calls: 1,
  recent: [],
  trace: [
    {
      kind: "activity",
      id: "c",
      activity: { id: "c", kind: "command", label: "ls", status: "complete" },
    },
  ],
  ...(status === "completed" ? { report: "Found it." } : {}),
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-sessions-"));
  live.clear();
});

afterEach(() => rm(dir, { recursive: true, force: true }));

it("counts the selected provider and side session only, without reopening a closed session", async () => {
  const sessions = new ProviderSessions(dir, () => {});
  const usage = { usedTokens: 100, maxTokens: 200 };
  const key = sessions.key("chat", "side");
  try {
    expect(
      await sessions.contextReport("chat", "codex", usage, "side"),
    ).toBeNull();
    expect(runtime.contextReport).not.toHaveBeenCalled();
    sessions.add(key);
    await sessions.contextReport("chat", "codex", usage, "side");
    expect(runtime.contextReport).toHaveBeenCalledExactlyOnceWith(key, usage);
    expect(claudeContextReport).not.toHaveBeenCalled();
    await sessions.contextReport("chat", "claude", usage, "side");
    expect(claudeContextReport).toHaveBeenCalledExactlyOnceWith(key, usage);
    expect(await sessions.contextReport("chat", "codex", usage)).toBeNull();
    expect(runtime.contextReport).toHaveBeenCalledTimes(1);
  } finally {
    sessions.stopListening();
  }
});

it("keeps a thread's subagents past the session that followed them, and past a restart", async () => {
  const sessions = new ProviderSessions(dir, () => {});
  const key = sessions.key("chat");
  sessions.add(key);
  live.set(key, [run("done", "completed"), run("busy", "running")]);
  await sessions.keepSubagents("chat");
  // The session ends, as on a restart; a new Relay reads what was kept.
  sessions.close("chat");
  sessions.stopListening();
  const restarted = new ProviderSessions(dir, () => {});
  expect(
    (await restarted.subagents("chat")).map((r) => [
      r.id,
      r.status,
      r.provider,
    ]),
  ).toEqual([
    ["done", "completed", "codex"],
    // Nobody follows it any more: it ended when it was last seen.
    ["busy", "stopped", "codex"],
  ]);
  expect(await restarted.subagentRun("chat", "done")).toMatchObject({
    report: "Found it.",
    trace: [{ id: "c" }],
  });
  await expect(restarted.stopSubagent("chat", "busy")).rejects.toThrow(
    /already finished/,
  );
  restarted.stopListening();
});

it("reads a live session's runs over what was kept of them", async () => {
  const sessions = new ProviderSessions(dir, () => {});
  const key = sessions.key("chat");
  sessions.add(key);
  live.set(key, [run("a", "running")]);
  await sessions.keepSubagents("chat");
  live.set(key, [run("a", "completed")]);
  expect((await sessions.subagents("chat")).map((r) => r.status)).toEqual([
    "completed",
  ]);
  sessions.stopListening();
});
