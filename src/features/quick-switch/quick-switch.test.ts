import { describe, expect, it } from "vitest";
import {
  parseQuickSwitch,
  presetIndex,
  stepPreset,
  quickItems,
  type QuickPreset,
} from "./quick-switch";

const preset = (
  id: string,
  provider: QuickPreset["provider"],
  model: string,
  reasoningEffort: QuickPreset["reasoningEffort"],
  fast = false,
): QuickPreset => ({ id, provider, model, reasoningEffort, fast });

const presets = [
  preset("a", "claude", "claude-opus-5-5", "high"),
  preset("b", "claude", "claude-opus-5-5", "max"),
  preset("c", "codex", "gpt-6-astra", "xhigh", true),
  preset("d", "codex", "gpt-6-astra", "xhigh"),
];
const run = (p: QuickPreset) => ({ ...p });

it("names Claude alias presets without rewriting their model or window", () => {
  const picks = [
    preset("alias", "claude", "opus[1m]", "max"),
    preset("full", "claude", "claude-opus-5-5[1m]", "high"),
  ];
  const before = structuredClone(picks);
  expect(
    quickItems(picks, () => [
      { id: "opus", name: "Opus 5.5", resolved: "claude-opus-5-5" },
    ]).map((p) => p.name),
  ).toEqual(["Opus 5.5", "Opus 5.5"]);
  expect(picks).toEqual(before);
});

describe("presetIndex", () => {
  it("finds the exact preset, telling Codex's Fast apart", () => {
    expect(presetIndex(presets, run(presets[1]))).toBe(1);
    expect(presetIndex(presets, run(presets[3]))).toBe(3);
  });
  it("keeps the last stepped-to preset when its effort fell back to default", () => {
    const fellBack = { ...run(presets[1]), reasoningEffort: "" as const };
    expect(presetIndex(presets, fellBack, 1)).toBe(1);
    // Without that, the first preset of the model.
    expect(presetIndex(presets, fellBack)).toBe(0);
  });
  it("ignores a last preset the composer has moved away from", () => {
    const elsewhere = {
      provider: "opencode" as const,
      model: "kimi-k2",
      reasoningEffort: "" as const,
      fast: false,
    };
    expect(presetIndex(presets, elsewhere, 2)).toBe(-1);
  });
});

describe("stepPreset", () => {
  it("steps and stops at the ends", () => {
    expect(stepPreset(4, 1, 1)).toBe(2);
    expect(stepPreset(4, 3, 1)).toBe(3);
    expect(stepPreset(4, 0, -1)).toBe(0);
  });
  it("enters the list from its near end when off it", () => {
    expect(stepPreset(4, -1, 1)).toBe(0);
    expect(stepPreset(4, -1, -1)).toBe(3);
  });
  it("goes on round from the ends when wrapping", () => {
    expect(stepPreset(4, 3, 1, true)).toBe(0);
    expect(stepPreset(4, 0, -1, true)).toBe(3);
  });
  it("has nowhere to go without presets", () => {
    expect(stepPreset(0, -1, 1)).toBe(-1);
  });
});

describe("parseQuickSwitch", () => {
  it("keeps good presets and repairs a bad style", () => {
    const parsed = parseQuickSwitch({
      enabled: false,
      style: "carousel",
      presets: [presets[0]],
    });
    expect(parsed).toEqual({
      enabled: false,
      style: "drum",
      sound: true,
      presets: [presets[0]],
    });
  });
  it("drops a corrupt preset list rather than the whole setting", () => {
    const parsed = parseQuickSwitch({
      style: "tab",
      presets: [{ provider: "gpt" }],
    });
    expect(parsed).toEqual({
      enabled: true,
      style: "tab",
      sound: true,
      presets: [],
    });
  });
});
