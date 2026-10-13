import { afterEach, describe, expect, it, vi } from "vitest";

const api = {
  agentUpdateChecks: vi.fn(async () => true),
  saveAgentUpdateChecks: vi.fn(async (enabled: boolean) => enabled),
};
vi.mock("../../lib/api", () => ({ api }));

async function load(saved: Record<string, string>) {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved[k] ?? null,
    setItem: (k: string, v: string) => (saved[k] = v),
    removeItem: (k: string) => delete saved[k],
  });
  return (await import("./agent-updates")).agentUpdateChecksQuery.queryFn;
}

describe("agent update checks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("carries over notices turned off in 0.12.0 as checks off", async () => {
    const saved = { "relay-agent-update-notices": "off" };
    expect(await (await load(saved))()).toBe(false);
    expect(api.saveAgentUpdateChecks).toHaveBeenCalledWith(false);
    expect(saved).toEqual({});
  });

  it("reads the saved setting when notices were left on", async () => {
    api.agentUpdateChecks.mockResolvedValueOnce(false);
    const saved = { "relay-agent-update-notices": "on" };
    expect(await (await load(saved))()).toBe(false);
    expect(api.saveAgentUpdateChecks).not.toHaveBeenCalled();
    expect(saved).toEqual({});
  });

  it("keeps the old switch until it was saved", async () => {
    api.saveAgentUpdateChecks.mockRejectedValueOnce(new Error("disk full"));
    const saved = { "relay-agent-update-notices": "off" };
    await expect((await load(saved))()).rejects.toThrow("disk full");
    expect(saved).toEqual({ "relay-agent-update-notices": "off" });
  });
});
