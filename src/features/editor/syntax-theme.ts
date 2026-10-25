import { HighlightStyle } from "@codemirror/language";
import { tags as t, type Tag } from "@lezer/highlight";
import { phpVariable } from "../../lib/code-languages";
import { firstStyle, type ThemeRule } from "../../lib/textmate-scopes";

export type { ThemeRule };

/**
 * Each group of highlight tags with the TextMate scopes to take its style
 * from. The first scope the theme colours wins. This is how the editor uses the
 * same Shiki theme as the diffs and the chat.
 */
const SCOPES: [Tag[], string[]][] = [
  [[t.comment, t.lineComment, t.blockComment, t.docComment], ["comment"]],
  [[t.keyword], ["keyword"]],
  [[t.controlKeyword], ["keyword.control", "keyword"]],
  [[t.operatorKeyword], ["keyword.operator.expression", "keyword.operator"]],
  [[t.definitionKeyword], ["storage.type", "keyword"]],
  [[t.moduleKeyword], ["keyword.control.import", "keyword.control", "keyword"]],
  [[t.modifier], ["storage.modifier", "keyword"]],
  [[t.self], ["variable.language.this", "variable.language"]],
  [[t.null, t.bool, t.atom], ["constant.language"]],
  [[t.number, t.integer, t.float], ["constant.numeric"]],
  [[t.unit], ["keyword.other.unit", "constant.numeric"]],
  [[t.color], ["constant.other.color", "constant"]],
  [[t.string, t.docString, t.character, t.special(t.string)], ["string"]],
  [[t.regexp], ["string.regexp", "string"]],
  [[t.escape], ["constant.character.escape", "string"]],
  [[t.variableName], ["variable.other.readwrite", "variable"]],
  [[t.definition(t.variableName)], ["variable.other.readwrite", "variable"]],
  [[t.local(t.variableName)], ["variable.other.local", "variable"]],
  [[phpVariable], ["variable.other.php", "variable.other.readwrite", "variable"]],
  [[t.special(t.variableName)], ["variable.language", "variable"]],
  [
    [t.function(t.definition(t.variableName)), t.function(t.definition(t.propertyName))],
    ["entity.name.function", "support.function"],
  ],
  // Calls take the declaration's colour, unless the theme gives calls their own.
  [[t.function(t.variableName)], ["entity.name.function.call", "support.function"]],
  [
    [t.constant(t.variableName)],
    ["variable.other.constant", "constant.other", "variable"],
  ],
  [[t.standard(t.variableName)], ["support.function", "support.variable"]],
  [
    [t.propertyName, t.definition(t.propertyName)],
    ["variable.other.property", "variable.other.object.property", "variable"],
  ],
  [[t.function(t.propertyName)], ["entity.name.function.member.call", "entity.name.function"]],
  [[t.typeName], ["entity.name.type", "support.type"]],
  [
    [t.standard(t.typeName)],
    ["support.type.primitive", "support.type", "entity.name.type"],
  ],
  [[t.className], ["entity.name.type.class", "entity.name.type"]],
  [[t.namespace], ["entity.name.namespace", "entity.name.type.module"]],
  [[t.macroName], ["entity.name.function.macro", "entity.name.function"]],
  [[t.labelName], ["entity.name.label", "variable"]],
  [[t.tagName], ["entity.name.tag"]],
  [[t.angleBracket], ["punctuation.definition.tag", "punctuation"]],
  [[t.attributeName], ["entity.other.attribute-name"]],
  [[t.attributeValue], ["string"]],
  [[t.operator, t.derefOperator], ["keyword.operator"]],
  [[t.punctuation, t.bracket], ["punctuation"]],
  [[t.separator], ["punctuation.separator.comma", "punctuation"]],
  [
    [t.annotation],
    ["entity.name.function.decorator", "meta.decorator", "storage.type"],
  ],
  [
    [t.processingInstruction, t.meta],
    ["keyword.control.directive", "meta.preprocessor", "keyword.control"],
  ],
  [[t.heading], ["markup.heading", "entity.name.section"]],
  [[t.emphasis], ["markup.italic"]],
  [[t.strong], ["markup.bold"]],
  [[t.strikethrough], ["markup.strikethrough"]],
  [[t.link, t.url], ["markup.underline.link", "string.other.link"]],
  [[t.quote], ["markup.quote"]],
  [[t.monospace], ["markup.inline.raw", "string"]],
  [[t.list], ["punctuation.definition.list", "markup.list"]],
  [[t.contentSeparator], ["meta.separator", "punctuation"]],
  [[t.inserted], ["markup.inserted"]],
  [[t.deleted], ["markup.deleted"]],
  [[t.changed], ["markup.changed"]],
  [[t.invalid], ["invalid"]],
];

/** The theme's token colours as CodeMirror highlighting. */
export function highlightStyleFor(rules: readonly ThemeRule[]) {
  const specs = SCOPES.flatMap(([tags, scopes]) => {
    const { color, fontStyle = "" } = firstStyle(rules, scopes);
    // Markdown relies on these, so they stay styled even when the theme leaves them plain.
    const italic = /italic/.test(fontStyle) || tags.includes(t.emphasis);
    const bold =
      /bold/.test(fontStyle) || tags.includes(t.heading) || tags.includes(t.strong);
    const underline = /underline/.test(fontStyle);
    const strike = /strikethrough/.test(fontStyle);
    if (!color && !italic && !bold && !underline && !strike) return [];
    return [
      {
        tag: tags,
        ...(color ? { color } : {}),
        ...(italic ? { fontStyle: "italic" } : {}),
        ...(bold ? { fontWeight: "bold" } : {}),
        ...(underline || strike
          ? {
              textDecoration: [
                underline && "underline",
                strike && "line-through",
              ]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
      },
    ];
  });
  return HighlightStyle.define(specs);
}
