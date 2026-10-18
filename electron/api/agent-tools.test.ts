import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { agentToolHandlers } from "./agent-tools";
import { inspectAgentTools } from "../agents/tools";
import type { ApiContext } from "./context";
vi.mock("../agents", () => ({
  agentRuntime: () => ({ commands: async () => [] }),
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
  const startTargets = vi.fn(async () => [
    { id: computerId, project: { id: remoteId, name: "Remote project" } },
  ]);
  const root = vi.fn(async () => "/repo");
  const ctx = {
    projects: { root },
    handoffs: () => ({
      computers: { connected: async () => ({ desktop }) },
      sender: { startTargets },
    }),
  } as unknown as ApiContext;
  return {
    handler: agentToolHandlers(ctx).agentTools,
    desktop,
    startTargets,
    root,
  };
}
it("validates arguments and resolves the selected project before local inspection", async () => {
  const { handler, root } = setup();
  await handler([projectId, "codex"]);
  expect(root).toHaveBeenCalledWith(projectId);
  expect(inspectAgentTools).toHaveBeenCalledWith(
    "codex",
    "/repo",
    expect.any(Function),
  );
  expect(() => handler(["/arbitrary/path", "codex"])).toThrow();
});
it("inspects the paired computer's matched project without falling back to local configuration", async () => {
  const { handler, desktop, root } = setup();
  await handler([projectId, "claude", computerId]);
  expect(desktop).toHaveBeenCalledWith("agentTools", remoteId, "claude");
  expect(root).not.toHaveBeenCalled();
  expect(inspectAgentTools).not.toHaveBeenCalled();
});
it("refuses an unmatched project and propagates remote failures", async () => {
  const { handler, desktop, startTargets } = setup();
  startTargets.mockResolvedValue([]);
  await expect(handler([projectId, "codex", computerId])).rejects.toThrow(
    "could not be found",
  );
  expect(desktop).not.toHaveBeenCalled();
  expect(inspectAgentTools).not.toHaveBeenCalled();
  desktop.mockRejectedValue(new Error("Offline"));
  await expect(handler([null, "codex", computerId])).rejects.toThrow("Offline");
  expect(inspectAgentTools).not.toHaveBeenCalled();
});
