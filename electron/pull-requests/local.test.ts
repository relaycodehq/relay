import { describe, expect, it, vi } from "vitest";
import { claudeQuestionArgs } from "./local";

vi.mock("electron", () => ({ shell: {} }));

describe("Claude question session arguments", () => {
  it("ends the tool list so the prompt after it stays the prompt", () => {
    const args = claudeQuestionArgs({
      model: "",
      fast: false,
      reasoningEffort: "",
    });
    expect(args).toEqual([
      "--disallowedTools",
      "Edit,Write,NotebookEdit",
      "--",
    ]);
  });

  it("passes a picked model and effort before the tool list", () => {
    const args = claudeQuestionArgs({
      model: "claude-opus-4-5",
      fast: false,
      reasoningEffort: "high",
    });
    expect(args).toEqual([
      "--model",
      "claude-opus-4-5",
      "--effort",
      "high",
      "--disallowedTools",
      "Edit,Write,NotebookEdit",
      "--",
    ]);
  });
});
