import { describe, expect, it } from "vitest";
import { rankModelQuery, type ModelPickerSearchable } from "./model-search";

const row = (
  name: string,
  shortName: string,
  agent: [string, string],
  more: Partial<ModelPickerSearchable> = {},
): ModelPickerSearchable => ({
  driverKind: agent[0],
  providerDisplayName: agent[1],
  name,
  shortName,
  ...more,
});
const codex: [string, string] = ["codex", "Codex"];
const claude: [string, string] = ["claude", "Claude"];
const opencode: [string, string] = ["opencode", "OpenCode"];

const scores = (rows: ModelPickerSearchable[], query: string) =>
  rows.map((r) => rankModelQuery(r, query));

describe("rankModelQuery", () => {
  const codexRows = [
    row("GPT-5.5", "gpt-5.5", codex),
    row("GPT-5.5 Mini", "gpt-5.5-mini", codex),
    row("GPT-5 Codex", "gpt-5-codex", codex),
    row("o4 Mini", "o4-mini", codex),
  ];
  it.each([
    ["", [0, 0, 0, 0]],
    ["  ", [0, 0, 0, 0]],
    ["gpt", [6, 11, 10, null]],
    ["GPT-5.5", [0, 7, null, null]],
    ["mini", [null, 28, null, 13]],
    ["5.5", [16, 21, null, null]],
    ["codex", [20, 20, 20, 20]],
    ["gpt mini", [null, 39, null, null]],
    ["mini gpt", [null, 39, null, null]],
    ["gptm", [null, 128, null, null]],
    ["gt5", [112, 117, 116, null]],
    ["ab", [null, null, null, null]],
    ["xyz", [null, null, null, null]],
  ])("scores Codex models for %j", (query, expected) => {
    expect(scores(codexRows, query)).toEqual(expected);
  });

  const claudeRows = [
    row("Opus 5", "opus", claude),
    row("Sonnet 5.5", "sonnet", claude),
    row("Haiku 4.5", "haiku", claude),
    row("Claude default", "", claude),
  ];
  it.each([
    ["son", [null, 9, null, null]],
    ["opus", [4, null, null, null]],
    ["claude", [20, 20, 20, 10]],
    ["cl", [26, 26, 26, 14]],
    ["hku", [null, null, 114, null]],
    ["5", [19, 27, 30, null]],
  ])("scores Claude models for %j", (query, expected) => {
    expect(scores(claudeRows, query)).toEqual(expected);
  });

  const opencodeRows = [
    row("Claude Sonnet", "anthropic/claude-sonnet", opencode, {
      subProvider: "Anthropic",
    }),
    row("GPT-5", "openai/gpt-5", opencode, { subProvider: "OpenAI" }),
    row("Gemini Pro", "google/gemini-pro", opencode, {
      subProvider: "Google Long context",
    }),
  ];
  it.each([
    ["openai", [353, 18, null]],
    ["claude", [9, null, null]],
    ["sonnet", [25, null, null]],
    ["long", [null, null, 53]],
    ["anthropic claude", [29, null, null]],
    ["gem pro", [null, null, 34]],
  ])("scores OpenCode models for %j", (query, expected) => {
    expect(scores(opencodeRows, query)).toEqual(expected);
  });

  it("ignores case and surrounding spaces", () => {
    const [gpt] = codexRows;
    expect(rankModelQuery(gpt, "GPT")).toBe(rankModelQuery(gpt, "gpt"));
    expect(rankModelQuery(gpt, "  gpt  ")).toBe(6);
  });

  it("ranks exact, prefix, word start, substring, fuzzy in that order", () => {
    const tiers = ["mini", "minis", "a-mini", "aamini", "mxinxi"].map((name) =>
      rankModelQuery(row(name, "", ["x", "X"]), "mini"),
    );
    expect(tiers.every((s) => s !== null)).toBe(true);
    expect(tiers).toEqual([...tiers].sort((a, b) => a! - b!));
    expect(new Set(tiers).size).toBe(tiers.length);
  });

  it("only matches fuzzily from three characters", () => {
    const mini = row("gpt-5.5 mini", "", ["x", "X"]);
    expect(rankModelQuery(mini, "gm")).toBeNull();
    expect(rankModelQuery(mini, "gtm")).toBeGreaterThanOrEqual(100);
  });

  it("treats space, hyphen, underscore and slash as word starts, not dots", () => {
    const at = (name: string) =>
      rankModelQuery(row(name, "", ["x", "X"]), "mini");
    // Word start is 4 + 2 * position + length penalty, plain substring is 6 + ...
    expect(at("ab mini")).toBe(4 + 6 + 3);
    expect(at("ab-mini")).toBe(4 + 6 + 3);
    expect(at("ab_mini")).toBe(4 + 6 + 3);
    expect(at("ab/mini")).toBe(4 + 6 + 3);
    expect(at("ab.mini")).toBe(6 + 6 + 3);
  });

  it("matches across spaces, hyphens and dots the user left out", () => {
    const glm = [
      row("GLM-5.3", "zai-coding-plan/glm-5.3", opencode),
      row("GLM-5.3 Flash", "zai-coding-plan/glm-5.3-flash", opencode),
      row("GLM-5", "zai-coding-plan/glm-5", opencode),
    ];
    for (const query of ["GLM5.3", "glm53", "glm 5.3", "GLM-5.3"]) {
      const [exact, flash, five] = scores(glm, query);
      expect(exact).toBeLessThan(flash!);
      expect(exact).toBeLessThan(100);
      expect(five).toBeNull();
    }
    expect(rankModelQuery(codexRows[0], "gpt55")).toBe(1);
  });

  it("needs every word to match, in any field", () => {
    const [sonnet] = opencodeRows;
    expect(rankModelQuery(sonnet, "anthropic claude")).toBe(29);
    expect(rankModelQuery(sonnet, "claude anthropic")).toBe(29);
    expect(rankModelQuery(sonnet, "anthropic zzz")).toBeNull();
  });

  it("gives a starred row exactly 24 off, but not for a blank query", () => {
    const gpt = codexRows[0];
    const starred = { ...gpt, isFavorite: true };
    expect(rankModelQuery(starred, "gpt")).toBe(6 - 24);
    expect(rankModelQuery(starred, "  ")).toBe(0);
  });

  it("prefers a shorter name and the name over the id", () => {
    const short = row("Mini", "", ["x", "X"]);
    const long = row("Miniature", "", ["x", "X"]);
    expect(rankModelQuery(short, "min")!).toBeLessThan(
      rankModelQuery(long, "min")!,
    );
    const byName = row("mini", "zzzz", ["x", "X"]);
    const byId = row("zzzz", "mini", ["x", "X"]);
    expect(rankModelQuery(byName, "min")!).toBeLessThan(
      rankModelQuery(byId, "min")!,
    );
  });

  it("does not fold accents", () => {
    const etoile = row("Étoile", "", codex);
    expect(rankModelQuery(etoile, "etoile")).toBeNull();
    expect(rankModelQuery(etoile, "ÉTOILE")).toBe(0);
  });

  it("moves later fields up when a row has no id or extra text", () => {
    expect(rankModelQuery(row("A", "", codex), "codex")).toBe(10);
    expect(
      rankModelQuery(row("A", "s", codex, { subProvider: "p" }), "codex"),
    ).toBe(30);
  });
});
