import { expect, it } from "vitest";
import { fitModel, onModel } from "./model-fit";

const choice = (model: string, fast = true) => ({
  model,
  reasoningEffort: "high" as const,
  fast,
});

it("keeps Fast only where the agent has it, and the 200k window only for Claude without 1M built in", () => {
  expect(
    fitModel("codex", { choice: choice("gpt"), contextWindow: "200k" }),
  ).toEqual({ choice: choice("gpt") });
  expect(
    fitModel("claude", { choice: choice("opus"), contextWindow: "200k" }),
  ).toEqual({ choice: choice("opus", false), contextWindow: "200k" });
  expect(
    fitModel("claude", { choice: choice("opus[1m]"), contextWindow: "200k" }),
  ).toEqual({ choice: choice("opus[1m]", false) });
});

it("moves to a model keeping the effort only if the model takes it", () => {
  expect(onModel("codex", choice("a"), "b", ["low", "high"])).toEqual(
    choice("b"),
  );
  expect(onModel("cursor", choice("a"), "b", ["low"])).toEqual({
    model: "b",
    reasoningEffort: "",
    fast: false,
  });
});
