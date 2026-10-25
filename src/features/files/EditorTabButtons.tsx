import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
