import { FileCode2, Search } from "lucide-react";

/** What a split shows with no file open. Folders are browsed in the tree; this side only shows files. */
export function NoFileOpen({ onFind }: { onFind: () => void }) {
  return (
    <div className="empty project-editor-empty">
      <FileCode2 size={28} />
      <h2>No file open</h2>
      <p>Pick one from the list, or find it by name.</p>
      <button onClick={onFind}>
        <Search size={14} /> Find a file
      </button>
    </div>
  );
}
