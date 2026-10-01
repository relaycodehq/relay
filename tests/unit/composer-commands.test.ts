import { describe, expect, it } from "vitest";
import { agentProviders } from "../../shared/agents";
import {
  composerCommand,
  composerTargets,
  modelCommandOptions,
  type CommandSettings,
  type ModelCatalogs,
} from "../../shared/composer-commands";

const catalogs: ModelCatalogs = {
  codex: [
    {
      id: "gpt-6-luna",
      name: "GPT-6-Luna",
      description: "",
      efforts: ["low", "medium", "high"],
    },
  ],
  claude: [
    {
      id: "opus",
      name: "Opus",
      description: "",
      efforts: ["low", "high", "max"],
      longContext: true,
    },
  ],
  opencode: [
    {
      id: "anthropic/sonnet",
      name: "Sonnet",
      description: "",
      efforts: ["high"],
    },
  ],
};
// As the phone asks: only agents, no notes.
const phone = (
  over: Partial<CommandSettings<(typeof agentProviders)[number]>> = {},
) => ({
  recipient: "codex" as const,
  targets: agentProviders,
  model: "gpt-6-luna",
  fast: false,
  plan: false,
  catalogs,
  ...over,
});

describe("composer commands", () => {
  it("only takes a model id it could run", () => {
    expect(composerCommand("model", "not a model", phone())).toBe(
      "Enter a valid model ID.",
    );
    expect(composerCommand("model", "gpt-7-preview", phone())).toEqual({
      command: "model",
      provider: "codex",
      model: "gpt-7-preview",
    });
    expect(composerCommand("model", "default", phone())).toEqual({
      command: "model",
      provider: "codex",
      model: "",
    });
  });
  it("switches to the agent whose list has the model, by id or name", () => {
    expect(composerCommand("model", "Opus", phone())).toEqual({
      command: "model",
      provider: "claude",
      model: "opus",
    });
    expect(composerCommand("model", "opus[1m]", phone())).toEqual({
      command: "model",
      provider: "claude",
      model: "opus[1m]",
    });
    expect(composerCommand("model", "sonnet", phone())).toEqual({
      command: "model",
      provider: "opencode",
      model: "anthropic/sonnet",
    });
  });
  it("offers the recipient's models and Default before the others'", () => {
    expect(
      modelCommandOptions("claude", catalogs, { claude: "Opus" }).map(
        (o) => `${o.provider}:${o.value}`,
      ),
    ).toEqual([
      "claude:opus",
      "claude:opus[1m]",
      "claude:default",
      "codex:gpt-6-luna",
      "opencode:anthropic/sonnet",
    ]);
  });
  it("takes only the efforts the recipient's model has", () => {
    expect(composerCommand("effort", "High", phone())).toEqual({
      command: "effort",
      reasoningEffort: "high",
    });
    expect(composerCommand("effort", "ultra", phone())).toBe(
      "Choose one of: default, low, medium, high.",
    );
    expect(
      composerCommand(
        "effort",
        "max",
        phone({ recipient: "claude", model: "opus" }),
      ),
    ).toEqual({ command: "effort", reasoningEffort: "max" });
    // Codex and Claude take every level on a model they don't list.
    expect(
      composerCommand("effort", "ultra", phone({ model: "gpt-7-preview" })),
    ).toEqual({ command: "effort", reasoningEffort: "ultra" });
    // Other agents only on a listed model, so not on Default.
    expect(
      composerCommand(
        "effort",
        "high",
        phone({ recipient: "opencode", model: "" }),
      ),
    ).toBe("Choose one of: default.");
    expect(
      composerCommand(
        "effort",
        "default",
        phone({ recipient: "opencode", model: "" }),
      ),
    ).toEqual({ command: "effort", reasoningEffort: "" });
  });
  it("sends notes only where the composer offers them", () => {
    expect(composerCommand("provider", "message", phone())).toBe(
      "Choose one of: codex, claude, opencode, cursor.",
    );
    const desktop = { ...phone(), targets: composerTargets };
    expect(composerCommand("provider", "Message", desktop)).toEqual({
      command: "provider",
      provider: "message",
    });
    const note = { ...desktop, recipient: "message" as const };
    expect(composerCommand("plan", "", note)).toBe(
      "Choose an agent before changing agent settings.",
    );
    // A listed model still picks its agent.
    expect(composerCommand("model", "opus", note)).toMatchObject({
      provider: "claude",
    });
  });
  it("toggles Plan and Fast, or sets them with on and off", () => {
    expect(composerCommand("plan", "", phone({ plan: true }))).toEqual({
      command: "plan",
      plan: false,
    });
    expect(composerCommand("fast", "ON", phone({ fast: true }))).toEqual({
      command: "fast",
      fast: true,
    });
    expect(composerCommand("plan", "maybe", phone())).toBe(
      "Use /plan on or /plan off.",
    );
    expect(composerCommand("fast", "", phone({ recipient: "claude" }))).toBe(
      "Fast mode is only available for Codex.",
    );
  });
  it("finds permission modes by value or label", () => {
    expect(
      composerCommand("permissions", "Auto-accept edits", phone()),
    ).toEqual({ command: "permissions", runtimeMode: "auto-accept-edits" });
    expect(composerCommand("permissions", "yolo", phone())).toMatch(
      /^Choose one of: approval-required/,
    );
  });
});
