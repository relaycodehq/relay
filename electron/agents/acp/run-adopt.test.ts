import { afterEach, expect, it, vi } from "vitest";
import type { AgentOptions } from "../types";
import type { AcpProfile } from "./profiles";
import { runAcp } from "./run";
import { acquireTurnAgent, type AcpAgent } from "./sessions";

vi.mock("./sessions", () => ({ acquireTurnAgent: vi.fn() }));

afterEach(() => vi.useRealTimers());

/** A process the agent host kept in a turn, which never answers a cancel. */
function keptAgent() {
  const connection = {
    mark: vi.fn(),
    listen: vi.fn(),
    unlisten: vi.fn(),
    resume: vi.fn(),
    dropOrphans: vi.fn(),
    notify: vi.fn(),
    wait: () => new Promise(() => {}),
  };
  return {
    connection,
    inflight: { id: 7 },
    session: { id: "session-1", settings: {} },
    settle: vi.fn(),
  } as unknown as AcpAgent;
}

it("stops waiting on a picked-up turn stopped while its native events were caught up", async () => {
  vi.useFakeTimers();
  const agent = keptAgent();
  vi.mocked(acquireTurnAgent).mockResolvedValue(agent);
  const stop = new AbortController();
  const profile = { provider: "opencode", name: "OpenCode" } as AcpProfile;
  const options = {
    job: { kind: "adopt" },
    cwd: "/tmp",
    prompt: "",
    choice: { model: "", reasoningEffort: "", fast: false },
    signal: stop.signal,
    onText: () => {},
    session: { key: "thread", id: "session-1", onId: async () => {} },
  } as unknown as AgentOptions;

  const running = runAcp(profile, options, async () => {
    stop.abort();
    return { settle: async () => {} };
  });
  void running.catch(() => {});
  await vi.advanceTimersByTimeAsync(5_000);

  await expect(running).rejects.toThrow("Cancelled by you.");
  expect(agent.connection.notify).toHaveBeenCalledWith("session/cancel", {
    sessionId: "session-1",
  });
});
