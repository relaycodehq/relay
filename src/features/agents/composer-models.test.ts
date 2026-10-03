import { describe, expect, it } from "vitest";
import { agents, type AgentProvider } from "../../../shared/agents";
import type { ModelChoice } from "../../../shared/settings";
import {
  claudeOf,
  claudeOn,
  livePick,
  messageChoice,
  messageContext,
  newThreadModelsOf,
  readComposerModels,
  withModel,
  withNewThreadModels,
} from "./composer-models";

const choice = (
  model: string,
  reasoningEffort: ModelChoice["reasoningEffort"] = "",
  fast = false,
): ModelChoice => ({ model, reasoningEffort, fast });

describe("reading models saved in the old shapes", () => {
  it("takes Codex's choice, Claude's own and the picks into one entry per agent", () => {
    expect(
      readComposerModels({
        choice: { model: "gpt-6-sol", fast: true, reasoningEffort: "high" },
        claude: {
          model: "opus",
          reasoningEffort: "max",
          contextWindow: "200k",
        },
        picks: {
          cursor: { model: "auto", reasoningEffort: "" },
          opencode: { model: "kimi-k2", reasoningEffort: "low" },
        },
      }),
    ).toEqual({
      codex: { choice: choice("gpt-6-sol", "high", true) },
      claude: { choice: choice("opus", "max"), contextWindow: "200k" },
      cursor: { choice: choice("auto") },
      opencode: { choice: choice("kimi-k2", "low") },
    });
  });

  it("keeps what reads from entries that half do", () => {
    expect(
      readComposerModels({
        // A bad id and a level Claude doesn't take; the window is kept.
        claude: {
          model: "bad id!",
          reasoningEffort: "none",
          contextWindow: "200k",
        },
        choice: { model: "gpt-5.5", fast: false, reasoningEffort: "turbo" },
        picks: {
          gemini: { model: "x" },
          opencode: { model: "bad id!", reasoningEffort: "high" },
          cursor: "auto",
        },
      }),
    ).toEqual({
      claude: { choice: choice(""), contextWindow: "200k" },
      codex: { choice: choice("gpt-5.5") },
      opencode: { choice: choice("", "high") },
    });
  });

  it.each([null, undefined, "x", 3, [], { claude: 4, picks: [], choice: "x" }])(
    "reads %j as nothing saved",
    (saved) => {
      expect(readComposerModels(saved)).toEqual({});
    },
  );

  it("drops what an agent doesn't offer: Fast without it, a window outside Claude", () => {
    expect(
      readComposerModels({
        picks: { opencode: { model: "m", fast: true } },
        claude: { model: "opus", fast: true },
        models: {
          cursor: {
            choice: { model: "auto", fast: true, reasoningEffort: "" },
            contextWindow: "200k",
          },
        },
      }),
    ).toEqual({
      opencode: { choice: choice("m") },
      claude: { choice: choice("opus") },
      cursor: { choice: choice("auto") },
    });
  });
});

describe("reading models saved as `models`", () => {
  it("round trips what was written", () => {
    const models = {
      codex: { choice: choice("gpt-6-sol", "high", true) },
      claude: { choice: choice("opus", "max"), contextWindow: "200k" as const },
      opencode: { choice: choice("openrouter/x/y", "low") },
    };
    expect(readComposerModels(JSON.parse(JSON.stringify({ models })))).toEqual(
      models,
    );
  });

  it("prefers an agent's entry there over the old keys, and reads the old ones for the rest", () => {
    expect(
      readComposerModels({
        models: { claude: { choice: choice("sonnet", "low") } },
        claude: { model: "opus", reasoningEffort: "max" },
        choice: { model: "gpt-6-sol", fast: false, reasoningEffort: "" },
      }),
    ).toEqual({
      claude: { choice: choice("sonnet", "low") },
      codex: { choice: choice("gpt-6-sol") },
    });
  });

  it("falls back to the old key for an entry that is no entry", () => {
    expect(
      readComposerModels({
        models: { claude: "opus", codex: { choice: 7 } },
        claude: { model: "opus", reasoningEffort: "high" },
      }),
    ).toEqual({ claude: { choice: choice("opus", "high") } });
  });

  it("keeps the fields of an entry that read, and clears the ones that did not", () => {
    expect(
      readComposerModels({
        models: {
          claude: { choice: { model: "opus", reasoningEffort: "minimal" } },
          codex: {
            choice: { model: "bad id!", reasoningEffort: "high", fast: true },
          },
        },
      }),
    ).toEqual({
      claude: { choice: choice("opus") },
      codex: { choice: choice("", "high", true) },
    });
  });
});

describe("models shared with new threads and the phone", () => {
  it("fills in Default for every agent, and reads back as the same models", () => {
    const models = {
      claude: { choice: choice("opus", "max"), contextWindow: "200k" as const },
      cursor: { choice: choice("auto") },
    };
    const shared = newThreadModelsOf(models);
    expect(Object.keys(shared).sort()).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
    ]);
    expect(shared.codex).toEqual({ choice: choice("") });
    // Codex's Default follows the line-question setting again.
    expect(withNewThreadModels(models, shared)).toEqual({
      ...models,
      opencode: { choice: choice("") },
    });
  });

  it("keeps the agents it hasn't a model for", () => {
    const models = { claude: { choice: choice("opus") } };
    expect(
      withNewThreadModels(models, { cursor: { choice: choice("auto") } }),
    ).toEqual({ ...models, cursor: { choice: choice("auto") } });
  });

  it("puts only Fast and the window where the agent has them", () => {
    const swapped = withNewThreadModels(
      {},
      {
        claude: { choice: choice("opus", "", true), contextWindow: "200k" },
        opencode: { choice: choice("m", "", true), contextWindow: "200k" },
        codex: { choice: choice("gpt-6-sol", "", true) },
      },
    );
    expect(swapped.claude).toEqual({
      choice: choice("opus"),
      contextWindow: "200k",
    });
    expect(swapped.opencode).toEqual({ choice: choice("m") });
    expect(swapped.codex).toEqual({ choice: choice("gpt-6-sol", "", true) });
  });
});

describe("what a message runs on", () => {
  const models = {
    claude: { choice: choice("opus", "max"), contextWindow: "200k" as const },
    opencode: { choice: choice("kimi", "high", true) },
  };
  const codex = choice("gpt-6-sol", "high", true);
  const pick = livePick(models.opencode, [
    { id: "kimi", name: "Kimi", description: "", efforts: ["low"] },
  ]);

  it("gives every agent its own model, Fast only to one that has it", () => {
    for (const provider of ["codex", "claude", "opencode"] as AgentProvider[]) {
      const sent = messageChoice(provider, models, codex, pick);
      expect(sent?.fast).toBe(agents[provider].fast ? true : false);
    }
    expect(messageChoice("claude", models, codex, pick)).toEqual(
      choice("opus", "max"),
    );
    // Its effort is one its model no longer lists, so it runs as Default.
    expect(messageChoice("opencode", models, codex, pick)).toEqual(
      choice("kimi", "", false),
    );
    expect(messageChoice("codex", models, codex, pick)).toEqual(codex);
    expect(messageChoice("message", models, codex, pick)).toBe(codex);
  });

  it("waits for Codex's choice", () => {
    expect(messageChoice("claude", models, undefined, pick)).toBeUndefined();
  });

  it("asks for the 200k window only from Claude", () => {
    expect(messageContext("claude", models)).toEqual({ contextWindow: "200k" });
    expect(messageContext("codex", models)).toEqual({});
  });
});

it("keeps Claude on a 200k window across models, unless the model is a [1m] one", () => {
  const opus = {
    choice: choice("opus", "high"),
    contextWindow: "200k" as const,
  };
  expect(claudeOn(opus, "sonnet", "")).toEqual({
    choice: choice("sonnet"),
    contextWindow: "200k",
  });
  expect(claudeOn(opus, "sonnet[1m]", "max")).toEqual({
    choice: choice("sonnet[1m]", "max"),
  });
  expect(claudeOf(withModel({}, "claude", opus))).toEqual({
    model: "opus",
    reasoningEffort: "high",
    contextWindow: "200k",
  });
});
