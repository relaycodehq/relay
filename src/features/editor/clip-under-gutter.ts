import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// The layers are empty boxes at the scroll origin, so only their left side
// clips; the others reach far enough out not to.
const far = "-100000px";

/** How far the code is clipped from its left edge: how far it's scrolled sideways under the line numbers. */
const setClip = StateEffect.define<number>();

const clipLeft = StateField.define<number>({
  create: () => 0,
  update: (left, tr) => tr.effects.reduce((at, effect) => (effect.is(setClip) ? effect.value : at), left),
});

/**
 * Over frosted glass the line numbers are see-through, so code scrolled
 * sideways under them would show. The code and its selection and caret are
 * clipped where the line numbers end instead. Where the line numbers are
 * solid nothing is done, and the clip is never set through a variable every
 * line inherits: that restyles the whole file on each sideways scroll.
 */
const clipEdge = ViewPlugin.fromClass(
  class {
    /** What was last written, so a scroll that moves neither restyles nothing. */
    private written = "";
    private pending = 0;
    /** Whether the line numbers are see-through, read again only when the look may have changed: not on every scroll. */
    private seeThrough: boolean | undefined;
    /** Frosted glass is switched on the root, which the editor doesn't hear of. */
    private readonly glass = new MutationObserver(() => {
      this.seeThrough = undefined;
      this.measure();
    });

    constructor(readonly view: EditorView) {
      this.glass.observe(document.documentElement, { attributeFilter: ["data-glass", "data-glass-chat"] });
      this.measure();
    }

    update(update: ViewUpdate) {
      if (!update.geometryChanged) return;
      this.seeThrough = undefined;
      this.measure();
    }

    destroy() {
      this.glass.disconnect();
      cancelAnimationFrame(this.pending);
    }

    measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => ({
          seeThrough: (this.seeThrough ??=
            getComputedStyle(view.dom).getPropertyValue("--code-gutter-background").trim() === "transparent"),
          scrolled: view.scrollDOM.scrollLeft,
          codeStart: view.contentDOM.offsetLeft,
        }),
        write: ({ seeThrough, scrolled, codeStart }, view) => {
          const key = seeThrough ? `${scrolled}/${codeStart}` : "solid";
          if (key === this.written) return;
          this.written = key;
          const layerClip = seeThrough ? `inset(${far} ${far} ${far} ${scrolled + codeStart}px)` : "";
          for (const layer of view.scrollDOM.querySelectorAll<HTMLElement>(":scope > .cm-layer"))
            layer.style.clipPath = layerClip;
          // The code's own attributes go through the editor, which watches them; a frame later is soon enough.
          const left = seeThrough ? scrolled : 0;
          cancelAnimationFrame(this.pending);
          if (view.state.field(clipLeft) !== left)
            this.pending = requestAnimationFrame(() => view.dispatch({ effects: setClip.of(left) }));
        },
      });
    }
  },
  {
    eventObservers: {
      scroll() {
        this.measure();
      },
    },
  },
);

const contentClip = EditorView.contentAttributes.compute([clipLeft], (state): Record<string, string> => {
  const left = state.field(clipLeft);
  return left ? { style: `clip-path: inset(0 0 0 ${left}px)` } : {};
});

export const clipUnderGutter = [clipLeft, contentClip, clipEdge];
