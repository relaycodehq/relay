import { SquareArrowDownLeft } from "lucide-react";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";
import {
  bringBackEditor,
  isEditorElsewhere,
  popOutEditor,
} from "./editor-windows";

/**
 * Opens the workspace's editor in a window of its own, or puts it back if it
 * has one. Whichever window shows the thread listens for the shortcut.
 */
export function useEditorWindowShortcut(
  projectId: string,
  where: string,
  enabled: boolean,
  onError: (error: unknown) => void,
) {
  useShortcut("editor-window", enabled, () => {
    const move = isEditorElsewhere(where)
      ? bringBackEditor(where)
      : popOutEditor(projectId, where);
    move.catch(onError);
  });
}

/** Puts the editor window's editor back in the window it came from. */
export function BackToMainButton({
  where,
  onError,
}: {
  where: string;
  onError: (error: unknown) => void;
}) {
  const keys = useShortcutLabel("editor-window");
  const label = "Back to the main window";
  return (
    <button
      type="button"
      className="pane-toggle"
      aria-label={label}
      aria-keyshortcuts={keys || undefined}
      title={keys ? `${label} · ${keys}` : label}
      onClick={() => void bringBackEditor(where).catch(onError)}
    >
      <SquareArrowDownLeft size={14} />
    </button>
  );
}
