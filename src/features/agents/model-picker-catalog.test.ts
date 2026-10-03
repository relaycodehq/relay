import { describe, expect, it } from "vitest";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import {
  modelKey,
  pickerCatalog,
  pickerRows,
  type AgentCatalog,
  type PickerModel,
} from "./model-picker-catalog";

const model = (id: string, more: Partial<AgentModel> = {}): AgentModel => ({
  id,
  name: id.toUpperCase(),
  description: "",
  efforts: [],
  ...more,
});
const noCustoms = {
  codex: [],
  claude: [],
  opencode: [],
  cursor: [],
} as Record<AgentProvider, string[]>;
const catalogs: Partial<Record<AgentProvider, AgentCatalog>> = {
  codex: {
    models: [model("gpt-a"), model("gpt-old", { legacy: true })],
    model: "",
  },
  opencode: {
    models: [
      model("anthropic/sonnet", { group: "Anthropic" }),
      model("openai/gpt", { group: "OpenAI" }),
      model("openai/mini", { group: "OpenAI" }),
    ],
    model: "",
  },
};
const ids = (rows: PickerModel[]) => rows.map((m) => `${m.provider}:${m.id}`);
const rowsOf = (over: Partial<Parameters<typeof pickerRows>[1]> = {}) =>
  pickerRows(pickerCatalog(["codex", "opencode"], catalogs, noCustoms), {
    category: "codex",
    query: "",
    legacy: false,
    group: "",
    favorites: [],
    pinned: [],
    allowDefault: true,
    ...over,
  });

describe("the picker's catalog", () => {
  it("lists an agent's models, its Default, then custom ids and an unlisted pick", () => {
    const catalog = pickerCatalog(
      ["codex"],
      { codex: { models: [model("gpt-a")], model: "picked-x" } },
      { ...noCustoms, codex: ["my-model", "gpt-a", "picked-x"] },
    );
    expect(ids(catalog)).toEqual([
      "codex:gpt-a",
      "codex:",
      "codex:my-model",
      "codex:picked-x",
      "message:",
    ]);
    expect(catalog.filter((m) => m.custom).map((m) => m.id)).toEqual([
      "my-model",
      "picked-x",
    ]);
  });

  it("still offers Default while an agent's models load", () => {
    const catalog = pickerCatalog(
      ["claude"],
      { claude: { models: undefined, model: "" } },
      noCustoms,
    );
    expect(ids(catalog)).toEqual(["claude:", "message:"]);
  });
});

describe("the picker's rows", () => {
  it("folds legacy models away until asked, then lists them last", () => {
    const folded = rowsOf();
    expect(ids(folded.rows)).toEqual(["codex:gpt-a", "codex:"]);
    expect(folded.legacyCount).toBe(1);
    expect(folded.firstLegacy).toBe(-1);
    const open = rowsOf({ legacy: true });
    expect(ids(open.rows)).toEqual(["codex:gpt-a", "codex:", "codex:gpt-old"]);
    expect(open.firstLegacy).toBe(2);
  });

  it("puts favorites starred before opening first, and shows a folded one", () => {
    const pinned = [
      modelKey({ provider: "codex", id: "gpt-old", name: "" }),
      modelKey({ provider: "codex", id: "", name: "" }),
    ];
    expect(ids(rowsOf({ pinned }).rows)).toEqual([
      "codex:",
      "codex:gpt-old",
      "codex:gpt-a",
    ]);
  });

  it("lists every agent's favorites under Favorites", () => {
    const favorites = [
      modelKey({ provider: "opencode", id: "openai/gpt", name: "" }),
      modelKey({ provider: "codex", id: "gpt-a", name: "" }),
    ];
    expect(ids(rowsOf({ category: "favorites", favorites }).rows)).toEqual([
      "codex:gpt-a",
      "opencode:openai/gpt",
    ]);
  });

  it("leaves out Default rows where they aren't allowed", () => {
    expect(ids(rowsOf({ allowDefault: false }).rows)).toEqual(["codex:gpt-a"]);
  });

  it("searches the folded legacy models too", () => {
    const found = rowsOf({ query: "gpt-old" });
    expect(ids(found.rows)).toEqual(["codex:gpt-old"]);
    expect(found.firstLegacy).toBe(-1);
  });

  it("offers a typed id as a custom model when nothing matches", () => {
    expect(rowsOf({ query: "zzz-1" }).rows).toEqual([
      { provider: "codex", id: "zzz-1", name: "zzz-1", custom: true },
    ]);
    expect(rowsOf({ query: "zz zz" }).rows).toEqual([]);
    expect(rowsOf({ category: "favorites", query: "zzz-1" }).rows).toEqual([]);
  });

  it("counts a grouped agent's matches per section and narrows to one", () => {
    const all = rowsOf({ category: "opencode", query: "openai" });
    expect(all.groups).toEqual([
      { name: "Anthropic", count: 0 },
      { name: "OpenAI", count: 2 },
    ]);
    expect(
      ids(rowsOf({ category: "opencode", group: "Anthropic" }).rows),
    ).toEqual(["opencode:anthropic/sonnet"]);
  });

  it("drops fuzzy matches in a grouped agent but not in a short list", () => {
    expect(ids(rowsOf({ category: "codex", query: "gta" }).rows)).toEqual([
      "codex:gpt-a",
    ]);
    expect(ids(rowsOf({ category: "opencode", query: "opmi" }).rows)).toEqual([
      "opencode:opmi",
    ]);
  });
});
