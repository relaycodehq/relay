import { expect, it } from "vitest";
import {
  fitModel,
  listedModel,
  modelName,
  onModel,
  onWindow,
} from "./model-fit";
import { agentProviders } from "./agents";

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

// As Claude Code lists them: aliases standing for full ids, no `[1m]` rows.
const claudeList = [
  { id: "opus", name: "Opus 5.5", resolved: "claude-opus-5-5" },
  { id: "sonnet", name: "Sonnet 5.5", resolved: "claude-sonnet-5-5" },
  { id: "haiku", name: "Haiku 5.5", resolved: "claude-haiku-5-5" },
  { id: "claude-opus-4-8", name: "Opus 4.8", resolved: "claude-opus-4-8" },
];

it("names a Claude model however a thread spells it: alias, full id, either window", () => {
  for (const id of [
    "opus",
    "opus[1m]",
    "claude-opus-5-5",
    "claude-opus-5-5[1m]",
  ]) {
    expect(modelName("claude", claudeList, id)).toBe("Opus 5.5");
    expect(listedModel("claude", claudeList, id)).toBe(claudeList[0]);
  }
  expect(modelName("claude", claudeList, "sonnet[1m]")).toBe("Sonnet 5.5");
  expect(modelName("claude", claudeList, "haiku")).toBe("Haiku 5.5");
  expect(modelName("claude", claudeList, "claude-opus-4-8[1m]")).toBe(
    "Opus 4.8",
  );
  // Unlisted ones show their id, as on the desktop.
  expect(modelName("claude", claudeList, "my-proxy-model")).toBe(
    "my-proxy-model",
  );
  expect(modelName("claude", undefined, "opus[1m]")).toBe("opus[1m]");
});

it("prefers a listed 1M row to its 200k sibling, and keeps other agents' ids exact", () => {
  const both = [
    { id: "sonnet", name: "Sonnet" },
    { id: "sonnet[1m]", name: "Sonnet (1M)" },
  ];
  expect(modelName("claude", both, "sonnet[1m]")).toBe("Sonnet (1M)");
  expect(modelName("claude", both, "sonnet")).toBe("Sonnet");
  for (const list of [both, [...both].reverse()]) {
    expect(listedModel("claude", list, "sonnet[1m]")?.id).toBe("sonnet[1m]");
    expect(listedModel("claude", list, "sonnet")?.id).toBe("sonnet");
  }
  for (const provider of agentProviders.filter((p) => p !== "claude")) {
    const models = [
      { id: "vendor/model[1m]", name: "Model", resolved: "vendor/model" },
    ];
    expect(listedModel(provider, models, "vendor/model")).toBeUndefined();
    expect(modelName(provider, models, "vendor/model[1m]")).toBe("Model");
  }
  expect(listedModel("claude", claudeList, "opus[other]")).toBeUndefined();
  expect(listedModel("claude", claudeList, "opus[1m]-custom")).toBeUndefined();
});

it("keeps an explicit full id ahead of an alias resolving to it", () => {
  const explicit = { id: "claude-opus-5-5", name: "Explicit Opus" };
  const list = [...claudeList, explicit];
  expect(listedModel("claude", list, explicit.id)).toBe(explicit);
  expect(listedModel("claude", list, `${explicit.id}[1m]`)).toBe(explicit);
  expect(listedModel("claude", list, "sonnet[1m]")).toBe(claudeList[1]);
});

it("switches Claude's window the way the desktop's control does", () => {
  const on1m = { choice: choice("opus[1m]", false) };
  expect(onWindow(on1m, "200k")).toEqual({
    choice: choice("opus", false),
    contextWindow: "200k",
  });
  expect(
    onWindow({ choice: choice("opus", false), contextWindow: "200k" }, "1m"),
  ).toEqual(on1m);
  // Default stays Default, on Claude's own window.
  expect(onWindow({ choice: choice(""), contextWindow: "200k" }, "1m")).toEqual(
    { choice: choice("") },
  );
});
