import type { Root } from "mdast";
import type { Plugin } from "unified";

/**
 * What someone typed reads as typed: of the block syntax only fences and
 * quotes (the composer's quote pill sends one) are kept, and of the inline
 * syntax only code spans and links. A `#` comment, a `-` line, `*args` or
 * `~/src and ~/dist` stay text.
 */
export const typedSyntax: Plugin<[], Root> = function () {
  // The key remark-parse reads; its types aren't a direct dependency.
  const data = this.data() as { micromarkExtensions?: object[] };
  (data.micromarkExtensions ??= []).push({
    disable: {
      null: [
        "headingAtx",
        "setextUnderline",
        "list",
        "thematicBreak",
        "codeIndented",
        "htmlFlow",
        "htmlText",
        "definition",
        "table",
        "attention",
        "strikethrough",
        "characterEscape",
        "characterReference",
        "hardBreakEscape",
      ],
    },
  });
};

const typedFence =
  /((?<![^\n])[ \t]{0,3}```[\s\S]*?(?:\n[ \t]{0,3}```[^\n]*|$))/;

/** The parser drops the spaces a line starts with; no-break ones survive it. */
export const keepIndent = (text: string) =>
  text
    .split(typedFence)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/^[ \t]+(?=\S)/gm, (indent) =>
            indent.replace(/\t/g, "    ").replace(/ /g, "\u00a0"),
          ),
    )
    .join("");
