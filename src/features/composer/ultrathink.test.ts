import { describe, expect, it } from "vitest";
import { asksUltrathink, ultrathinkEdits } from "./ultrathink";

const applied = (text: string) =>
  ultrathinkEdits(text).reduce(
    (draft, edit) =>
      draft.slice(0, edit.start) + edit.text + draft.slice(edit.end),
    text,
  );

describe("ultrathink", () => {
  it("hears the keyword as a word, in any case", () => {
    expect(asksUltrathink("UltraThink about this")).toBe(true);
    expect(asksUltrathink("ultrathinking about this")).toBe(false);
  });

  it("adds the keyword after the draft with one space", () => {
    expect(applied("")).toBe("ultrathink");
    expect(applied("fix the race")).toBe("fix the race ultrathink");
    expect(applied("fix the race\n")).toBe("fix the race\nultrathink");
  });

  it("takes every keyword out without leaving double spaces", () => {
    expect(applied("ultrathink fix the race")).toBe("fix the race");
    expect(applied("fix ultrathink the race")).toBe("fix the race");
    expect(applied("ultrathink ultrathink fix it ultrathink")).toBe("fix it");
  });

  it("adds then removes back to the same draft", () => {
    const draft = "why does @src/app.ts flicker?";
    expect(applied(applied(draft))).toBe(draft);
  });
});
