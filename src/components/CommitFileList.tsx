import { FolderTree, List } from "lucide-react";
import type { WorkingChange } from "../../shared/working-tree";
import { useStoredFlag } from "../lib/useStoredFlag";
import { FileEntryIcon, IconButton } from "./ui";

type Kind = "added" | "modified" | "deleted";
const kindLabels: Record<Kind, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

function changeKind(c: WorkingChange): Kind {
  const code = c.index !== " " ? c.index : c.worktree;
  if (code === "A" || code === "?") return "added";
  if (code === "D") return "deleted";
  return "modified";
}

const folderOf = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

/**
 * The Commit sheet's files, each with a box to leave it out. Grouped under
 * their folders, or flat with the folder after the name; the choice is kept
 * per device.
 */
export function CommitFileList({
  files,
  excluded,
  onToggle,
  lines,
}: {
  files: WorkingChange[];
  excluded: ReadonlySet<string>;
  /** Leaves all of `paths` out, or takes them all back when they already are. */
  onToggle: (paths: string[]) => void;
  /** Across every change, so only shown while every file is included. */
  lines: { additions: number; deletions: number };
}) {
  const [flat, setFlat] = useStoredFlag("relay-commit-files-flat");
  const selected = files.length - excluded.size;
  const folders = new Map<string, WorkingChange[]>();
  if (!flat)
    for (const c of files) {
      const folder = folderOf(c.path);
      folders.set(folder, [...(folders.get(folder) ?? []), c]);
    }
  const box = (paths: string[], label: string) => (
    <GroupBox
      paths={paths}
      excluded={excluded}
      onToggle={onToggle}
      label={label}
    />
  );
  return (
    <div className="commit-files">
      <div className="commit-files-head">
        <label>
          {box(
            files.map((c) => c.path),
            "All files",
          )}
          {selected} of {files.length} {files.length === 1 ? "file" : "files"}
        </label>
        {!excluded.size && (lines.additions > 0 || lines.deletions > 0) && (
          <span className="commit-lines" aria-label="Lines changed">
            <span className="added">+{lines.additions}</span>
            <span className="deleted">−{lines.deletions}</span>
          </span>
        )}
        <span className="commit-files-view">
          <IconButton
            label="Group by folder"
            active={!flat}
            onClick={() => setFlat(false)}
          >
            <FolderTree size={13} />
          </IconButton>
          <IconButton
            label="Flat list"
            active={flat}
            onClick={() => setFlat(true)}
          >
            <List size={13} />
          </IconButton>
        </span>
      </div>
      <div className="commit-files-list">
        {flat
          ? files.map((c) => (
              <FileRow
                key={c.path}
                change={c}
                excluded={excluded}
                onToggle={onToggle}
                withFolder
              />
            ))
          : [...folders].map(([folder, group]) => (
              <div
                key={folder}
                role="group"
                aria-label={folder || "Repository root"}
              >
                <label className="commit-folder">
                  {box(
                    group.map((c) => c.path),
                    folder || "Repository root",
                  )}
                  {folder || "/"}
                </label>
                {group.map((c) => (
                  <FileRow
                    key={c.path}
                    change={c}
                    excluded={excluded}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            ))}
      </div>
    </div>
  );
}

/** Ticked when all of `paths` are in, dashed when only some are. */
function GroupBox({
  paths,
  excluded,
  onToggle,
  label,
}: {
  paths: string[];
  excluded: ReadonlySet<string>;
  onToggle: (paths: string[]) => void;
  label: string;
}) {
  const out = paths.filter((p) => excluded.has(p)).length;
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={!out}
      ref={(el) => {
        if (el) el.indeterminate = out > 0 && out < paths.length;
      }}
      onChange={() => onToggle(paths)}
    />
  );
}

function FileRow({
  change,
  excluded,
  onToggle,
  withFolder,
}: {
  change: WorkingChange;
  excluded: ReadonlySet<string>;
  onToggle: (paths: string[]) => void;
  withFolder?: boolean;
}) {
  const { path, previousPath } = change;
  const kind = changeKind(change);
  const folder = folderOf(path);
  const out = excluded.has(path);
  return (
    <label
      className={`commit-file ${withFolder ? "" : "nested"} ${out ? "excluded" : ""}`}
      title={`${kindLabels[kind]}: ${previousPath ? `${previousPath} → ` : ""}${path}`}
    >
      <input type="checkbox" checked={!out} onChange={() => onToggle([path])} />
      <FileEntryIcon path={path} directory={false} />
      <span className={`commit-file-name ${kind}`}>
        {path.slice(path.lastIndexOf("/") + 1)}
      </span>
      {withFolder && folder && (
        <span className="commit-file-folder">{folder}</span>
      )}
    </label>
  );
}
