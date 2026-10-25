import { EditorView } from "@codemirror/view";

const mix = (color: string, amount: number, base = "var(--code-background)") =>
  `color-mix(in srgb, ${color} ${amount}%, ${base})`;

/**
 * The editor's chrome in Relay's palette. Token colours come from the syntax
 * theme separately; the change bars' colours from the `--editor-*` variables
 * the editor sets from it.
 */
export const editorChrome = EditorView.theme({
  "&": {
    flex: "1",
    minHeight: "0",
    height: "100%",
    backgroundColor: "var(--code-background)",
    color: "var(--code-foreground)",
    fontSize: "var(--code-font-size, 12px)",
  },
  "&.cm-focused": { outline: "none" },
  // The page's own rules don't reach into the editor's shadow root, so the
  // caret keeps to them here: still while the window is in the background,
  // steady under reduced motion.
  ":host-context([data-inactive]) & .cm-cursorLayer": { animationPlayState: "paused !important" },
  "@media (prefers-reduced-motion: reduce)": {
    "& .cm-cursorLayer": { animation: "none !important" },
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
  },
  ".cm-content": { caretColor: "var(--code-foreground)", padding: "6px 0" },
  ".cm-line": { padding: "0 12px 0 6px" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--code-foreground)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground": {
    backgroundColor: mix("var(--accent)", 20),
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: mix("var(--accent)", 32),
  },
  ".cm-activeLine": { backgroundColor: mix("var(--code-foreground)", 4) },
  ".cm-selectionMatch": { backgroundColor: mix("var(--accent)", 14) },
  ".cm-searchMatch": {
    backgroundColor: mix("#e8b931", 35),
    outline: `1px solid ${mix("#e8b931", 70)}`,
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: mix("#e8b931", 60),
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: mix("var(--accent)", 22),
    outline: `1px solid ${mix("var(--accent)", 55)}`,
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: mix("var(--danger)", 30),
  },
  ".cm-gutters": {
    backgroundColor: "var(--code-background)",
    color: mix("var(--code-foreground)", 38),
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 4px 0 14px",
    minWidth: "3ch",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: mix("var(--code-foreground)", 80),
  },
  ".cm-foldGutter .cm-gutterElement": {
    width: "14px",
    textAlign: "center",
    opacity: "0",
    transition: "opacity 120ms",
  },
  ".cm-gutters:hover .cm-foldGutter .cm-gutterElement": { opacity: "1" },
  ".cm-foldPlaceholder": {
    backgroundColor: mix("var(--code-foreground)", 10),
    border: "none",
    color: "var(--muted)",
    padding: "0 4px",
    borderRadius: "3px",
  },
  ".cm-change-gutter": { width: "6px" },
  ".cm-change-gutter .cm-gutterElement": { position: "relative" },
  ".cm-change-added, .cm-change-modified": {
    backgroundImage:
      "linear-gradient(var(--editor-change, transparent), var(--editor-change, transparent))",
    backgroundSize: "3px 100%",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "left",
  },
  ".cm-change-added": { "--editor-change": "var(--editor-added)" },
  ".cm-change-modified": { "--editor-change": "var(--editor-modified)" },
  ".cm-change-removed-above-line::before, .cm-change-removed-below-line::after":
    {
      content: '""',
      position: "absolute",
      left: "0",
      width: "6px",
      height: "8px",
      background: "var(--editor-removed)",
      clipPath: "polygon(0 0, 100% 50%, 0 100%)",
      zIndex: "1",
      pointerEvents: "none",
    },
  ".cm-change-removed-above-line::before": { top: "-4px" },
  ".cm-change-removed-below-line::after": { bottom: "-4px" },
  ".cm-panels": {
    backgroundColor: "var(--toolbar)",
    color: "var(--text)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel input, .cm-panel button, .cm-panel label": { fontSize: "12px" },
  ".cm-panel input[type=text], .cm-textfield": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
    padding: "3px 6px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "5px",
  },
  ".cm-tooltip": {
    zIndex: "500",
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "0 6px 24px rgb(0 0 0 / 0.14)",
    overflow: "hidden",
  },
  ".cm-ask-selection": {
    padding: "2px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    color: "var(--muted)",
  },
  ".cm-ask-selection:not(:has(button))": { padding: "4px 8px" },
  ".cm-ask-selection button": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "3px 8px",
    minHeight: "0",
    border: "0",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--text)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-ask-selection button:hover": { backgroundColor: "var(--hover)" },
  ".cm-ask-selection kbd": {
    color: "var(--muted)",
    fontFamily: "inherit",
    fontSize: "11px",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--selected)",
    color: "var(--text)",
  },
  ".cm-diagnostic": { fontFamily: "var(--font-sans)", fontSize: "12px" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--danger)",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy #d3a12b",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-lintRange-info": {
    backgroundImage: "none",
    textDecoration: `underline dotted ${mix("var(--code-foreground)", 50)}`,
    textUnderlineOffset: "3px",
  },
  ".cm-definition-link": {
    textDecoration: "underline",
    cursor: "pointer",
  },
});
