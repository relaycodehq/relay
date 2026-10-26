import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { matches } from "../../lib/shortcuts";

type Saver = { save: () => unknown; view: () => EditorView | undefined };

/** The editors that can save, the one focused last at the end. */
const savers: Saver[] = [];

function onKey(event: KeyboardEvent) {
  if (!matches("save", event) || !savers.length) return;
  event.preventDefault();
  event.stopPropagation();
  const focused = savers.find((s) => s.view()?.hasFocus);
  void (focused ?? savers.at(-1)!).save();
}

function onFocus(event: FocusEvent) {
  const at = savers.findIndex((s) =>
    s.view()?.dom.contains(event.target as Node),
  );
  if (at >= 0) savers.push(...savers.splice(at, 1));
}

/**
 * Saves on the save shortcut, once for the window: the editor with focus,
 * else the one focused last. Not useShortcut: saving works while typing,
 * inside the editor's own dialog, and before anything else hears the keys.
 */
export function useSaveShortcut(
  save: () => unknown,
  view: () => EditorView | undefined,
) {
  const latest = useRef({ save, view });
  latest.current = { save, view };
  useEffect(() => {
    const saver: Saver = {
      save: () => latest.current.save(),
      view: () => latest.current.view(),
    };
    if (!savers.length) {
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("focusin", onFocus, true);
    }
    savers.push(saver);
    return () => {
      savers.splice(savers.indexOf(saver), 1);
      if (savers.length) return;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focusin", onFocus, true);
    };
  }, []);
}
