import { describe, expect, it } from "vitest";
import {
  cleanPaste,
  isLongPaste,
  parsePastedTexts,
  pastedTextMessage,
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

describe("pasted texts", () => {
  it("round-trips pastes after the question", () => {
    const sent = pastedTextMessage(pastes, "Why does this fail?");
    expect(
      sent.startsWith("Why does this fail?\n\nPasted text #1:\n\n```\n"),
    ).toBe(true);
    expect(sent).toContain("Pasted text #3:\n\n````\n```ts");
    expect(parsePastedTexts(sent)).toEqual({
      pastes,
      body: "Why does this fail?",
    });
  });
  it("keeps a leading agent mention first, even with nothing typed", () => {
    const sent = pastedTextMessage(pastes.slice(0, 1), "@claude");
    expect(sent.startsWith("@claude Pasted text #1:")).toBe(true);
    expect(parsePastedTexts(sent)).toEqual({
      pastes: pastes.slice(0, 1),
      body: "@claude ",
    });
    const asked = pastedTextMessage(pastes, "@codex  explain");
    expect(parsePastedTexts(asked)).toEqual({
      pastes,
      body: "@codex explain",
    });
  });
  it("keeps slash commands at the start of the question", () => {
    const sent = pastedTextMessage(pastes.slice(0, 1), "@claude /review");
    expect(sent.startsWith("@claude /review\n\nPasted text #1:")).toBe(true);
  });
  it("leaves messages without trailing pastes alone", () => {
    const typed =
      "Pasted text #1:\n\n```\nnot at the end\n```\n\nand then more prose";
    expect(parsePastedTexts(typed)).toEqual({ pastes: [], body: typed });
    expect(parsePastedTexts("plain")).toEqual({ pastes: [], body: "plain" });
  });
  it("sits after code references, which lead the message", () => {
    const withPaste = pastedTextMessage(pastes, "@claude look");
    const sent = codeReferenceMessage(
      [{ path: "a.ts", start: 1, end: 2, label: "HEAD", code: "x\ny" }],
      withPaste,
    );
    const code = parseCodeReferences(sent);
    expect(code.refs).toHaveLength(1);
    expect(parsePastedTexts(code.body)).toEqual({
      pastes,
      body: "@claude look",
    });
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
    expect(promptTitle(pastedTextMessage(pastes, "@claude Fix it"))).toBe(
      "Fix it",
    );
    expect(promptTitle(pastedTextMessage(pastes, "@claude"))).toBe(
      "TypeError: boom",
    );
  });
});
