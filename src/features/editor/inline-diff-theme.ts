import { EditorView } from "@codemirror/view";

const mix = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, var(--code-mix-base, var(--code-background)))`;

/** The changed words' box: the theme's change colour, see-through like the diff view's. */
const emphasis = (color: string) => `rgb(from ${color} r g b / 0.2)`;

/**
 * The inline diff in the diff view's colours (`../diff/diff-theme.ts`), so a
 * change looks the same in the editor as in Changes or a pull request: a
 * whole-row tint for lines added or removed, a box on the words that changed
 * inside them. The merge view's own look, a faint beige wash and underlined
 * words, passed for ordinary code on a dark theme.
 */
export const inlineDiffTheme = EditorView.theme({
  ".cm-deletedChunk": {
    backgroundColor: mix("var(--diff-deletion)", 30),
    paddingLeft: "0",
  },
  ".cm-deletedLine": { padding: "0 12px 0 6px" },
  // Matches the merge view's own selector, which would win otherwise.
  "&.cm-merge-b .cm-changedLine": { backgroundColor: mix("var(--diff-addition)", 30) },
  // The merge view's rules carry its theme classes too, so these need the weight.
  ".cm-changedText": {
    background: `${emphasis("var(--editor-added)")} !important`,
    borderRadius: "2px",
  },
  ".cm-deletedChunk .cm-deletedText": {
    background: `${emphasis("var(--editor-removed)")} !important`,
    borderRadius: "2px",
  },
});
