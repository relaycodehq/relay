import { ViewPlugin, getTooltip, showTooltip, tooltips, type EditorView } from "@codemirror/view";

/**
 * The editor's own stylesheets, shared with the page while it lives. They're
 * constructed sheets in its shadow root, and the page can adopt the same
 * objects, so the tooltips outside still look like the editor's.
 */
const shareStyles = ViewPlugin.fromClass(
  class {
    private shared: CSSStyleSheet[] = [];
    constructor(private view: EditorView) {
      this.share();
    }
    update() {
      this.share();
    }
    private share() {
      const { root } = this.view;
      if (root === document) return;
      const fresh = root.adoptedStyleSheets.filter((sheet) => !this.shared.includes(sheet));
      if (!fresh.length) return;
      this.shared.push(...fresh);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...fresh];
    }
    destroy() {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => !this.shared.includes(sheet),
      );
    }
  },
);

/**
 * Keeps a hover card open when the pointer goes from it back into the editor.
 * Seen from the page, that leave names the editor's shadow host rather than the
 * line under the pointer, and CodeMirror closes the card for anything outside it.
 */
const backFromCard = ViewPlugin.define((view) => {
  const onLeave = (event: MouseEvent) => {
    if (!(view.root instanceof ShadowRoot) || event.relatedTarget !== view.root.host) return;
    const ours = view.state
      .facet(showTooltip)
      .some((tooltip) => tooltip && getTooltip(view, tooltip)?.dom === event.target);
    if (ours) event.stopPropagation();
  };
  document.addEventListener("mouseleave", onLeave, true);
  return { destroy: () => document.removeEventListener("mouseleave", onLeave, true) };
});

/**
 * Tooltips on the page rather than in the editor's shadow root: hover docs and
 * completion cards render an answer's Markdown, whose styles are the page's.
 */
export const outsideTooltips = () => [tooltips({ parent: document.body }), shareStyles, backFromCard];
