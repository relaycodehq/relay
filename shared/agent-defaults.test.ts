import { expect, it } from "vitest";
import {
  claudeAgentDefaults,
  claudeDefaultEffort,
  claudeDefaultsFrom,
  codexAgentDefaults,
  codexDefaultEffort,
} from "./agent-defaults";
import type { ClaudeModel, CodexModel } from "./settings";

const every = ["low", "medium", "high", "xhigh", "max"] as const;
const claudeModels: ClaudeModel[] = [
  ["opus", "claude-opus-5-5", "Opus 5.5"],
  ["claude-fable-5-1[1m]", "claude-fable-5-1", "Fable 5.1"],
  ["sonnet", "claude-sonnet-5", "Sonnet 5"],
].map(([id, resolved, name]) => ({
  id,
  resolved,
  name,
  description: "",
  efforts: [...every],
  longContext: true,
}));
claudeModels.push({
  id: "haiku",
  resolved: "claude-haiku-4-5-20251001",
  name: "Haiku 4.5",
  description: "",
  efforts: [],
  longContext: false,
});

it("reads what Claude runs on Default the way the CLI resolves it", () => {
  // `getSettings()` as Claude Code answered it for a user file pinning Fable.
  const defaults = claudeDefaultsFrom({
    effective: {
      model: "claude-fable-5-1[1m]",
      effortLevel: "high",
      modelSettings: {
        "claude-fable-5-1": { effortLevel: "xhigh" },
        "claude-opus-5-5": { effortLevel: "low" },
      },
      permissions: { allow: [] },
    },
    sources: [],
    applied: { model: "claude-fable-5-1", effort: "xhigh", advisor: null },
  });
  expect(claudeDefaultEffort(defaults, "", claudeModels)).toBe("xhigh");
  // A model's own level beats the file's, whatever its alias or window.
  expect(claudeDefaultEffort(defaults, "opus", claudeModels)).toBe("low");
  expect(claudeDefaultEffort(defaults, "opus[1m]", claudeModels)).toBe("low");
  expect(claudeDefaultEffort(defaults, "sonnet", claudeModels)).toBe("high");
  expect(claudeDefaultEffort(defaults, "my-model", claudeModels)).toBe("high");
  // Haiku takes no effort at all.
  expect(claudeDefaultEffort(defaults, "haiku", claudeModels)).toBe("");
  // What every agent reports: the listed id, so a picker can find its name.
  expect(claudeAgentDefaults(defaults!, claudeModels)).toEqual({
    model: "claude-fable-5-1[1m]",
    effort: "xhigh",
    efforts: {
      opus: "low",
      "claude-fable-5-1[1m]": "xhigh",
      sonnet: "high",
      haiku: "",
    },
  });
});

it("leaves Default unnamed when Claude can't say what it runs", () => {
  // A CLI without `getSettings` answers every control request alike.
  expect(claudeDefaultsFrom({ commands: [], models: [] })).toBeUndefined();
  expect(claudeDefaultsFrom(undefined)).toBeUndefined();
  expect(claudeDefaultEffort(undefined, "", claudeModels)).toBe("");
  // No level in any file leaves an explicit model's built-in one, unknown here.
  const bare = claudeDefaultsFrom({
    effective: {},
    applied: { model: "claude-opus-5-5", effort: "medium" },
  });
  expect(claudeDefaultEffort(bare, "", claudeModels)).toBe("medium");
  expect(claudeDefaultEffort(bare, "sonnet", claudeModels)).toBe("");
});

it("reads what Codex runs on Default from its config, then its models", () => {
  const codexModels: CodexModel[] = [
    {
      id: "gpt-6-sol",
      name: "GPT-6-Sol",
      description: "",
      efforts: ["low", "medium", "high"],
      legacy: false,
      defaultEffort: "medium",
      isDefault: true,
    },
    {
      id: "gpt-6-luna",
      name: "GPT-6-Luna",
      description: "",
      efforts: ["low", "high"],
      legacy: false,
      defaultEffort: "low",
    },
  ];
  const unset = { model: "", effort: "" } as const;
  expect(codexDefaultEffort(unset, "", codexModels)).toBe("medium");
  expect(codexDefaultEffort(unset, "gpt-6-luna", codexModels)).toBe("low");
  // The config's model and effort win over the list's.
  const configured = { model: "gpt-6-luna", effort: "high" } as const;
  expect(codexDefaultEffort(configured, "gpt-6-sol", codexModels)).toBe("high");
  // What every agent reports: the model that runs even when the config names none.
  expect(codexAgentDefaults(unset, codexModels)).toEqual({
    model: "gpt-6-sol",
    effort: "medium",
    efforts: { "gpt-6-sol": "medium", "gpt-6-luna": "low" },
  });
  expect(codexAgentDefaults(configured, codexModels)).toEqual({
    model: "gpt-6-luna",
    effort: "high",
    efforts: { "gpt-6-sol": "high", "gpt-6-luna": "high" },
  });
  // Without the config the list's default may not be what runs.
  expect(codexDefaultEffort(undefined, "", codexModels)).toBe("");
});
