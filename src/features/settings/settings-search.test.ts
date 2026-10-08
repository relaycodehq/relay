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

  it("finds entries by their section heading", () => {
    expect(
      matches(
        entry("setup", { section: "Worktrees" }),
        searchWords("worktrees"),
        "Projects",
      ),
    ).toBe(true);
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
  it("marks every word and occurrence while keeping the original case", () => {
    expect(highlight("Light theme, light text", " THEME light")).toEqual([
      { text: "Light", matched: true },
      { text: " ", matched: false },
      { text: "theme", matched: true },
      { text: ", ", matched: false },
      { text: "light", matched: true },
      { text: " text", matched: false },
    ]);
  });

  it("leaves titles without the word, and empty queries, alone", () => {
    expect(highlight("Accent", "dark")).toEqual([
      { text: "Accent", matched: false },
    ]);
    expect(highlight("Accent", "   ")).toEqual([
      { text: "Accent", matched: false },
    ]);
  });

  it("merges overlaps, regardless of the order or duplication of words", () => {
    expect(highlight("Settled", "settle settled settle")).toEqual([
      { text: "Settled", matched: true },
    ]);
    expect(highlight("banana", "ana ban")).toEqual([
      { text: "banana", matched: true },
    ]);
  });

  it("treats punctuation literally", () => {
    expect(highlight("Use [Image #1] and C++", "[image c++")).toEqual([
      { text: "Use ", matched: false },
      { text: "[Image", matched: true },
      { text: " #1] and ", matched: false },
      { text: "C++", matched: true },
    ]);
  });
});
