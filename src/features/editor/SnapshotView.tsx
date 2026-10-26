import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { loadLanguage } from "../../lib/code-languages";
import { shadowMount } from "./shadow-mount";
import { baseExtensions, slots } from "./setup";
import { useEditorTheme } from "./useEditorTheme";
import "./editor.css";

/**
 * Text that is no file to edit, like a deleted file's last committed
 * version: the editor's look, keys and search, read-only.
 */
export function SnapshotView({
  path,
  text,
  label,
  extensions,
}: {
  /** Picks the language. */
  path: string;
  text: string;
  /** What screen readers call it. */
  label: string;
  /** The host's own, like asking about the selection. */
  extensions?: Extension;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView>();
  useLayoutEffect(() => {
    const next = new EditorView({
      root: shadowMount(host.current!),
      parent: shadowMount(host.current!),
      state: EditorState.create({
        doc: text,
        extensions: [
          baseExtensions(text),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": label }),
        ],
      }),
    });
    setView(next);
    return () => next.destroy();
  }, [text, label]);
  const theme = useEditorTheme();
  useEffect(() => {
    view?.dispatch({
      effects: [slots.theme.reconfigure(theme ?? []), slots.host.reconfigure(extensions ?? [])],
    });
  }, [view, theme, extensions]);
  useEffect(() => {
    if (!view) return;
    let live = true;
    void loadLanguage(path).then((support) => {
      if (live && support) view.dispatch({ effects: slots.language.reconfigure(support) });
    });
    return () => {
      live = false;
    };
  }, [view, path]);
  return <div className="code-editor" ref={host} />;
}
