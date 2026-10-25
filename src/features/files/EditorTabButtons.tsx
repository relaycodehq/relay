import {
  PanelLeftClose,
  PanelLeftOpen,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useShortcutLabel } from "../../lib/shortcuts";
import { IconButton } from "../../ui/ui";

/** Shows or hides the file list, at the start of the first split's tabs. */
export function FileListToggle({
  hidden,
  onToggle,
}: {
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label={hidden ? "Show file list" : "Hide file list"}
      className="file-list-toggle"
      onClick={onToggle}
    >
      {hidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
    </IconButton>
  );
}

/** Opens the editor in a window of its own, at the end of the last split's tabs. */
export function PopOutButton({ onClick }: { onClick: () => void }) {
  const keys = useShortcutLabel("editor-window");
  const label = "Open editor in new window";
  return (
    <button
      type="button"
      className="icon-button editor-window-button"
      aria-label={label}
      aria-keyshortcuts={keys || undefined}
      title={keys ? `${label} · ${keys}` : label}
      onClick={onClick}
    >
      <SquareArrowOutUpRight size={14} />
    </button>
  );
}
