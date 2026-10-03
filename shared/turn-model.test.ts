import { describe, expect, it } from "vitest";
import { resolveTurnModel, turnModelLabel } from "./turn-model";
import type { AgentModel } from "./agents";

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
    expect(turn).toEqual({
      name: "Opus 5.5",
      effort: "high",
      window: "1M",
      plan: true,
    });
    expect(turnModelLabel(turn)).toBe("Opus 5.5 High");
  });

  it("resolves what Default ran", () => {
    const turn = resolveTurnModel(
      "claude",
      { choice: { model: "", fast: false, reasoningEffort: "" } },
      claudeModels,
      { model: "sonnet", effort: "medium", efforts: { opus: "xhigh" } },
    );
    expect(turn).toEqual({
      name: "Sonnet 5.5",
      byDefault: true,
      effort: "medium",
      effortByDefault: true,
    });
    expect(turnModelLabel(turn)).toBe("Sonnet 5.5 Medium");
  });

  it("takes a picked model's own default effort", () => {
    const turn = resolveTurnModel(
      "claude",
      { choice: { model: "opus", fast: false, reasoningEffort: "" } },
      claudeModels,
      { model: "sonnet", effort: "medium", efforts: { opus: "xhigh" } },
    );
    expect(turnModelLabel(turn)).toBe("Opus 5.5 Extra high");
  });

  it("leaves the label empty when the agent can't tell", () => {
    const turn = resolveTurnModel(
      "codex",
      { choice: { model: "", fast: true, reasoningEffort: "" } },
      [],
      null,
    );
    expect(turn).toMatchObject({ name: "", effort: "", fast: true });
    expect(turnModelLabel(turn)).toBe("");
  });
});
