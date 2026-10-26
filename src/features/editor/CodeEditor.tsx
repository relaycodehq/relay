import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Extension, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { loadLanguage } from "../../lib/code-languages";
import { moveCaretTo } from "./caret";
import type { FileDocument } from "./documents";
import { shadowMount } from "./shadow-mount";
import { slots } from "./setup";

type SlotName = keyof typeof slots;
export type SlotValues = Partial<Record<Exclude<SlotName, "language">, Extension>>;

/** Fills `doc`'s slots with what this view gives them, where they differ. */
function reconfigure(view: EditorView, values: SlotValues) {
  const effects: StateEffect<unknown>[] = [];
  for (const [name, value] of Object.entries(values) as [SlotName, Extension][])
    if (slots[name].get(view.state) !== value)
      effects.push(slots[name].reconfigure(value));
  if (effects.length) view.dispatch({ effects });
}

/**
 * Puts the caret where the document was asked to reveal it, or else the view
 * back where it was scrolled to when it was last shown.
 */
function restorePlace(view: EditorView, doc: FileDocument) {
  doc.revealInView = (line, column) => {
    moveCaretTo(view, line, column);
    view.focus();
  };
  const pending = doc.pendingReveal;
  doc.pendingReveal = undefined;
  if (pending) return moveCaretTo(view, pending.line, pending.column);
  if (!doc.scroll) return;
  const { top, left } = doc.scroll;
  view.requestMeasure({
    read: () => {},
    write: () => {
      view.scrollDOM.scrollTop = top;
      view.scrollDOM.scrollLeft = left;
    },
  });
}

/**
 * One CodeMirror view showing `doc`. The view swaps documents rather than
 * being rebuilt, and a document carries its undo history, carets and scroll
 * from view to view. `slots` are this view's say in the document's state:
 * the theme, change bars, symbol actions and the like.
 */
/** Remembers where the view was scrolled, for the document's next view. */
function keepScroll(view: EditorView, doc: FileDocument) {
  doc.scroll = { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft };
}

export function CodeEditor({
  doc,
  slots: values,
  autoFocus = true,
  onView,
}: {
  doc: FileDocument;
  slots: SlotValues;
  autoFocus?: boolean;
  /** The view, once it shows `doc`, and undefined when it stops. */
  onView?: (view: EditorView | undefined) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView>();
  const shown = useRef<FileDocument | undefined>(undefined);
  const latest = useRef(values);
  latest.current = values;
  useLayoutEffect(() => {
    const next = new EditorView({
      root: shadowMount(host.current!),
      parent: shadowMount(host.current!),
      dispatchTransactions(trs, view) {
        view.update(trs);
        shown.current?.viewUpdated(view, trs);
      },
    });
    setView(next);
    return () => {
      // This runs before the document's own cleanup, which would read a scroll already gone.
      if (shown.current) keepScroll(next, shown.current);
      next.destroy();
    };
  }, []);
  // The document has no state until its file has been read.
  const [loaded, setLoaded] = useState<FileDocument>();
  useEffect(() => {
    const check = () => {
      if (doc.state) setLoaded(doc);
    };
    check();
    return doc.subscribe(check);
  }, [doc]);
  const ready = loaded === doc && !!doc.state;
  useLayoutEffect(() => {
    if (!view || !ready || !doc.state) return;
    doc.attach(view);
    shown.current = doc;
    reconfigure(view, latest.current);
    restorePlace(view, doc);
    if (autoFocus) view.focus();
    onView?.(view);
    let attached = true;
    void loadLanguage(doc.path).then((language) => {
      if (!attached || !language || shown.current !== doc) return;
      if (slots.language.get(view.state) !== language)
        view.dispatch({ effects: slots.language.reconfigure(language) });
    });
    return () => {
      attached = false;
      if (view.dom.isConnected) keepScroll(view, doc);
      doc.detach(view);
      doc.revealInView = undefined;
      shown.current = undefined;
      onView?.(undefined);
    };
  }, [view, doc, ready]);
  useEffect(() => {
    if (view && shown.current === doc) reconfigure(view, values);
  });
  return <div className="code-editor" ref={host} />;
}
