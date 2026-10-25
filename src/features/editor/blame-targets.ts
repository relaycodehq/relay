import { ViewPlugin } from "@codemirror/view";

/**
 * Line blame finds the line under the pointer by the number its gutter cell
 * carries, but CodeMirror's line numbers are only text. This copies each
 * number into a data attribute.
 */
export const blameTargets = ViewPlugin.define((view) => {
  const mark = () =>
    view.requestMeasure({
      read: () => view.dom.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      write: (cells) => {
        for (const cell of cells) {
          const text = cell.textContent ?? "";
          if (/^\d+$/.test(text) && cell.getAttribute("data-column-number") !== text)
            cell.setAttribute("data-column-number", text);
        }
      },
    });
  mark();
  return { update: mark };
});
