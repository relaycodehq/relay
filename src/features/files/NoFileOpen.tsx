import { FileCode2, Search, TextSearch } from "lucide-react";
import { useShortcutLabel } from "../../lib/shortcuts";

/** What a split shows with no file open. Folders are browsed in the tree; this side only shows files. */
export function NoFileOpen({
  onFind,
  onFindInFiles,
}: {
  onFind: () => void;
  onFindInFiles: () => void;
}) {
  const findInFilesKeys = useShortcutLabel("find-in-files");
  return (
    <div className="empty project-editor-empty">
      <FileCode2 size={28} />
      <h2>No file open</h2>
      <p>Pick one from the list, or find it by name or text.</p>
      <button onClick={onFind}>
        <Search size={14} /> Find a file
      </button>
      <button onClick={onFindInFiles}>
        <TextSearch size={14} /> Find in files
        <span className="shortcut-hint">{findInFilesKeys}</span>
      </button>
    </div>
  );
}
