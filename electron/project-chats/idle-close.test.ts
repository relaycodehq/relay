import { beforeEach, describe, expect, it, vi } from "vitest";

const closed: string[] = [];
const pending = new Map<string, unknown[]>();

vi.mock("../agents", () => ({
  agentRuntimes: () => [],
  everyAgentRuntime: () => [
    { closeSession: async (key: string) => void closed.push(key) },
  ],
}));

vi.mock("../agents/claude/project", () => ({
  claudePending: (key: string) => pending.get(key) ?? [],
  onClaudePending: () => () => {},
  readClaudeContext: async () => null,
}));

const { IDLE_CLOSE, IDLE_KEEP, IDLE_KEEP_MIN, ProviderSessions } =
  await import("./sessions");

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

  it("ends the oldest unused sessions past the few it keeps warm, once they've sat a while", () => {
    vi.useFakeTimers({ now: t0 });
    const keys = Array.from({ length: IDLE_KEEP + 2 }, (_, i) => {
      vi.setSystemTime(t0 + i * 1000);
      const key = sessions.key(`t${i}`);
      sessions.add(key);
      return key;
    });
    vi.useRealTimers();
    sessions.closeIdle(t0 + IDLE_KEEP_MIN - 60_000);
    expect(closed).toEqual([]);
    sessions.closeIdle(t0 + IDLE_KEEP_MIN + 10_000);
    expect(closed.toSorted()).toEqual(keys.slice(0, 2).toSorted());
    expect(sessions.of(`t${IDLE_KEEP + 1}`)).toEqual([keys.at(-1)]);
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
