import { describe, expect, it } from "vitest";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { loadLanguage } from "../../../lib/code-languages";
import { highlightRuns } from "./highlight-runs";

const style = HighlightStyle.define([
  { tag: t.keyword, class: "keyword" },
  { tag: t.function(t.definition(t.variableName)), class: "declaration" },
  { tag: t.function(t.definition(t.propertyName)), class: "declaration" },
]);

// Relay's TypeScript, which tags a class method's name as a declaration.
const typescript = (await loadLanguage("x.ts"))!;
const state = EditorState.create({ extensions: [typescript, syntaxHighlighting(style)] });

/** The class each named piece of the signature came out in. */
const classOf = (code: string, member: boolean, piece: string) => {
  const runs = highlightRuns(state, code, member);
  expect(runs.map((run) => run.text).join("")).toBe(code);
  return runs.find((run) => run.text.trim() === piece)?.className;
};

describe("highlightRuns", () => {
  const constructor = "constructor HandoffFollowing(\n    store: Store,\n    flush: (chatId: string) => void,\n): HandoffFollowing";

  it("colours TypeScript's constructor line as a keyword and a declaration", () => {
    expect(classOf(constructor, false, "constructor")).toBe("keyword");
    expect(classOf(constructor, false, "HandoffFollowing")).toBe("declaration");
  });

  it("colours primitive types as keywords and leaves classes plain", () => {
    expect(classOf(constructor, false, "string")).toBe("keyword");
    expect(classOf(constructor, false, "Store")).toBeUndefined();
  });

  it("reads a member as a method declared in a class", () => {
    expect(classOf("follow(id: string): Promise<void>", true, "follow")).toBe("declaration");
  });
});
