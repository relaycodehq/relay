import { useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ChevronRight, FolderOpen } from "lucide-react";
import type { TurnFileChange } from "../../../shared/projects";
import { revealLabel } from "../../lib/mod-key";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { DiffStatLabel } from "./DiffStatLabel";
import { byFolder } from "./working-changes";

/**
 * A turn's or a worktree's files, laid out like the local changes list:
 * under their folders, or flat with the folder after the name.
 */
export function TurnFileList({
  files,
  selected,
  grouped,
  onPick,
  onReveal,
}: {
  files: TurnFileChange[];
  selected?: string;
  grouped: boolean;
  onPick: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  const [shut, setShut] = useState<string[]>([]);
  const row = (f: TurnFileChange, nested: boolean) => (
    <FileRow
      key={f.path}
      file={f}
      nested={nested}
      selected={f.path === selected}
      onPick={onPick}
      onReveal={onReveal}
    />
  );
  if (!grouped) return files.map((f) => row(f, false));
  const folders = [...byFolder(files)];
  return folders.map(([folder, group]) => {
    const name = folder || "Repository root",
      closed = shut.includes(folder),
      // ⌥-click opens or closes every folder, as in the local list.
      fold = (all: boolean) => {
        const keys = all ? folders.map(([f]) => f) : [folder];
        setShut((s) => [
          ...s.filter((k) => !keys.includes(k)),
          ...(closed ? [] : keys),
        ]);
      };
    return (
      <div key={folder} role="group" aria-label={name}>
        <div className="working-folder">
          <button
            className="change-section-toggle"
            aria-label={name}
            aria-expanded={!closed}
            title="⌥-click for every folder"
            onClick={(e) => fold(e.altKey)}
          >
            <ChevronRight size={13} />
          </button>
          <span title={name} onClick={(e) => fold(e.altKey)}>
            {folder || "/"}
          </span>
          {closed && <small>{group.length}</small>}
        </div>
        {!closed && group.map((f) => row(f, true))}
      </div>
    );
  });
}

function FileRow({
  file: f,
  nested,
  selected,
  onPick,
  onReveal,
}: {
  file: TurnFileChange;
  nested: boolean;
  selected: boolean;
  onPick: (path: string) => void;
  onReveal: (path: string) => void;
}) {
  const slash = f.path.lastIndexOf("/");
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <div
            className={`working-file turn-file-row ${nested ? "nested" : ""} ${selected ? "selected" : ""}`}
          />
        }
      >
        <button
          className="change-select"
          title={f.path}
          onClick={() => onPick(f.path)}
        >
          <FileEntryIcon path={f.path} directory={false} />
          <span className="change-name">
            <MiddleTruncate
              text={f.path.slice(slash + 1)}
              kind="path"
              title={null}
            />
          </span>
          {!nested && slash > 0 && (
            <span className="change-dir">{f.path.slice(0, slash)}</span>
          )}
        </button>
        {!f.binary && <DiffStatLabel stat={f} />}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="sb-menu-positioner">
          <ContextMenu.Popup className="sb-menu">
            <ContextMenu.Item
              className="sb-menu-item"
              onClick={() => onReveal(f.path)}
            >
              <span className="sb-menu-label">
                <FolderOpen size={13} />
                {revealLabel}
              </span>
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
