import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { historyDiffTheme } from "./history-diff-theme";
import { loadLanguage } from "../../lib/code-languages";

/**
 * A kept version (left) against the current text (right), side by side and
 * read-only, with the unchanged stretches folded unless `whole`. The host's
 * `extensions` (its editor theme and highlighting) come first so they win.
 */
export function HistoryDiff({
  path,
  version,
  current,
  whole,
  extensions,
}: {
  path: string;
  version: string;
  current: string;
  whole: boolean;
  extensions?: Extension;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [language, setLanguage] = useState<Extension>([]);
  useEffect(() => {
    let live = true;
    setLanguage([]);
    void loadLanguage(path).then((support) => {
      if (live && support) setLanguage(support);
    });
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!parent.current) return;
    const shared: Extension[] = [
      extensions ?? [],
      language,
      lineNumbers(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      historyDiffTheme,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ];
    const view = new MergeView({
      a: { doc: version, extensions: shared },
      b: { doc: current, extensions: shared },
      parent: parent.current,
      highlightChanges: true,
      gutter: true,
      ...(whole ? {} : { collapseUnchanged: { margin: 3, minSize: 5 } }),
    });
    return () => view.destroy();
  }, [version, current, whole, extensions, language]);

  return <div className="lh-diff" ref={parent} />;
}
