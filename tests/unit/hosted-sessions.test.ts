import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedChild } from "../../electron/agent-host/child";
import type {
  AgentHosts,
  FoundSession,
  HostedProcess,
} from "../../electron/agent-host/client";
import type { SessionInfo } from "../../electron/agent-host/protocol";
import {
  hostAgents,
  HostedSessions,
} from "../../electron/agents/hosted-sessions";
import { AsyncQueue } from "../../electron/async-queue";

afterEach(() => {
  hostAgents(undefined);
  vi.restoreAllMocks();
});

describe("AsyncQueue", () => {
  it("still hands out what's queued once it ended, and nothing once it closed", async () => {
    const ended = new AsyncQueue<number>();
    ended.push(1);
    ended.end();
    // A frame a finished turn left behind goes back for whatever comes next.
    ended.push(2);
    const read: number[] = [];
    for await (const n of ended) read.push(n);
    expect(read).toEqual([1, 2]);

    const closed = new AsyncQueue<number>();
    closed.push(1);
    closed.close();
    closed.push(2);
    expect(await closed.next()).toBeUndefined();
  });

  it("wakes every reader waiting on it", async () => {
    const queue = new AsyncQueue<string>();
    const waited = queue.wait(10_000);
    const next = queue.next();
    queue.push("frame");
    expect(await waited).toBe(true);
    expect(await next).toBe("frame");
    expect(await queue.wait(5)).toBe(false);
  });
});

type Fake = { busy: boolean; closed: boolean; id: number; close(): void };
function pool() {
  let made = 0;
  const sessions = new HostedSessions<Fake>({
    provider: "codex",
    name: "Codex",
    kind: "process",
    close: (session) => session.close(),
  });
  const start = async () => {
    const session: Fake = {
      busy: false,
      closed: false,
      id: ++made,
      close: () => void (session.closed = true),
    };
    return session;
  };
  return { sessions, start };
}

describe("HostedSessions", () => {
  it("hands a thread's session to one turn at a time, and starts another once it closed", async () => {
    const { sessions, start } = pool();
    const first = await sessions.acquire("thread", start);
    await expect(sessions.acquire("thread", start)).rejects.toThrow(
      "This Codex session is already running a turn.",
    );
    first.busy = false;
    expect(await sessions.acquire("thread", start)).toBe(first);
    first.busy = false;
    first.closed = true;
    const second = await sessions.acquire("thread", start);
    expect(second.id).toBe(2);
    expect(sessions.get("thread")).toBe(second);
    // Without a key, each turn's session is its own and nobody keeps it.
    expect((await sessions.acquire(undefined, start)).id).toBe(3);
    expect([...sessions.values()]).toEqual([second]);
  });

  it("refuses a second turn while the first one's session is still starting", async () => {
    const { sessions, start } = pool();
    let release!: () => void;
    const slow = vi.fn(async () => {
      await new Promise<void>((r) => (release = r));
      return start();
    });
    const first = sessions.acquire("thread", slow);
    await expect(sessions.acquire("thread", slow)).rejects.toThrow(
      "already running a turn",
    );
    release();
    expect((await first).busy).toBe(true);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("ends a session closed while it was starting", async () => {
    const { sessions, start } = pool();
    let release!: () => void;
    let started: Fake | undefined;
    const acquired = sessions.acquire("thread", async () => {
      await new Promise<void>((r) => (release = r));
      return (started = await start());
    });
    await sessions.close("thread");
    release();
    await expect(acquired).rejects.toThrow("was closed");
    expect(started?.closed).toBe(true);
    expect(sessions.get("thread")).toBeUndefined();
  });

  it("runs a thread's process in the host, and in Relay without a key or a working host", async () => {
    const { sessions } = pool();
    const local = vi.fn(() => ({ local: true }) as never);
    const spec = { command: "x", args: [], cwd: "/", env: {}, group: false };
    expect(await sessions.spawn("thread", {}, spec, local)).toEqual({
      local: true,
    });

    const running = {
      read: () => {},
      write: () => {},
      close: () => {},
    } as unknown as HostedProcess;
    const openProcess = vi.fn(async () => running);
    hostAgents({ openProcess } as unknown as AgentHosts);
    const hosted = await sessions.spawn(
      "thread",
      { provider: "codex" },
      spec,
      local,
    );
    expect(hosted).toBeInstanceOf(HostedChild);
    expect(openProcess).toHaveBeenCalledWith({
      key: "thread",
      meta: { provider: "codex" },
      process: spec,
    });
    await sessions.spawn(undefined, {}, spec, local);
    expect(openProcess).toHaveBeenCalledTimes(1);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openProcess.mockRejectedValueOnce(new Error("Relay is closing."));
    expect(await sessions.spawn("thread", {}, spec, local)).toEqual({
      local: true,
    });
    expect(warn).toHaveBeenCalledWith(
      "The agent host is unavailable; Codex runs in Relay:",
      expect.any(Error),
    );
    expect(local).toHaveBeenCalledTimes(3);
  });

  it("takes back only its own agent's sessions, and ends those nobody can use", async () => {
    const { sessions, start } = pool();
    const found = (key: string, info: Partial<SessionInfo>) => {
      const session = {
        info: { id: key, key, split: 0, open: false, meta: undefined, ...info },
        close: vi.fn(),
      };
      return session as unknown as FoundSession & {
        close: typeof session.close;
      };
    };
    const kept = found("kept", {
      kind: "process",
      meta: { provider: "codex", started: 1 },
      open: true,
    });
    const notOurs = found("gone", {
      kind: "process",
      meta: { provider: "codex", started: 1 },
    });
    const unusable = found("blank", {
      kind: "process",
      meta: { provider: "codex" },
    });
    const busy = found("busy", {
      kind: "process",
      meta: { provider: "codex", started: 1 },
    });
    const twice = found("kept", {
      kind: "process",
      meta: { provider: "codex", started: 1 },
    });
    const cursor = found("other", {
      kind: "process",
      meta: { provider: "cursor" },
    });
    const claude = found("claude", { meta: { options: {} } });
    hostAgents({
      discover: async () => [
        kept,
        notOurs,
        unusable,
        busy,
        twice,
        cursor,
        claude,
      ],
    } as unknown as AgentHosts);
    const live = await sessions.acquire("busy", start);

    const back = await sessions.reattach(
      (key) => key !== "gone",
      (session) =>
        (session.info.meta as { started?: number }).started
          ? ({ busy: false, closed: false, id: 9, close() {} } as Fake)
          : undefined,
    );
    expect(back).toEqual([{ key: "kept", open: true }]);
    expect(sessions.get("kept")?.id).toBe(9);
    expect(sessions.get("busy")).toBe(live);
    for (const ended of [notOurs, unusable, busy, twice])
      expect(ended.close).toHaveBeenCalled();
    // Other agents take theirs back themselves.
    for (const left of [kept, cursor, claude])
      expect(left.close).not.toHaveBeenCalled();
  });
});
