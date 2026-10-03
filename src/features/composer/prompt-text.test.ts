import { describe, expect, it } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ImageTag } from "./prompt/image-pill";
import { FileTag, Paste, Quote, Skill } from "./prompt/pills";
import { promptContent } from "./prompt-content";
import { pasteAt } from "./prompt-pills";
import { positionAt, promptText, serialize } from "./prompt-text";
import { pasteMarkdown } from "../../../shared/pasted-texts";

const schema = getSchema([StarterKit, Skill, Quote, Paste, FileTag, ImageTag]);
const doc = (...content: JSONContent[]) =>
  schema.nodeFromJSON({
    type: "doc",
    content: [{ type: "paragraph", content }],
  });
const text = (value: string): JSONContent => ({ type: "text", text: value });

// "ab$fix c\n[Image #1]d": positions 1-3 "ab", 3 skill, 4-6 " c", 6 break, 7 image, 8-9 "d"
const mixed = doc(
  text("ab"),
  { type: "relaySkill", attrs: { token: "$fix", label: "fix" } },
  text(" c"),
  { type: "hardBreak" },
  { type: "relayImage", attrs: { n: 1 } },
  text("d"),
);

describe("promptText", () => {
  it("sends pills as their tokens and breaks as newlines", () => {
    expect(promptText(mixed)).toBe("ab$fix c\n[Image #1]d");
  });

  it("measures the caret's offset up to a document position", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((pos) => promptText(mixed, pos).length),
    ).toEqual([0, 1, 2, 6, 7, 8, 9, 19, 20]);
  });

  it("puts a quote after text on a line of its own", () => {
    const quoted = doc(
      text("ab"),
      { type: "relayQuote", attrs: { text: "x" } },
      text("cd"),
    );
    expect(promptText(quoted)).toBe("ab\n> x\n\ncd");
    expect(promptText(quoted, 4).length).toBe(8);
  });

  it("joins copied paragraphs with newlines", () => {
    const two = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [text("a")] },
        { type: "paragraph", content: [text("b")] },
      ],
    });
    expect(serialize(two.content)).toBe("a\nb");
  });
});

describe("positionAt", () => {
  it("maps text offsets to document positions, past a pill once inside it", () => {
    const at = (offsets: number[]) => offsets.map((o) => positionAt(mixed, o));
    expect(at([0, 1, 2])).toEqual([1, 2, 3]);
    // Inside or at the end of "$fix" lands after the skill.
    expect(at([3, 5, 6])).toEqual([4, 4, 4]);
    expect(at([7, 8, 9])).toEqual([5, 6, 7]);
    expect(at([10, 19, 20])).toEqual([8, 8, 9]);
    expect(at([25])).toEqual([9]);
  });

  it("finds text after a quote that starts its own line", () => {
    const quoted = doc(
      text("ab"),
      { type: "relayQuote", attrs: { text: "x" } },
      text("cd"),
    );
    expect([3, 8, 9].map((o) => positionAt(quoted, o))).toEqual([4, 4, 5]);
  });

  it("puts the caret at the start of an empty draft", () => {
    expect(positionAt(schema.nodeFromJSON(promptContent("", {})), 4)).toBe(1);
  });
});

describe("promptContent", () => {
  it("makes registered skills pills only where they start a word", () => {
    const draft = "$fix it and $fix, a$fix /skill:x $other";
    const content = promptContent(draft, { $fix: "fix", "/skill:x": "x" });
    const pills = content
      .content![0].content!.filter((n) => n.type === "relaySkill")
      .map((n) => n.attrs!.token);
    expect(pills).toEqual(["$fix", "$fix", "/skill:x"]);
    expect(promptText(schema.nodeFromJSON(content))).toBe(draft);
  });

  it("restores fenced pastes as pills, wherever they sit", () => {
    const draft = `see${pasteMarkdown({ n: 2, text: "a\nb" })}after`;
    const content = promptContent(draft, {});
    expect(content.content![0].content).toEqual([
      text("see"),
      { type: "relayPaste", attrs: { n: 2, text: "a\nb" } },
      text("after"),
    ]);
    const restored = schema.nodeFromJSON(content);
    expect(promptText(restored)).toBe(draft);
    expect(pasteAt(restored, 0)?.pos).toBe(4);
    expect(pasteAt(restored, 0)?.node.attrs.n).toBe(2);
    expect(pasteAt(restored, 1)).toBeUndefined();
  });

  it("restores image tokens as pills", () => {
    const draft = "hello [Image #1] and [Image #2]\nbye";
    const restored = schema.nodeFromJSON(promptContent(draft, {}));
    const pills: number[] = [];
    restored.descendants((node) => {
      if (node.type.name === "relayImage") pills.push(node.attrs.n);
    });
    expect(pills).toEqual([1, 2]);
    expect(promptText(restored)).toBe(draft);
  });
});
