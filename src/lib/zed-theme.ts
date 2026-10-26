/**
 * Relay's own syntax themes are TextMate themes, which Shiki reads; the
 * Highlights lexers want Zed themes instead. Each is registered in both
 * forms under one name, the Zed one worked out from the TextMate rules.
 */
import { registerCustomTheme } from "@pierre/diffs";
import type { Theme, ThemeSyntaxSettings } from "@pierre/highlights";
import { firstStyle, plainForeground, type ThemeRule } from "./textmate-scopes";

/** What Relay's theme loaders give: a Shiki theme, its rules under either name. */
export type TextmateTheme = {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: ThemeRule[];
  settings?: ThemeRule[];
};

/**
 * Each token the Highlights lexers name, with the TextMate scopes to take its
 * style from; the first the theme styles wins. A token left out inherits its
 * parent's (`function.method` takes `function`), as TextMate's prefixes do.
 */
const ZED_SCOPES: Record<string, string[]> = {
  comment: ["comment"],
  "comment.doc": ["comment.block.documentation", "comment"],
  keyword: ["keyword", "storage.type"],
  "keyword.control": ["keyword.control", "keyword"],
  "keyword.declaration": ["storage.type", "keyword"],
  "keyword.import": ["keyword.control.import", "keyword.control", "keyword"],
  "keyword.operator": [
    "keyword.operator.expression",
    "keyword.operator.new",
    "keyword",
  ],
  "keyword.jsdoc": ["storage.type.class.jsdoc", "comment.block.documentation"],
  operator: ["keyword.operator"],
  string: ["string"],
  "string.escape": ["constant.character.escape", "string"],
  "string.regex": ["string.regexp", "string"],
  "string.special": ["string.other", "string"],
  "string.special.symbol": ["constant.other.symbol", "string"],
  number: ["constant.numeric"],
  boolean: ["constant.language.boolean", "constant.language"],
  constant: ["variable.other.constant", "constant.other", "constant"],
  "constant.builtin": ["constant.language", "support.constant"],
  // Calls and declarations apart, for themes like Darcula that colour only declarations.
  function: [
    "entity.name.function.call",
    "support.function",
    "entity.name.function",
  ],
  "function.definition": ["entity.name.function"],
  "function.method": [
    "entity.name.function.member.call",
    "entity.name.function.call",
    "entity.name.function",
  ],
  constructor: ["entity.name.type.class", "entity.name.type", "support.class"],
  type: ["entity.name.type", "support.type"],
  "type.builtin": [
    "support.type.primitive",
    "support.type.builtin",
    "support.type",
    "entity.name.type",
  ],
  "type.class": ["entity.name.type.class", "entity.name.type"],
  "type.jsdoc": [
    "entity.name.type.instance.jsdoc",
    "comment.block.documentation",
  ],
  enum: ["entity.name.type.enum", "entity.name.type"],
  namespace: ["entity.name.namespace", "entity.name.type.module"],
  variable: ["variable.other.readwrite", "variable"],
  "variable.parameter": ["variable.parameter", "variable"],
  "variable.special": ["variable.language", "variable"],
  "variable.jsdoc": ["variable.other.jsdoc", "comment.block.documentation"],
  property: [
    "variable.other.property",
    "variable.other.object.property",
    "support.type.property-name",
    "variable",
  ],
  "property.json_key": [
    "support.type.property-name.json",
    "support.type.property-name",
  ],
  label: ["entity.name.label"],
  attribute: ["entity.other.attribute-name"],
  tag: ["entity.name.tag"],
  "tag.doctype": ["meta.tag.metadata.doctype", "entity.name.tag"],
  "tag.component.jsx": ["support.class.component", "entity.name.tag"],
  selector: ["entity.name.tag.css", "entity.name.tag"],
  "selector.class": ["entity.other.attribute-name.class"],
  "selector.id": ["entity.other.attribute-name.id"],
  "selector.pseudo": ["entity.other.attribute-name.pseudo-class"],
  punctuation: ["punctuation"],
  "punctuation.bracket": [
    "meta.brace",
    "punctuation.definition.block",
    "punctuation",
  ],
  // Dots, commas and semicolons are one token here; dots are the most of
  // them, so they set the colour (Darcula's orange commas would paint every dot).
  "punctuation.delimiter": [
    "punctuation.accessor",
    "punctuation.separator",
    "punctuation",
  ],
  "punctuation.list_marker": ["punctuation.definition.list", "markup.list"],
  "punctuation.special": [
    "punctuation.definition.template-expression",
    "punctuation.section.embedded",
  ],
  preproc: ["keyword.control.directive", "meta.preprocessor"],
  title: ["markup.heading", "entity.name.section"],
  emphasis: ["markup.italic"],
  "emphasis.strong": ["markup.bold"],
  link_text: ["string.other.link", "markup.underline.link"],
  link_uri: ["markup.underline.link"],
  "text.literal": ["markup.inline.raw", "markup.raw"],
  "diff.plus": ["markup.inserted"],
  "diff.minus": ["markup.deleted"],
};

function zedStyle(
  color: string | undefined,
  fontStyle = "",
): ThemeSyntaxSettings | undefined {
  const italic = /italic/.test(fontStyle);
  const bold = /bold/.test(fontStyle);
  if (!color && !italic && !bold) return undefined;
  return {
    ...(color ? { color } : {}),
    ...(italic ? { font_style: "italic" } : {}),
    ...(bold ? { font_weight: 700 } : {}),
  };
}

/** `theme` as a Zed theme the Highlights lexers can colour with. */
export function zedThemeFrom(theme: TextmateTheme, name: string): Theme {
  const rules = theme.tokenColors ?? theme.settings ?? [];
  const syntax: Record<string, ThemeSyntaxSettings> = {};
  for (const [token, scopes] of Object.entries(ZED_SCOPES)) {
    const { color, fontStyle } = firstStyle(rules, scopes);
    const style = zedStyle(color, fontStyle);
    if (style) syntax[token] = style;
  }
  const foreground =
    theme.colors?.["editor.foreground"] ?? plainForeground(rules);
  const background = theme.colors?.["editor.background"];
  return {
    name,
    appearance: theme.type === "light" ? "light" : "dark",
    style: {
      ...(foreground
        ? { "editor.foreground": foreground, text: foreground }
        : {}),
      ...(background ? { "editor.background": background, background } : {}),
      syntax,
    },
  };
}

/** Registers a TextMate theme for Shiki and its Zed counterpart for the Highlights lexers. */
export function registerSyntaxTheme(
  name: string,
  load: () => Promise<TextmateTheme>,
) {
  registerCustomTheme(name, load as Parameters<typeof registerCustomTheme>[1]);
  registerCustomTheme(
    name,
    async () => zedThemeFrom(await load(), name),
    "zed",
  );
}
