import { expect, it } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import {
  FileTag,
  ImageTag,
  Paste,
  Quote,
} from "../../src/components/ComposerPromptInput";
import { promptContent } from "../../src/lib/prompt-content";
import {
  deleteImagePills,
  lastPaste,
  pasteIndex,
  pasteNodes,
  quotesIn,
  spacedTags,
} from "../../src/lib/prompt-pills";
import { promptText } from "../../src/lib/prompt-text";
import { pasteMarkdown } from "../../shared/pasted-texts";

const schema = getSchema([StarterKit, Quote, Paste, FileTag, ImageTag]);
const draft = (text: string, quotes: string[] = []) =>
  schema.nodeFromJSON(promptContent(text, {}, quotes));
const tag: JSONContent = { type: "relayFile", attrs: { path: "/a" } };
const space: JSONContent = { type: "text", text: " " };

it("takes a removed screenshot's spare space with it", () => {
  const without = (text: string, n: number) =>
    promptText(
      deleteImagePills(EditorState.create({ doc: draft(text) }).tr, n).doc,
    );
  expect(without("a [Image #1] b", 1)).toBe("a b");
  expect(without("[Image #1] b", 1)).toBe("b");
  expect(without("a[Image #1] b", 1)).toBe("a b");
  expect(without("a [Image #1]", 1)).toBe("a ");
  expect(without("[Image #1] [Image #1] [Image #2]", 1)).toBe("[Image #2]");
  // A line break before the pill is not a space, so the one after it stays.
  expect(without("x\n[Image #1] b", 1)).toBe("x\n b");
  const untouched = EditorState.create({ doc: draft("[Image #2]") }).tr;
  expect(deleteImagePills(untouched, 1).docChanged).toBe(false);
});

it("spaces tags from the text around them, and from each other", () => {
  expect(spacedTags([tag], null, null)).toEqual([tag, space]);
  expect(spacedTags([tag], schema.text("a"), schema.text("b"))).toEqual([
    space,
    tag,
    space,
  ]);
  expect(spacedTags([tag], schema.text("a "), schema.text(" b"))).toEqual([
    tag,
  ]);
  expect(spacedTags([tag, tag], null, schema.text(" "))).toEqual([
    tag,
    space,
    tag,
  ]);
  const pill = schema.nodes.relayImage.create({ n: 1 });
  expect(spacedTags([tag], pill, pill)).toEqual([space, tag, space]);
});

it("counts paste pills by place and by number", () => {
  const doc = draft(
    `a${pasteMarkdown({ n: 2, text: "x" })}b${pasteMarkdown({ n: 5, text: "y" })}`,
  );
  const at: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "relayPaste") at.push(pos);
  });
  expect(at.map((pos) => pasteIndex(doc, pos))).toEqual([0, 1]);
  expect(lastPaste(doc)).toBe(5);
  expect(lastPaste(draft("plain"))).toBe(0);
});

it("lists the quote pills in the draft", () => {
  expect(quotesIn(draft("> one\n\n> two\n\nwhy", ["one", "two"]))).toEqual([
    "one",
    "two",
  ]);
});

it("splits an inlined paste into lines", () => {
  const nodes = pasteNodes(schema, "a\n\nb");
  expect(nodes.map((n) => n.type.name)).toEqual([
    "text",
    "hardBreak",
    "hardBreak",
    "text",
  ]);
  expect(pasteNodes(schema, "")).toEqual([]);
});
