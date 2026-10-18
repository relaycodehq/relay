import { describe, expect, it } from "vitest";
import { inAgentOrder, offeredAgents } from "./agent-prefs";
import type { AgentProvider } from "./agents";

describe("agent prefs", () => {
  const all = ["codex", "claude", "opencode", "cursor"] as const;

  it("puts placed agents first and the rest after, in Relay's order", () => {
    expect(inAgentOrder(all, ["cursor", "claude"])).toEqual([
      "cursor",
      "claude",
      "codex",
      "opencode",
    ]);
  });

  it("ignores agents that aren't here any more and repeats", () => {
    expect(inAgentOrder(all, ["acp:goose", "claude", "claude"])).toEqual([
      "claude",
      "codex",
      "opencode",
      "cursor",
    ]);
  });

  it("leaves switched-off agents out unless one is kept", () => {
    const prefs = {
      agentOrder: ["opencode"] as AgentProvider[],
      agentsOff: ["codex", "cursor"] as AgentProvider[],
    };
    expect(offeredAgents(all, prefs)).toEqual(["opencode", "claude"]);
    expect(offeredAgents(all, prefs, ["cursor"])).toEqual([
      "opencode",
      "claude",
      "cursor",
    ]);
  });
});
