import { describe, expect, it } from "vitest";
import { resolveTurnModel, turnModelLabel } from "../../shared/turn-model";
import type { AgentModel } from "../../shared/agents";

const model = (id: string, name: string): AgentModel => ({
  id,
  name,
  description: "",
  efforts: ["low", "medium", "high", "xhigh", "max"],
});
const claudeModels = [model("opus", "Opus 5.5"), model("sonnet", "Sonnet 5.5")];

describe("turn model", () => {
  it("names an explicit Claude pick with its 1M window", () => {
    const turn = resolveTurnModel(
      "claude",
      {
        choice: { model: "opus[1m]", fast: false, reasoningEffort: "high" },
        interactionMode: "plan",
      },
      claudeModels,
      null,
    );
    expect(turnModelLabel("claude", turn)).toBe(
      "Opus 5.5 · High effort · 1M context · Plan mode",
    );
  });

  it("spells out what Default ran", () => {
    const turn = resolveTurnModel(
      "claude",
      { choice: { model: "", fast: false, reasoningEffort: "" } },
      claudeModels,
      { model: "sonnet", effort: "medium", efforts: { opus: "xhigh" } },
    );
    expect(turnModelLabel("claude", turn)).toBe(
      "Sonnet 5.5 (default) · Medium effort (default)",
    );
  });

  it("takes a picked model's own default effort", () => {
    const turn = resolveTurnModel(
      "claude",
      { choice: { model: "opus", fast: false, reasoningEffort: "" } },
      claudeModels,
      { model: "sonnet", effort: "medium", efforts: { opus: "xhigh" } },
    );
    expect(turnModelLabel("claude", turn)).toBe(
      "Opus 5.5 · Extra high effort (default)",
    );
  });

  it("says Default when the agent can't tell", () => {
    const turn = resolveTurnModel(
      "codex",
      { choice: { model: "", fast: true, reasoningEffort: "" } },
      [],
      null,
    );
    expect(turnModelLabel("codex", turn)).toBe(
      "Default model · Default reasoning · Fast",
    );
  });
});
