import { beforeEach, describe, expect, it, vi } from "vitest";

const closed: string[] = [];
const pending = new Map<string, unknown[]>();
vi.mock("../agents", () => ({
  everyAgentRuntime: () => [
    { closeSession: async (key: string) => void closed.push(key) },
  ],
}));
vi.mock("../agents/claude/project", () => ({
  claudePending: (key: string) => pending.get(key) ?? [],
  onClaudePending: () => () => {},
  claudeAgentRun: () => undefined,
  claudeAgents: () => [],
  readClaudeContext: async () => null,
  stopClaudeAgent: async () => {},
}));

const { IDLE_CLOSE, ProviderSessions } = await import("./sessions");

describe("closing idle sessions", () => {
  const busy = new Set<string>();
  let sessions: InstanceType<typeof ProviderSessions>;
  const t0 = Date.now();

  beforeEach(() => {
    closed.length = 0;
    pending.clear();
    busy.clear();
    sessions?.stopListening();
    sessions = new ProviderSessions(
      "/data",
      () => {},
      (id) => busy.has(id),
    );
  });

  it("ends a session only once it has sat unused for the limit", () => {
    const key = sessions.key("a");
    sessions.add(key);
    sessions.closeIdle(t0 + IDLE_CLOSE - 60_000);
    expect(closed).toEqual([]);
    sessions.closeIdle(t0 + IDLE_CLOSE + 1000);
    expect(closed).toEqual([key]);
    expect(sessions.of("a")).toEqual([]);
  });

  it("restarts the clock for a thread at work, however long its turn ran", () => {
    const key = sessions.key("a");
    sessions.add(key);
    busy.add("a");
    sessions.closeIdle(t0 + 3 * IDLE_CLOSE);
    busy.delete("a");
    sessions.closeIdle(t0 + 3 * IDLE_CLOSE + 60_000);
    expect(closed).toEqual([]);
    sessions.closeIdle(t0 + 4 * IDLE_CLOSE + 1000);
    expect(closed).toEqual([key]);
  });

  it("keeps a session with background work or a wake-up, and a side thread's beside it", () => {
    const main = sessions.key("a");
    const side = sessions.key("a", "root");
    sessions.add(main);
    sessions.add(side);
    pending.set(side, [{ kind: "wakeup" }]);
    sessions.closeIdle(t0 + 2 * IDLE_CLOSE);
    expect(closed).toEqual([main]);
    expect(sessions.of("a")).toEqual([side]);
  });

  it("keeps a session whose cut-off turn is still being picked back up", () => {
    const key = sessions.key("a");
    sessions.reattached(key, true);
    sessions.closeIdle(t0 + 2 * IDLE_CLOSE);
    expect(closed).toEqual([]);
    sessions.resumed(key);
    sessions.closeIdle(t0 + 3 * IDLE_CLOSE + 1000);
    expect(closed).toEqual([key]);
  });
});
