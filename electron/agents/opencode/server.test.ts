import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foundSessions } from "../hosted-sessions";
import {
  markOpenCodeTurn,
  reattachOpenCodeServer,
  stopOpenCodeServer,
} from "./server";

vi.mock("../hosted-sessions", async (actual) => ({
  ...(await actual<typeof import("../hosted-sessions")>()),
  foundSessions: vi.fn(),
}));

let health: Server;
let url: string;
beforeEach(async () => {
  health = createServer((_, res) => res.end('{"version":"1.18.34"}'));
  await new Promise<void>((done) => health.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(health.address() as AddressInfo).port}`;
});
afterEach(() => {
  stopOpenCodeServer();
  health.close();
});

/** A server the agent host kept running, as a Relay restart finds it. */
function kept(meta: Record<string, unknown>, turns: string[] = []) {
  const process = { read: vi.fn(), close: vi.fn(), mark: vi.fn() };
  const found = {
    info: {
      meta: { provider: "opencode", password: "pw", url, ...meta },
      turns: Object.fromEntries(turns.map((t) => [t, {}])),
    },
    close: vi.fn(),
    attachProcess: () => process,
  };
  vi.mocked(foundSessions).mockResolvedValue([found as never]);
  return process;
}

describe("a kept OpenCode server without the worktree variables plugin", () => {
  it("stops at once when nothing runs on it", async () => {
    const process = kept({});
    await reattachOpenCodeServer(() => true);
    expect(process.close).toHaveBeenCalled();
  });

  it("stops once the turns it was running are done", async () => {
    const process = kept({}, ["a", "b"]);
    const back = await reattachOpenCodeServer(() => true);
    expect(back.map((t) => t.key)).toEqual(["a", "b"]);
    markOpenCodeTurn("a", "start");
    markOpenCodeTurn("a", "end");
    expect(process.close).not.toHaveBeenCalled();
    markOpenCodeTurn("b", "end");
    expect(process.close).toHaveBeenCalled();
  });

  it("keeps one that has the plugin", async () => {
    const process = kept({ worktreeEnv: true });
    await reattachOpenCodeServer(() => true);
    expect(process.close).not.toHaveBeenCalled();
  });
});
