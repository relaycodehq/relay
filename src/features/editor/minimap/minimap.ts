import { setDiagnosticsEffect } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { changesSource } from "../change-popup/file-changes";
import { CHAR_PX, lineDashes, paintDashes } from "./minimap-paint";
import { bandAround, bandHolds, lineAtMinimap, mapLineHeight, minimapWindow, type Band } from "./minimap-window";
import { overviewMarks, stripeSpan, type OverviewMark } from "./overview-marks";

/** The minimap: a page in the bottom corner, A4's shape whatever the editor's height. */
const PAGE_WIDTH = 96;
const PAGE_HEIGHT = Math.round(PAGE_WIDTH * Math.SQRT2);
/** How far the page sits from the editor's corner, clear of the sideways scrollbar. */
const PAGE_INSET = 10;
/** The stripe of marks down the right edge. */
const STRIPE_PX = 8;
/** How long the minimap stays after scrolling stops or the pointer leaves it. */
const LINGER_MS = 1200;

/** Where the page and the stripe go: under the editor's panels, the stripe the editor's height, the page at most its own. */
type Place = ReturnType<typeof minimapWindow> & { top: number; height: number; pageHeight: number; lines: number };

/**
 * VS Code's minimap with PhpStorm's stripe beside it: the file drawn small,
 * a dash for each run of code in its colour, the screen's part of it shown
 * by a slider to drag; and the whole file's changes and problems marked on a
 * thin stripe, each a click away. The stripe always shows; the page comes up
 * in the bottom corner while you scroll or with the pointer on the stripe, and
 * stands in for the scrollbar.
 *
 * Kept cheap: a hidden page paints nothing, and a shown one paints a band of
 * lines around what it shows once, then slides it as the editor scrolls.
 */
class Minimap {
  readonly dom = document.createElement("div");
  private readonly map = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly slider = document.createElement("div");
  private readonly stripe = document.createElement("div");
  private place: Place | undefined;
  /** What the canvas holds: which lines, of which text, painted how. */
  private painted: { band: Band; doc: Text; tree: unknown; lineHeight: number; ratio: number } | undefined;
  private repaintTimer = 0;
  /** The page's frame as last written, so a scroll doesn't restyle it. */
  private framed = "";
  /** The stripe's size the marks were last read for, and what they were. */
  private marksFrame = "";
  private marked = "";
  /** Highlight classes' colours, read from the editor's own styles. */
  private colours = new Map<string, string>();
  private readonly probe = document.createElement("span");
  private shown = false;
  private pointerOver = false;
  private dragging = false;
  private hideTimer = 0;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-minimap";
    this.canvas.className = "cm-minimap-code";
    this.slider.className = "cm-minimap-slider";
    this.stripe.className = "cm-minimap-stripe";
    this.map.className = "cm-minimap-map";
    this.map.append(this.canvas, this.slider);
    this.dom.append(this.map, this.stripe);
    this.probe.className = "cm-minimap-probe";
    this.dom.append(this.probe);
    view.dom.appendChild(this.dom);
    this.map.addEventListener("mousedown", this.drag);
    this.dom.addEventListener("mouseenter", () => {
      this.pointerOver = true;
      this.show(true);
    });
    this.dom.addEventListener("mouseleave", () => {
      this.pointerOver = false;
      this.hideLater();
    });
    view.scrollDOM.addEventListener("wheel", this.wheeled, { passive: true });
    this.measure();
  }

  /**
   * Scrolling by hand brings the page up for a moment. The editor scrolling
   * itself, after the caret as you type, doesn't.
   */
  private readonly wheeled = (event: WheelEvent) => {
    if (!event.deltaY) return;
    this.show(true);
    this.hideLater();
  };

  /** While the page shows, a scroll moves its slider and slides its band. */
  scrolled() {
    if (this.shown) this.measure();
  }

  private show(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.dom.classList.toggle("cm-minimap-shown", shown);
    if (!shown) return;
    // A hidden page isn't painted, so what it holds may be of older text.
    if (this.painted?.doc !== this.view.state.doc) this.painted = undefined;
    this.measure();
  }

  private hideLater() {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (!this.pointerOver && !this.dragging) this.show(false);
    }, LINGER_MS);
  }

  update(update: ViewUpdate) {
    if (update.transactions.some((tr) => tr.reconfigured)) this.colours.clear();
    const parsed = syntaxTree(update.state) !== syntaxTree(update.startState);
    const changesMoved = changesSource(update.state) !== changesSource(update.startState);
    const problemsMoved = update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
    if (update.docChanged || update.viewportChanged || update.geometryChanged || parsed || changesMoved || problemsMoved)
      this.measure(changesMoved || problemsMoved || update.docChanged);
  }

  destroy() {
    window.clearTimeout(this.hideTimer);
    window.clearTimeout(this.repaintTimer);
    this.view.scrollDOM.removeEventListener("wheel", this.wheeled);
    this.dom.remove();
  }

  measure(marksMoved = false) {
    if (marksMoved) this.marksFrame = "";
    this.view.requestMeasure({
      key: this,
      read: (view): Place => {
        const scroller = view.scrollDOM;
        const { scrollTop, clientHeight, scrollHeight } = scroller;
        const lineAt = (height: number) => view.state.doc.lineAt(view.lineBlockAtHeight(height).from).number;
        const scrollable = scrollHeight - clientHeight;
        const lines = view.state.doc.lines;
        const pageHeight = Math.max(0, Math.min(PAGE_HEIGHT, clientHeight - 2 * PAGE_INSET));
        return {
          ...minimapWindow({
            lines,
            mapHeight: pageHeight,
            lineHeight: mapLineHeight(lines, pageHeight),
            scrolled: scrollable > 0 ? scrollTop / scrollable : 0,
            topLine: lineAt(scrollTop - view.documentPadding.top),
            bottomLine: lineAt(scrollTop + clientHeight - view.documentPadding.top - 1),
          }),
          top: scroller.offsetTop,
          height: clientHeight,
          pageHeight,
          lines,
        };
      },
      write: (place) => this.draw(place),
    });
  }

  private draw(place: Place) {
    this.place = place;
    const frame = `${place.top}/${place.height}/${place.pageHeight}`;
    if (frame !== this.framed) {
      this.framed = frame;
      this.dom.style.top = `${place.top}px`;
      this.dom.style.height = `${place.height}px`;
      this.map.style.height = `${place.pageHeight}px`;
    }
    if (this.shown) {
      this.slider.style.transform = `translateY(${place.sliderTop}px)`;
      this.slider.style.height = `${place.sliderHeight}px`;
      this.paintCode(place);
    }
    this.paintMarks(place);
  }

  private paintCode(place: Place) {
    const { state } = this.view;
    const was = this.painted;
    const sameScale = was && was.lineHeight === place.lineHeight && was.ratio === devicePixelRatio;
    if (!was || !sameScale || !bandHolds(was.band, place.firstLine, place.lastLine)) {
      this.paintBand(bandAround(place.firstLine, place.lastLine, place.lines), place);
      return;
    }
    this.slideBand(was.band, place);
    // Text or colours changed under a band still in place: repainted once typing pauses.
    if (was.doc !== state.doc || was.tree !== syntaxTree(state)) this.repaintSoon();
  }

  private paintBand(band: Band, place: Place) {
    const { state } = this.view;
    const ratio = devicePixelRatio;
    this.painted = { band, doc: state.doc, tree: syntaxTree(state), lineHeight: place.lineHeight, ratio };
    const height = (band.last - band.first + 1) * place.lineHeight;
    this.canvas.width = PAGE_WIDTH * ratio;
    this.canvas.height = Math.ceil(height * ratio);
    this.canvas.style.height = `${height}px`;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    const columns = Math.floor(PAGE_WIDTH / CHAR_PX);
    const dashes = lineDashes(state, band.first, band.last, columns);
    paintDashes(context, dashes, 0, place.lineHeight, columns, (classes) => this.colourOf(classes));
    this.slideBand(band, place);
  }

  private slideBand(band: Band, place: Place) {
    this.canvas.style.transform = `translateY(${(band.first - 1) * place.lineHeight - place.offset}px)`;
  }

  private repaintSoon() {
    if (this.repaintTimer) return;
    this.repaintTimer = window.setTimeout(() => {
      this.repaintTimer = 0;
      this.painted = undefined;
      if (this.shown) this.measure();
    }, 200);
  }

  private colourOf(classes: string) {
    let colour = this.colours.get(classes);
    if (colour === undefined) {
      this.probe.className = `cm-minimap-probe ${classes}`;
      colour = getComputedStyle(this.probe).color;
      this.colours.set(classes, colour);
    }
    return colour;
  }

  private paintMarks(place: Place) {
    // Marks move only with the text, its changes, its problems or the stripe's height; not with a scroll.
    const frame = `${place.height}/${place.lines}`;
    if (frame === this.marksFrame) return;
    const marks = overviewMarks(this.view.state);
    if (!marks) return; // read again once the changes are worked out
    this.marksFrame = frame;
    // Typing inside a change keeps its marks where they were: the stripe isn't rebuilt.
    const key = `${frame}|${marks.map((m) => `${m.kind}${m.line}+${m.lines}${m.label}`).join()}`;
    if (key === this.marked) return;
    this.marked = key;
    this.stripe.replaceChildren(...marks.map((mark) => this.markDom(mark, place)));
  }

  private markDom(mark: OverviewMark, place: Place) {
    const dom = document.createElement("div");
    dom.className = `cm-minimap-mark cm-minimap-${mark.kind}`;
    const span = stripeSpan(mark, place.lines, place.height);
    dom.style.top = `${span.top}px`;
    dom.style.height = `${span.height}px`;
    dom.title = mark.label;
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const line = this.view.state.doc.line(Math.min(mark.line, this.view.state.doc.lines));
      this.view.dispatch({
        selection: EditorSelection.cursor(line.from),
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        userEvent: "select",
      });
      this.view.focus();
    });
    return dom;
  }

  /** Pressing on the minimap brings the line under the pointer to the middle of the screen, and keeps doing so while it drags. */
  private readonly drag = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const follow = (move: MouseEvent) => {
      const place = this.place;
      if (!place) return;
      // From inside the page's border: the canvas in it is shifted by the scroll already.
      const y = move.clientY - this.map.getBoundingClientRect().top - this.map.clientTop;
      const line = this.view.state.doc.line(lineAtMinimap(y, place.offset, place.lineHeight, place.lines));
      this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    };
    const stop = () => {
      window.removeEventListener("mousemove", follow);
      window.removeEventListener("mouseup", stop);
      this.dragging = false;
      this.dom.classList.remove("cm-minimap-dragging");
      this.hideLater();
    };
    follow(event);
    this.dragging = true;
    this.dom.classList.add("cm-minimap-dragging");
    window.addEventListener("mousemove", follow);
    window.addEventListener("mouseup", stop);
  };
}

const minimapTheme = EditorView.baseTheme({
  "&": { "--cm-rail": `${STRIPE_PX}px` },
  // Only the stripe takes room; the map comes up over the code.
  ".cm-scroller": { marginRight: "var(--cm-rail)" },
  // The map's slider is the scrollbar.
  ".cm-scroller::-webkit-scrollbar:vertical": { width: "0" },
  ".cm-minimap": {
    position: "absolute",
    right: "0",
    width: `${PAGE_WIDTH + PAGE_INSET + STRIPE_PX}px`,
    zIndex: "220",
    pointerEvents: "none",
    cursor: "default",
  },
  ".cm-minimap-map": {
    position: "absolute",
    bottom: `${PAGE_INSET}px`,
    left: "0",
    width: `${PAGE_WIDTH}px`,
    overflow: "hidden",
    borderRadius: "6px",
    border: "1px solid color-mix(in srgb, var(--code-foreground) 12%, transparent)",
    // Nearly solid rather than blurred: a blur behind it redraws with every scrolled frame.
    backgroundColor: "color-mix(in srgb, var(--code-solid, var(--code-background)) 97%, transparent)",
    boxShadow: "0 6px 18px #0004",
    opacity: "0",
    transform: "translateY(3px)",
    transition: "opacity 160ms, transform 160ms",
  },
  ".cm-minimap-shown .cm-minimap-map": { opacity: "1", transform: "none", pointerEvents: "auto" },
  ".cm-minimap-code": {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    opacity: "0.55",
  },
  ".cm-minimap-slider": {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    backgroundColor: "color-mix(in srgb, var(--code-foreground) 9%, transparent)",
    transition: "background-color 120ms",
  },
  ".cm-minimap-map:hover .cm-minimap-slider, .cm-minimap-dragging .cm-minimap-slider": {
    backgroundColor: "color-mix(in srgb, var(--code-foreground) 15%, transparent)",
  },
  ".cm-minimap-stripe": {
    position: "absolute",
    top: "0",
    bottom: "0",
    right: "0",
    width: `${STRIPE_PX}px`,
    pointerEvents: "auto",
  },
  ".cm-minimap-mark": {
    position: "absolute",
    left: "2px",
    right: "2px",
    borderRadius: "1px",
    cursor: "pointer",
  },
  ".cm-minimap-added": { backgroundColor: "color-mix(in srgb, var(--editor-added) 70%, transparent)" },
  ".cm-minimap-modified": { backgroundColor: "color-mix(in srgb, var(--editor-modified) 70%, transparent)" },
  ".cm-minimap-removed": { backgroundColor: "color-mix(in srgb, var(--editor-removed) 70%, transparent)" },
  ".cm-minimap-warning": { backgroundColor: "#d3a12b", left: "1px", right: "1px" },
  ".cm-minimap-error": { backgroundColor: "var(--danger)", left: "1px", right: "1px" },
  ".cm-minimap-probe": { position: "absolute", visibility: "hidden", pointerEvents: "none" },
});

/** A map of the file and its marks down the editor's right side. */
export const minimap = [ViewPlugin.fromClass(Minimap, { eventObservers: { scroll() { this.scrolled(); } } }), minimapTheme];
