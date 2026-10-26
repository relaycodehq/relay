import { EditorView } from "@codemirror/view";

const mix = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, var(--code-background))`;

/**
 * The two sides of the comparison in Relay's palette: the old version's
 * changes in the deletion colour, the current text's in the addition colour.
 * The host's editor theme and highlighting, passed as `extensions`, win over it.
 */
export const historyDiffTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--code-background)",
    color: "var(--code-foreground)",
    fontSize: "var(--code-font-size, 12px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { padding: "6px 0" },
  ".cm-line": { padding: "0 12px 0 6px" },
  ".cm-gutters": {
    backgroundColor: "var(--code-background)",
    color: mix("var(--code-foreground)", 38),
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 12px" },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    backgroundColor: "var(--diff-deletion)",
  },
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "var(--diff-addition)",
  },
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
    background: mix("var(--danger)", 38),
  },
  "&.cm-merge-b .cm-changedText": {
    background: mix("#3fb950", 38),
  },
  "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
    background: "var(--danger)",
  },
  "&.cm-merge-b .cm-changedLineGutter": { background: "#3fb950" },
  ".cm-collapsedLines": {
    color: "var(--muted)",
    background: mix("var(--code-foreground)", 6),
    fontFamily: "var(--font-sans)",
    fontSize: "11px",
  },
});
