import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { agentToolsBridge } from "../../shared/remote";
import { agentToolHandlers } from "./agent-tools";
import { inspectAgentTools } from "../agents/tools";
import type { ApiContext } from "./context";
const commands = vi.fn(async () => []);

vi.mock("../agents", () => ({
  agentRuntime: () => ({ commands, knownCommands: async () => undefined }),
}));

vi.mock("../agents/tools", () => ({
  inspectAgentTools: vi.fn(async () => ({
    skills: { items: [] },
    servers: { items: [] },
    checkedAt: 1,
  })),
}));

beforeEach(() => vi.clearAllMocks());
const projectId = randomUUID();
const computerId = randomUUID();
const remoteId = randomUUID();

function setup() {
  const desktop = vi.fn(async () => ({
    skills: { items: [] },
    servers: { items: [] },
    checkedAt: 2,
  }));
  const targetOn = vi.fn(
    async (): Promise<{
      id: string;
      project?: { id: string; name: string };
      problem?: string;
    }> => ({
      id: computerId,
      project: { id: remoteId, name: "Remote project" },
    }),
  );
  const root = vi.fn(async () => "/repo");
  const ctx = {
    projects: { root },
    handoffs: () => ({
      computers: { connected: async () => ({ desktop }) },
      sender: { targetOn },
    }),
  } as unknown as ApiContext;
  return {
    handler: agentToolHandlers(ctx).agentTools,
    desktop,
    targetOn,
    root,
  };
}

it("validates arguments and resolves the selected project before local inspection, without starting the agent", async () => {
  const { handler, root } = setup();
  await handler([projectId, "codex"]);
  expect(root).toHaveBeenCalledWith(projectId);
  expect(inspectAgentTools).toHaveBeenCalledWith(
    "codex",
    "/repo",
    expect.any(Function),
  );
  const known = vi.mocked(inspectAgentTools).mock.calls[0][2];
  expect(await known()).toBeUndefined();
  expect(commands).not.toHaveBeenCalled();
  expect(() => handler(["/arbitrary/path", "codex"])).toThrow();
});

it("inspects the paired computer's matched project without falling back to local configuration", async () => {
  const { handler, desktop, root, targetOn } = setup();
  await handler([projectId, "claude", computerId]);
  expect(targetOn).toHaveBeenCalledWith(
    computerId,
    projectId,
    agentToolsBridge,
  );
  expect(desktop).toHaveBeenCalledWith("agentTools", remoteId, "claude");
  expect(root).not.toHaveBeenCalled();
  expect(inspectAgentTools).not.toHaveBeenCalled();
});

it("refuses an unmatched project or an outdated computer and propagates remote failures", async () => {
  const { handler, desktop, targetOn } = setup();
  targetOn.mockResolvedValueOnce({ id: computerId });
  await expect(handler([projectId, "codex", computerId])).rejects.toThrow(
    "could not be found",
  );
  targetOn.mockResolvedValueOnce({
    id: computerId,
    problem: "Needs a Relay update",
  });
  await expect(handler([null, "codex", computerId])).rejects.toThrow(
    "Needs a Relay update",
  );
  expect(desktop).not.toHaveBeenCalled();
  expect(inspectAgentTools).not.toHaveBeenCalled();
  targetOn.mockResolvedValueOnce({ id: computerId });
  desktop.mockRejectedValue(new Error("Offline"));
  await expect(handler([null, "codex", computerId])).rejects.toThrow("Offline");
  expect(desktop).toHaveBeenCalledWith("agentTools", null, "codex");
  expect(inspectAgentTools).not.toHaveBeenCalled();
});
