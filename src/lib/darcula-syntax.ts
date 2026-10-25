/**
 * JetBrains' Darcula colour scheme as a Shiki theme, for code, diffs and the
 * editor. The colours are the IDE's own; the scopes are TextMate's, plus the
 * call scopes the editor gives function and method calls, which Darcula
 * leaves plain while declarations are yellow.
 */
import { registerCustomTheme } from "@pierre/diffs";

export const DARCULA_SYNTAX = "relay-darcula";

const text = "#a9b7c6";
const keyword = "#cc7832";
const field = "#9876aa";

const tokenColors = [
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#808080" } },
  {
    scope: ["comment.block.documentation", "comment.block.documentation punctuation.definition.comment"],
    settings: { foreground: "#629755", fontStyle: "italic" },
  },
  {
    scope: ["storage.type.class.jsdoc", "keyword.other.phpdoc", "storage.type.class.doxygen"],
    settings: { foreground: "#629755", fontStyle: "bold" },
  },
  {
    scope: [
      "keyword",
      "storage",
      "constant.language",
      "variable.language.this",
      "variable.language.super",
      "keyword.operator.new",
      "keyword.operator.expression",
      "constant.character.escape",
      "punctuation.separator.comma",
      "punctuation.terminator",
      "entity.name.tag.yaml",
    ],
    settings: { foreground: keyword },
  },
  { scope: "keyword.operator", settings: { foreground: text } },
  { scope: "string", settings: { foreground: "#6a8759" } },
  { scope: "constant.numeric", settings: { foreground: "#6897bb" } },
  { scope: "entity.name.function", settings: { foreground: "#ffc66d" } },
  {
    scope: [
      "meta.function-call entity.name.function",
      "entity.name.function.call",
      "entity.name.function.member.call",
    ],
    settings: { foreground: text },
  },
  {
    scope: [
      "variable.other.property",
      "variable.other.object.property",
      "meta.object-literal.key",
      "support.type.property-name",
      "variable.other.php",
      "punctuation.definition.variable.php",
    ],
    settings: { foreground: field },
  },
  { scope: "variable.other.enummember", settings: { foreground: field, fontStyle: "italic" } },
  {
    scope: [
      "meta.decorator",
      "punctuation.decorator",
      "entity.name.function.decorator",
      "meta.attribute.php",
      "meta.preprocessor",
      "keyword.control.directive",
    ],
    settings: { foreground: "#bbb529" },
  },
  { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: "#e8bf6a" } },
  {
    scope: ["entity.other.attribute-name", "support.type.property-name.css"],
    settings: { foreground: "#bababa" },
  },
  { scope: "markup.heading", settings: { foreground: keyword, fontStyle: "bold" } },
  { scope: ["markup.underline.link", "string.other.link"], settings: { foreground: "#287bde" } },
  { scope: "markup.inserted", settings: { foreground: "#6a8759" } },
  { scope: "markup.deleted", settings: { foreground: "#bc3f3c" } },
  { scope: "invalid", settings: { foreground: "#bc3f3c" } },
];

registerCustomTheme(DARCULA_SYNTAX, async () => ({
  name: DARCULA_SYNTAX,
  type: "dark",
  colors: { "editor.background": "#2b2b2b", "editor.foreground": text },
  tokenColors,
}));
