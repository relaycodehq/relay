import { useEffect, useRef, useSyncExternalStore } from "react";
import { undos, type Undo, type UndoStack } from "../lib/undo";
import { useShortcut } from "../lib/shortcuts";

function newestDue(list: Undo[], now: number) {
  for (let i = list.length - 1; i >= 0; i--)
    if (list[i]!.until > now) return list[i];
}

/**
 * The `undo` shortcut, listening only while something can be undone. There
 * is no notice on purpose: the change shows in the sidebar and ⌘Z is enough.
 */
export function useUndoShortcut(
  onError: (e: unknown) => void,
  stack: UndoStack = undos,
) {
  const list = useSyncExternalStore(stack.subscribe, stack.list);
  const top = newestDue(list, Date.now());
  // ⌘Z in a text field is the field's own undo once something was typed
  // there since the action; before that nothing there to undo.
  const typed = useRef(false);
  useEffect(() => {
    typed.current = false;
    if (!top) return;
    const input = () => {
      typed.current = true;
    };
    document.addEventListener("beforeinput", input, true);
    return () => document.removeEventListener("beforeinput", input, true);
  }, [top?.token]);
  useShortcut(
    "undo",
    !!top,
    () => top && stack.undo(top.token).catch(onError),
    { inFields: () => !typed.current },
  );
  useEffect(() => {
    if (!top) return;
    const timer = window.setTimeout(
      () => stack.expire(),
      Math.max(0, top.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [stack, top]);
}
