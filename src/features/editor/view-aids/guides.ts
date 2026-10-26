import { BlockType, EditorView, RectangleMarker, layer, type BlockInfo, type ViewUpdate } from "@codemirror/view";
import { guideColumns } from "./indent-levels";

/** PhpStorm's right margin: where a line should end, at its default width. */
const MARGIN_COLUMN = 120;

/** Where the document's origin is on screen, as the editor's layers measure from it. */
function originOf(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return { left: rect.left - view.scrollDOM.scrollLeft, top: rect.top - view.scrollDOM.scrollTop };
}

/** The screen x of a column, from where the lines' text starts. */
function columnX(view: EditorView) {
  const content = view.contentDOM.getBoundingClientRect().left;
  const firstLine = view.contentDOM.querySelector(".cm-line");
  const padding = firstLine ? parseFloat(getComputedStyle(firstLine).paddingLeft) : 0;
  return (column: number) => content + padding + column * view.defaultCharacterWidth;
}

/** A line's text, without the hints drawn over or under it as their own blocks. */
function textOf(block: BlockInfo) {
  const parts = Array.isArray(block.type) ? block.type : [block];
  return parts.find((part) => part.type === BlockType.Text);
}

/**
 * Indent guides, one thin line per level a block's lines sit inside, and the
 * right margin. A guide runs unbroken through the block's empty lines and
 * the hints between its lines.
 */
function guideMarkers(view: EditorView) {
  const { state } = view;
  const origin = originOf(view);
  const x = columnX(view);
  const markers: RectangleMarker[] = [];
  const lines = view.viewportLineBlocks.filter((block) => textOf(block));
  if (!lines.length) return markers;
  const first = state.doc.lineAt(lines[0].from).number;
  const last = state.doc.lineAt(lines[lines.length - 1].to).number;
  const columns = guideColumns(state.doc, first, last, state.tabSize);
  /** Where each guide that's still running started, by column. */
  const open = new Map<number, number>();
  const close = (column: number, bottom: number) => {
    const top = open.get(column)!;
    open.delete(column);
    markers.push(new RectangleMarker("cm-indent-guide", x(column) - origin.left, top, 1, bottom - top));
  };
  let bottom = 0;
  const y = (height: number) => view.documentTop + height - origin.top;
  for (const block of lines) {
    // Column 0 has no guide: the gutter's edge already runs down the whole file there.
    const here = new Set(columns[state.doc.lineAt(block.from).number - first].filter((column) => column > 0));
    // A guide ends above the hints over a line it doesn't reach, and starts at the line's own text.
    for (const column of [...open.keys()]) if (!here.has(column)) close(column, y(block.top));
    for (const column of here) if (!open.has(column)) open.set(column, y(textOf(block)!.top));
    bottom = y(block.bottom);
  }
  for (const column of [...open.keys()]) close(column, bottom);
  const height = view.contentDOM.getBoundingClientRect().height;
  markers.push(new RectangleMarker("cm-margin-guide", x(MARGIN_COLUMN) - origin.left, 0, 1, height));
  return markers;
}

const guidesTheme = EditorView.baseTheme({
  ".cm-indent-guide": {
    backgroundColor: "color-mix(in srgb, var(--code-foreground) 11%, transparent)",
  },
  ".cm-margin-guide": {
    backgroundColor: "color-mix(in srgb, var(--code-foreground) 9%, transparent)",
  },
});

/** PhpStorm's indent guides and right margin, drawn under the text. */
export const guides = [
  layer({
    above: false,
    class: "cm-guides",
    update: (update: ViewUpdate) =>
      update.docChanged || update.viewportChanged || update.geometryChanged,
    markers: guideMarkers,
  }),
  guidesTheme,
];
