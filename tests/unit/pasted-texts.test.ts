import { describe, expect, it } from "vitest";
import {
  cleanPaste,
  isLongPaste,
  pasteMarkdown,
  pastedTexts,
  replacePastedTexts,
  type PastedText,
} from "../../shared/pasted-texts";
import {
  codeReferenceMessage,
  parseCodeReferences,
} from "../../shared/code-references";
import { promptTitle } from "../../electron/thread-titles";

const log = Array.from(
  { length: 14 },
  (_, i) => `  at frame${i} (src/app.ts:${i + 1})`,
).join("\n");
const pastes: PastedText[] = [
  { n: 1, text: `TypeError: boom\n${log}` },
  { n: 3, text: "```ts\nconst a = 1;\n```\n\ntrailing prose" },
];
/** The message as the composer serialises it: pills where they were pasted. */
const message = (text: string, ...parts: PastedText[]) =>
  (text + parts.map(pasteMarkdown).join("")).trim();

describe("pasted texts", () => {
  it("round-trips pills wherever they sit in the message", () => {
    const sent = message("Why does this fail?", ...pastes);
    expect(
      sent.startsWith("Why does this fail?\n\nPasted text #1:\n\n```\n"),
    ).toBe(true);
    expect(sent).toContain("Pasted text #3:\n\n````\n```ts");
    expect(pastedTexts(sent)).toEqual(pastes);
    const between = `Look at${pasteMarkdown(pastes[0])}and then${pasteMarkdown(pastes[1])}done`;
    expect(pastedTexts(between)).toEqual(pastes);
    expect(replacePastedTexts(between, () => " [paste] ")).toBe(
      "Look at [paste] and then [paste] done",
    );
  });
  it("finds a paste right after the agent mention", () => {
    expect(pastedTexts(`@claude ${message("", pastes[0])}`)).toEqual(
      pastes.slice(0, 1),
    );
    expect(pastedTexts(message("@codex  explain", ...pastes))).toEqual(pastes);
  });
  it("renumbers pastes in order", () => {
    const renumbered = replacePastedTexts(
      message("Compare", ...pastes),
      ({ text }, i) => pasteMarkdown({ n: 5 + i, text }),
    );
    expect(pastedTexts(renumbered)).toEqual([
      { ...pastes[0], n: 5 },
      { ...pastes[1], n: 6 },
    ]);
  });
  it("ignores text that only looks like a paste", () => {
    const typed = "Pasted text #1:\n\n```\nnot fenced apart\n```and then more";
    expect(pastedTexts(typed)).toEqual([]);
    expect(replacePastedTexts(typed, () => "")).toBe(typed);
    expect(pastedTexts("plain")).toEqual([]);
  });
  it("sits after code references, which lead the message", () => {
    const withPaste = message("@claude look", ...pastes);
    const sent = codeReferenceMessage(
      [{ path: "a.ts", start: 1, end: 2, label: "HEAD", code: "x\ny" }],
      withPaste,
    );
    const code = parseCodeReferences(sent);
    expect(code.refs).toHaveLength(1);
    expect(pastedTexts(code.body)).toEqual(pastes);
  });
  it("attaches long or many-line pastes only", () => {
    expect(isLongPaste("short line")).toBe(false);
    expect(isLongPaste("x".repeat(1000))).toBe(true);
    expect(isLongPaste(log)).toBe(true);
    expect(isLongPaste("a\nb\nc")).toBe(false);
  });
  it("cleans line endings and surrounding blank lines, keeping indentation", () => {
    expect(cleanPaste("\r\n\n    indented\r\n  next\r\n\r\n")).toBe(
      "    indented\n  next",
    );
  });
  it("names a thread after its text, or the paste when nothing was typed", () => {
    expect(promptTitle(message("@claude Fix it", ...pastes))).toBe("Fix it");
    expect(promptTitle(message("@claude", ...pastes))).toBe("TypeError: boom");
    expect(promptTitle(`@claude ${message("", ...pastes)}`)).toBe(
      "TypeError: boom",
    );
  });
});
