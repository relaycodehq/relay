import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { LocalHistory } from "../local-history/LocalHistory";
import { minimalChange } from "./text-changes";

/** The file's local history, with a revert that is an edit like any other in the open editor. */
export function LocalHistoryDialog({
  where,
  path,
  current,
  theme,
  view,
  onClose,
}: {
  where: string;
  path: string;
  current: string;
  theme: Extension | undefined;
  view: () => EditorView | undefined;
  onClose: () => void;
}) {
  return (
    <LocalHistory
      where={where}
      path={path}
      current={current}
      extensions={theme}
      onRevert={(contents) => {
        onClose();
        const editor = view();
        if (!editor) return;
        // An edit like any other, so ⌘Z takes it back.
        editor.dispatch({
          changes: minimalChange(editor.state, contents),
          userEvent: "input.revert",
          scrollIntoView: true,
        });
        editor.focus();
      }}
      onClose={onClose}
    />
  );
}
