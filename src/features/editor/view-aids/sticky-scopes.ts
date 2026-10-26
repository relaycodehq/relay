import { highlightingFor, syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";

/** At most this many enclosing scopes stay pinned, the outermost first. */
const MAX_STICKY = 4;

/** Nodes whose first line names a scope: classes, functions, methods and their kin across languages. */
const SCOPE =
  /^(Class|Interface|Enum|Function|Method|Struct|Impl|Trait|Mod|Module|Namespace|Object)(Declaration|Definition|Item)$/;

/** A scope pinned over the code: its first line, and where it ends. */
export type Scope = { head: Line; end: number };

/**
 * The scopes `line` is inside that start above it, the outermost first: what
 * PhpStorm keeps pinned at the top while you scroll.
 */
export function enclosingScopes(state: EditorState, line: Line): Scope[] {
  const found: Scope[] = [];
  const tree = syntaxTree(state);
  for (let node = tree.resolveInner(line.from, 1).node; node.parent; node = node.parent) {
    if (!SCOPE.test(node.name)) continue;
    const head = state.doc.lineAt(node.from);
    const seen = found.some((scope) => scope.head.number === head.number);
    if (head.number < line.number && !seen) found.unshift({ head, end: node.to });
  }
  return found.slice(-MAX_STICKY);
}

/** A line as the editor colours it, from the file's own syntax tree. */
function colouredLine(state: EditorState, line: Line) {
  const code = document.createElement("span");
  code.className = "cm-sticky-code";
  let at = line.from;
  const add = (to: number, className?: string) => {
    if (to <= at) return;
    const span = code.appendChild(document.createElement("span"));
    if (className) span.className = className;
    span.textContent = state.sliceDoc(at, to);
    at = to;
  };
  highlightTree(
    syntaxTree(state),
    { style: (tags) => highlightingFor(state, tags) },
    (from, to, className) => {
      add(from);
      add(to, className);
    },
    line.from,
    line.to,
  );
  add(line.to);
  return code;
}

/**
 * The line as the editor draws it, hints and extra colours included, while it's
 * drawn; a header reaching the pinned lines always is. Otherwise from the tree.
 */
function shownLine(view: EditorView, line: Line) {
  const drawn = line.from >= view.viewport.from && line.to <= view.viewport.to;
  const { node } = view.domAtPos(line.from);
  const element = node instanceof Element ? node : node.parentElement;
  const lineDom = drawn ? element?.closest(".cm-line") : null;
  if (!lineDom) return colouredLine(view.state, line);
  const code = lineDom.cloneNode(true) as HTMLElement;
  code.className = "cm-sticky-code";
  return code;
}

/**
 * Where the pinned lines go: under the editor's panels, their numbers and code
 * lined up with the editor's, the code cut off where the gutter ends as the
 * editor's own is when it scrolls sideways.
 */
type StickyPlace = { top: number; numbers: number; gutter: number; code: number; lineHeight: number };

/** A pinned line and how far down the pinned area it sits; less than its slot once its scope's end pushes it up. */
type Pinned = { head: Line; top: number };

class StickyScopes {
  readonly dom = document.createElement("div");
  private shown = "";
  /** The rows drawn, by line number, so a scroll only moves them. */
  private rows = new Map<number, HTMLElement>();
  /**
   * Where the rows go, read again only when the editor's layout moves or it
   * scrolls sideways: a scroll down changes none of it.
   */
  private place: StickyPlace | undefined;
  private placed = "";
  private scrolledLeft = 0;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-sticky";
    this.dom.setAttribute("aria-hidden", "true");
    // The editor sets the tab size on its content only, and the rows sit outside it.
    this.dom.style.tabSize = String(view.state.tabSize);
    view.dom.appendChild(this.dom);
    this.measure();
  }

  update(update: ViewUpdate) {
    if (update.state.tabSize !== update.startState.tabSize)
      this.dom.style.tabSize = String(update.state.tabSize);
    if (update.geometryChanged) this.place = undefined;
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.measure();
  }

  scrolled() {
    if (this.view.scrollDOM.scrollLeft !== this.scrolledLeft) this.place = undefined;
    this.measure();
  }

  destroy() {
    this.dom.remove();
  }

  measure() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const place = this.place ?? this.readPlace(view);
        const { lineHeight } = place;
        // Where the screen's top edge is in the document.
        const shownFrom = view.scrollDOM.scrollTop - view.documentPadding.top;
        // The scopes of the line just under the next free slot, which grow as it goes deeper.
        // A header gets pinned as soon as it reaches the slot, so it stops there instead of
        // sliding under the pinned lines and popping back out.
        let scopes: Scope[] = [];
        for (let pass = 0; pass <= MAX_STICKY; pass++) {
          const block = view.lineBlockAtHeight(shownFrom + (scopes.length + 1) * lineHeight);
          const next = enclosingScopes(view.state, view.state.doc.lineAt(block.from));
          if (next.length <= scopes.length) break;
          scopes = next;
        }
        // Once a scope's last line reaches its pinned line, it pushes that line up and out.
        const pinned = scopes.map(({ head, end }, i): Pinned => {
          const endTop = view.lineBlockAt(end).top - shownFrom;
          return { head, top: Math.min(i * lineHeight, endTop - lineHeight) };
        });
        return { pinned, place };
      },
      write: ({ pinned, place }) => this.draw(pinned, place),
    });
  }

  private readPlace(view: EditorView): StickyPlace {
    const scroller = view.scrollDOM.getBoundingClientRect();
    const editor = view.dom.getBoundingClientRect();
    const numbers = view.dom.querySelector(".cm-lineNumbers")?.getBoundingClientRect();
    const gutters = view.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
    this.scrolledLeft = view.scrollDOM.scrollLeft;
    this.place = {
      top: scroller.top - editor.top,
      numbers: numbers ? numbers.right - editor.left : 0,
      gutter: gutters ? gutters.right - editor.left : 0,
      code: view.contentDOM.getBoundingClientRect().left - editor.left,
      lineHeight: view.defaultLineHeight,
    };
    return this.place;
  }

  private draw(pinned: Pinned[], place: StickyPlace) {
    const placed = `${place.top}/${place.numbers}/${place.gutter}/${place.code}/${place.lineHeight}`;
    let key = placed;
    for (const p of pinned) key += `|${p.head.number}:${p.top}:${p.head.text}`;
    if (key === this.shown) return;
    this.shown = key;
    const shown = pinned.filter((p) => p.top + place.lineHeight > 0);
    this.dom.hidden = !shown.length;
    this.dom.style.height = `${Math.max(0, ...shown.map((p) => p.top + place.lineHeight))}px`;
    if (placed !== this.placed) {
      this.placed = placed;
      this.dom.style.top = `${place.top}px`;
      this.dom.style.setProperty("--sticky-numbers", `${place.numbers}px`);
      this.dom.style.setProperty("--sticky-gutter", `${place.gutter}px`);
      this.dom.style.setProperty("--sticky-code", `${place.code}px`);
      this.dom.style.setProperty("--sticky-line-height", `${place.lineHeight}px`);
    }
    const kept = new Map<number, HTMLElement>();
    shown.forEach(({ head, top }, i) => {
      const old = this.rows.get(head.number);
      const row = old?.dataset.text === head.text ? old : this.row(head);
      row.style.transform = `translateY(${top}px)`;
      // An outer line stays over an inner one sliding up under it.
      row.style.zIndex = String(MAX_STICKY - i);
      kept.set(head.number, row);
    });
    for (const [number, row] of this.rows) if (kept.get(number) !== row) row.remove();
    for (const row of kept.values()) if (!row.isConnected) this.dom.appendChild(row);
    this.rows = kept;
  }

  private row(line: Line) {
    const row = document.createElement("div");
    row.className = "cm-sticky-line";
    row.dataset.text = line.text;
    const number = row.appendChild(document.createElement("span"));
    number.className = "cm-sticky-number";
    number.textContent = String(line.number);
    const text = row.appendChild(document.createElement("div"));
    text.className = "cm-sticky-text";
    text.appendChild(shownLine(this.view, line));
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // A row is kept while its line reads the same, though edits above move where it starts.
      const { doc } = this.view.state;
      const now = doc.line(Math.min(line.number, doc.lines));
      this.view.dispatch({
        selection: { anchor: now.from + (now.text.length - now.text.trimStart().length) },
        effects: EditorView.scrollIntoView(now.from, { y: "start" }),
        userEvent: "select",
      });
      this.view.focus();
    });
    return row;
  }
}

const stickyTheme = EditorView.baseTheme({
  ".cm-sticky": {
    position: "absolute",
    fontFamily: "var(--font-mono)",
    left: "0",
    // Clear of the minimap, when there is one.
    right: "var(--cm-rail, 0px)",
    zIndex: "210",
    backgroundColor: "var(--code-solid, var(--code-background))",
    overflow: "hidden",
    boxShadow: "0 1px 0 color-mix(in srgb, var(--code-foreground) 14%, transparent)",
    cursor: "pointer",
  },
  ".cm-sticky-line": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    backgroundColor: "var(--code-solid, var(--code-background))",
    height: "var(--sticky-line-height)",
    lineHeight: "var(--sticky-line-height)",
    whiteSpace: "pre",
    overflow: "hidden",
  },
  ".cm-sticky-number": {
    position: "absolute",
    left: "0",
    boxSizing: "border-box",
    width: "var(--sticky-numbers)",
    paddingRight: "4px",
    textAlign: "right",
    color: "color-mix(in srgb, var(--code-foreground) 38%, transparent)",
  },
  ".cm-sticky-text": {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "var(--sticky-gutter)",
    right: "0",
    overflow: "hidden",
  },
  ".cm-sticky-code": {
    position: "absolute",
    left: "calc(var(--sticky-code) - var(--sticky-gutter))",
    paddingLeft: "6px",
  },
});

/** PhpStorm's sticky lines: the class and method you're scrolled into stay pinned over the code. */
export const stickyScopes = [ViewPlugin.fromClass(StickyScopes, { eventObservers: { scroll() { this.scrolled(); } } }), stickyTheme];
