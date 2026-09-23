import { describe, expect, it } from "vitest";
import {
  claudeContextWindow,
  claudeEfforts,
  claudeEffortsFor,
  findClaudeModel,
  withClaudeContextWindow,
  type ClaudeModel,
} from "../../shared/settings";

const model = (id: string): ClaudeModel => ({
  id,
  name: id,
  description: "",
  efforts: [],
  longContext: true,
});

describe("Claude context window", () => {
  it("reads and switches the [1m] suffix", () => {
    expect(claudeContextWindow("opus")).toBe("200k");
    expect(claudeContextWindow("claude-fable-5-1[1m]")).toBe("1m");
    expect(withClaudeContextWindow("opus", "1m")).toBe("opus[1m]");
    expect(withClaudeContextWindow("opus[1m]", "1m")).toBe("opus[1m]");
    expect(withClaudeContextWindow("claude-fable-5-1[1m]", "200k")).toBe(
      "claude-fable-5-1",
    );
  });
  it("finds the listed model for either window", () => {
    const models = [model("opus"), model("claude-fable-5-1[1m]")];
    expect(findClaudeModel(models, "opus[1m]")?.id).toBe("opus");
    expect(findClaudeModel(models, "claude-fable-5-1")?.id).toBe(
      "claude-fable-5-1[1m]",
    );
    expect(findClaudeModel(models, "")).toBeUndefined();
  });
  it("offers a 1M model the efforts of the model it runs", () => {
    // As the CLI lists it: no Extra high.
    const sonnet = {
      ...model("claude-sonnet-4-6"),
      efforts: ["low", "medium", "high", "max"] as ClaudeModel["efforts"],
    };
    expect(claudeEffortsFor([sonnet], "claude-sonnet-4-6[1m]")).toEqual(
      sonnet.efforts,
    );
    expect(claudeEffortsFor([sonnet], "my-model")).toEqual(claudeEfforts);
    expect(claudeEffortsFor(undefined, "opus")).toEqual(claudeEfforts);
  });
});
