import { FolderTree, List } from "lucide-react";
import { IconButton } from "../../ui/ui";
import "./working-tree.css";

/** Folders or a flat list, at the head of the list it changes. */
export function ListViewToggle({
  grouped,
  onGrouped,
}: {
  grouped: boolean;
  onGrouped: (grouped: boolean) => void;
}) {
  return (
    <span className="list-view-toggle" role="group" aria-label="Show files">
      <IconButton
        label="Group by folder"
        active={grouped}
        onClick={() => onGrouped(true)}
      >
        <FolderTree size={13} />
      </IconButton>
      <IconButton
        label="Flat list"
        active={!grouped}
        onClick={() => onGrouped(false)}
      >
        <List size={13} />
      </IconButton>
    </span>
  );
}
