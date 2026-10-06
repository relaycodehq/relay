// What one agent turn changed, as a folder tree with line counts. Rows open
// that turn's diff in the Changes pane; hovering one offers to roll it back.
import { ContextMenu } from "@base-ui/react/context-menu";
import { memo, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  Folder,
  FolderOpen,
  Redo2,
  Undo2,
} from "lucide-react";
import type { TurnFileChange } from "../../../shared/projects";
import { buildTurnTree, sumStats, type TurnTreeNode } from "./turn-diff-tree";
import { DiffStatLabel } from "./DiffStatLabel";
import { IconButton } from "../../ui/ui";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import "./changed-files.css";

// Short lists read best open; longer ones start as folders.
const EXPAND_UP_TO = 5;

type Mode = "revert" | "redo";
type Rewind = (
  paths: string[] | null,
  mode: Mode,
  force: boolean,
) => Promise<{ conflicts: string[] }>;
type Prompt =
  | { kind: "confirm" }
  | {
      kind: "conflict";
      paths: string[] | null;
      mode: Mode;
      conflicts: string[];
    }
  | { kind: "error"; message: string };

const filesUnder = (node: TurnTreeNode): TurnFileChange[] =>
  node.kind === "file" ? [node.change] : node.children.flatMap(filesUnder);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const ChangedFilesCard = memo(function ChangedFilesCard({
  files,
  onOpen,
  onReveal,
  onRewind,
}: {
  files: TurnFileChange[];
  /** Opens this turn's diff, on a file when one was picked. */
  onOpen: (path?: string) => void;
  /** Shows a file in Finder. */
  onReveal?: (path: string) => Promise<void>;
  /** Rolls files back, or redoes that; all of the turn when `paths` is null. */
  onRewind?: Rewind;
}) {
  const tree = useMemo(() => buildTurnTree(files), [files]);
  const total = useMemo(() => sumStats(files), [files]);
  const nested = tree.some((node) => node.kind === "directory");
  const [allOpen, setAllOpen] = useState(files.length <= EXPAND_UP_TO);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [working, setWorking] = useState(false);
  const reverted = files.filter((f) => f.revertedBy).length;
  async function rewind(paths: string[] | null, mode: Mode, force = false) {
    if (!onRewind || working) return;
    setWorking(true);
    setPrompt(null);
    try {
      const { conflicts } = await onRewind(paths, mode, force);
      if (conflicts.length)
        setPrompt({ kind: "conflict", paths, mode, conflicts });
    } catch (e) {
      setPrompt({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setWorking(false);
    }
  }
  // Rolls back what's still applied under a row, or redoes it once all of it is back.
  const action = (node: TurnTreeNode) => {
    if (!onRewind) return null;
    const under = filesUnder(node);
    const open = under.filter((f) => !f.revertedBy);
    const mode: Mode = open.length ? "revert" : "redo";
    const what = node.kind === "file" ? "this file" : "this folder";
    const label =
      mode === "revert"
        ? `Roll back ${what} to before this turn`
        : `Redo this turn's changes to ${what}`;
    return (
      <button
        type="button"
        className="changed-files-action"
        title={label}
        aria-label={label}
        disabled={working}
        onClick={() =>
          void rewind(
            (mode === "revert" ? open : under).map((f) => f.path),
            mode,
          )
        }
      >
        {mode === "revert" ? <Undo2 size={13} /> : <Redo2 size={13} />}
      </button>
    );
  };
  const row = (node: TurnTreeNode, depth: number) => {
    const indent = { paddingLeft: 8 + depth * 14 };
    if (node.kind === "directory") {
      const open = toggled[node.path] ?? allOpen;
      return (
        <div key={`dir:${node.path}`}>
          <div
            className={`changed-files-item${filesUnder(node).every((f) => f.revertedBy) ? " reverted" : ""}`}
          >
            <button
              type="button"
              className="changed-files-row folder"
              aria-expanded={open}
              style={indent}
              onClick={() => setToggled((t) => ({ ...t, [node.path]: !open }))}
            >
              <ChevronRight size={14} className="changed-files-chevron" />
              {open ? <FolderOpen size={14} /> : <Folder size={14} />}
              <span className="changed-files-name">{node.name}</span>
              <DiffStatLabel stat={node.stat} />
            </button>
            {action(node)}
          </div>
          {open && node.children.map((child) => row(child, depth + 1))}
        </div>
      );
    }
    const item = (
      <div
        key={`file:${node.path}`}
        className={`changed-files-item${node.change.revertedBy ? " reverted" : ""}`}
      >
        <button
          type="button"
          className="changed-files-row file"
          style={indent}
          title={
            node.change.revertedBy ? `${node.path} · rolled back` : node.path
          }
          onClick={() => onOpen(node.path)}
        >
          {(nested || depth > 0) && <span className="changed-files-gutter" />}
          <FileEntryIcon path={node.path} directory={false} />
          <span className="changed-files-name">{node.name}</span>
          {node.change.binary ? (
            <span className="diff-stat muted">binary</span>
          ) : (
            <DiffStatLabel stat={node.change} />
          )}
        </button>
        {action(node)}
      </div>
    );
    if (!onReveal) return item;
    return (
      <ContextMenu.Root key={`file:${node.path}`}>
        <ContextMenu.Trigger render={item} />
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="sb-menu-positioner">
            <ContextMenu.Popup className="sb-menu">
              <ContextMenu.Item
                className="sb-menu-item"
                onClick={() =>
                  void onReveal(node.path).catch((e) =>
                    setPrompt({
                      kind: "error",
                      message: e instanceof Error ? e.message : String(e),
                    }),
                  )
                }
              >
                <span className="sb-menu-label">
                  <FolderOpen size={13} />
                  Show in Finder
                </span>
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  };
  return (
    <section className="changed-files" aria-label="Changed files">
      <header>
        <strong>
          {files.length} changed file{files.length === 1 ? "" : "s"}
        </strong>
        {(total.additions > 0 || total.deletions > 0) && (
          <DiffStatLabel stat={total} />
        )}
        {reverted > 0 && (
          <span className="changed-files-note">
            {reverted === files.length
              ? "Rolled back"
              : `${reverted} rolled back`}
          </span>
        )}
        <span className="spacer" />
        {nested && (
          <IconButton
            label={allOpen ? "Collapse all folders" : "Expand all folders"}
            onClick={() => {
              setAllOpen((v) => !v);
              setToggled({});
            }}
          >
            {allOpen ? (
              <ChevronsDownUp size={14} />
            ) : (
              <ChevronsUpDown size={14} />
            )}
          </IconButton>
        )}
        <button
          type="button"
          className="changed-files-open"
          title="Open the full diff"
          onClick={() => onOpen(files[0]?.path)}
        >
          <FileDiff size={14} />
          Open diff
        </button>
        {onRewind && (
          <button
            type="button"
            className="changed-files-open"
            disabled={working}
            title={
              reverted === files.length
                ? "Redo this turn's changes"
                : "Roll back this turn's changes"
            }
            onClick={() =>
              reverted === files.length
                ? void rewind(null, "redo")
                : files.length - reverted > 1
                  ? setPrompt({ kind: "confirm" })
                  : void rewind(null, "revert")
            }
          >
            {reverted === files.length ? (
              <>
                <Redo2 size={14} />
                Redo
              </>
            ) : (
              <>
                <Undo2 size={14} />
                Roll back
              </>
            )}
          </button>
        )}
      </header>
      {prompt && (
        <div
          className={`changed-files-prompt${prompt.kind === "error" ? " error" : ""}`}
          role={prompt.kind === "confirm" ? undefined : "alert"}
        >
          {prompt.kind === "confirm" && (
            <>
              <span>
                Roll back {files.length - reverted} files to how they were
                before this turn? Later edits are kept where they merge.
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => void rewind(null, "revert")}
              >
                Roll back
              </button>
            </>
          )}
          {prompt.kind === "conflict" && (
            <>
              <span title={prompt.conflicts.join("\n")}>
                {prompt.conflicts.length === 1
                  ? `${baseName(prompt.conflicts[0])} was`
                  : `${prompt.conflicts.length} files were`}{" "}
                edited after{" "}
                {prompt.mode === "revert" ? "this turn" : "the rollback"} in
                ways that overlap it. Nothing was changed.
              </span>
              <button
                type="button"
                className="danger"
                onClick={() => void rewind(prompt.paths, prompt.mode, true)}
              >
                Overwrite anyway
              </button>
            </>
          )}
          {prompt.kind === "error" && <span>{prompt.message}</span>}
          <button type="button" onClick={() => setPrompt(null)}>
            {prompt.kind === "error" ? "Dismiss" : "Cancel"}
          </button>
        </div>
      )}
      <div className="changed-files-tree">
        {tree.map((node) => row(node, 0))}
      </div>
    </section>
  );
});
