import { describe, expect, it } from "vitest";
import {
  highlight,
  matches,
  searchWords,
  sections,
  type SettingEntry,
} from "./settings-search";

const entry = (
  id: string,
  extra: Partial<SettingEntry> = {},
): SettingEntry => ({ id, category: "appearance", title: id, ...extra });

describe("matches", () => {
  const sendKey = entry("send", {
    title: "Send messages with",
    description: "Enter sends the message.",
    keywords: "return newline",
  });

  it("needs every word, from any of the entry's fields", () => {
    expect(matches(sendKey, searchWords("  SEND  newline "), "Shortcuts")).toBe(
      true,
    );
    expect(matches(sendKey, searchWords("send theme"), "Shortcuts")).toBe(
      false,
    );
  });

  it("finds an entry by its category's name", () => {
    expect(
      matches(sendKey, searchWords("keyboard"), "Keyboard shortcuts"),
    ).toBe(true);
  });

  it("doesn't match across the gap between two fields", () => {
    expect(matches(sendKey, searchWords("withenter"), "")).toBe(false);
  });
});

describe("sections", () => {
  it("starts a new run whenever the heading changes, even back to an earlier one", () => {
    const runs = sections([
      entry("intro"),
      entry("send", { section: "Composer" }),
      entry("stop", { section: "Composer" }),
      entry("open", { section: "App" }),
      entry("queue", { section: "Composer" }),
    ]);
    expect(runs.map((r) => [r.section, r.list.map((e) => e.id)])).toEqual([
      [undefined, ["intro"]],
      ["Composer", ["send", "stop"]],
      ["App", ["open"]],
      ["Composer", ["queue"]],
    ]);
  });
});

describe("highlight", () => {
  it("marks the query's first word only, keeping the title's case", () => {
    expect(highlight("Light theme", " THEME light")).toEqual([
      "Light ",
      "theme",
      "",
    ]);
  });

  it("leaves titles without the word, and empty queries, alone", () => {
    expect(highlight("Accent", "dark")).toBeUndefined();
    expect(highlight("Accent", "   ")).toBeUndefined();
  });
});
