import { describe, expect, it } from "vitest";
import {
  defaultAISettings,
  type AISettings,
} from "../../../../shared/settings";
import type { AgentProvider } from "../../../../shared/agents";
import { reviewRowAgents } from "./review-row-agents";

const settings = (changes: Partial<AISettings>): AISettings => ({
  ...defaultAISettings,
  ...changes,
});

const runnable: AgentProvider[] = ["codex", "claude", "opencode", "cursor"];

describe("the agents a Used by Relay row offers", () => {
  it("leaves a switched-off agent out of a helper row", () => {
    const off = settings({ agentsOff: ["claude"] });
    expect(reviewRowAgents({ kind: "grouping" }, off, runnable)).not.toContain(
      "claude",
    );
    expect(reviewRowAgents({ kind: "questions" }, off, runnable)).toContain(
      "codex",
    );
  });

  it("keeps a row's own agent while it's switched off, and only that row's", () => {
    const off = settings({
      agentsOff: ["claude"],
      groupingProvider: "claude",
      questionsProvider: "codex",
    });
    expect(reviewRowAgents({ kind: "grouping" }, off, runnable)).toContain(
      "claude",
    );
    expect(reviewRowAgents({ kind: "questions" }, off, runnable)).not.toContain(
      "claude",
    );
  });

  it("offers only helpers on a helper row, any runnable agent on the others", () => {
    const all = settings({});
    expect(reviewRowAgents({ kind: "grouping" }, all, runnable)).not.toContain(
      "cursor",
    );
    expect(
      reviewRowAgents({ kind: "split", anyAgent: true }, all, runnable),
    ).toEqual(runnable);
  });

  it("follows the order set in Settings", () => {
    const ordered = settings({ agentOrder: ["opencode", "claude"] });
    expect(
      reviewRowAgents({ kind: "grouping" }, ordered, runnable).slice(0, 3),
    ).toEqual(["opencode", "claude", "codex"]);
    expect(
      reviewRowAgents(
        { kind: "commitMessage", anyAgent: true },
        ordered,
        runnable,
      ),
    ).toEqual(["opencode", "claude", "codex", "cursor"]);
  });

  it("still offers the row's agent with every other helper switched off", () => {
    const allOff = settings({
      agentsOff: ["codex", "claude", "opencode", "antigravity"],
      questionsProvider: "claude",
    });
    expect(reviewRowAgents({ kind: "questions" }, allOff, runnable)).toEqual([
      "claude",
    ]);
  });
});
