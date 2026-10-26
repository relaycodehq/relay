// What one agent turn changed, as a folder tree with line counts. Rows open
// the file in the editor with that turn's changes; hovering one offers to roll it back.
import { ContextMenu } from "@base-ui/react/context-menu";
import { memo, useMemo, useState, type CSSProperties } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  Folder,
  FolderOpen,
  GitCommitHorizontal,
  Redo2,
  Undo2,
} from "lucide-react";
import type { TurnFileChange } from "../../../shared/projects";
import { buildTurnTree, type TurnTreeNode } from "./turn-diff-tree";
import { DiffStatLabel } from "./DiffStatLabel";
import { DiffStatBreakdown } from "./DiffStatBreakdown";
import { IconButton } from "../../ui/ui";
import { revealLabel } from "../../lib/mod-key";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { useFoldedTurn } from "./folded-turns";
import "../../ui/tree.css";
import "./changed-files.css";
import { errorMessage } from "../../../shared/error-message";

// Short lists read best open; longer ones start as folders, unless that
// would fold everything into a single row.
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
  turn,
  onOpen,
  onReveal,
  onRewind,
  onCommit,
}: {
  files: TurnFileChange[];
  /** The turn's thread and message, so the card stays folded when shown again. */
  turn?: { chatId: string; messageId: string };
  /** Opens this turn's diff, on a file when one was picked. */
  onOpen: (path?: string) => void;
  /** Shows a file in Finder. */
  onReveal?: (path: string) => Promise<void>;
  /** Rolls files back, or redoes that; all of the turn when `paths` is null. */
  onRewind?: Rewind;
  /** Opens the commit sheet with what this turn still has in place. */
  onCommit?: () => void;
}) {
  const tree = useMemo(() => buildTurnTree(files), [files]);
  const nested = tree.some((node) => node.kind === "directory");
  const [allOpen, setAllOpen] = useState(
    files.length <= EXPAND_UP_TO || tree.length < 2,
  );
  const [folded, setFolded] = useFoldedTurn(
    turn?.chatId,
    turn?.messageId ?? "",
  );
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
        message: errorMessage(e),
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
    const indent = { "--depth": depth } as CSSProperties;
    if (node.kind === "directory") {
      const open = toggled[node.path] ?? allOpen;
      return (
        <div key={`dir:${node.path}`}>
          <div
            className={`changed-files-item${filesUnder(node).every((f) => f.revertedBy) ? " reverted" : ""}`}
          >
            <button
              type="button"
              className="changed-files-row tree-row folder"
              aria-expanded={open}
              style={indent}
              onClick={() => setToggled((t) => ({ ...t, [node.path]: !open }))}
            >
              <span className="tree-twist">
                <ChevronRight size={14} />
              </span>
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
          className="changed-files-row tree-row file"
          style={indent}
          title={
            node.change.revertedBy ? `${node.path} · rolled back` : node.path
          }
          onClick={() => onOpen(node.path)}
        >
          {(nested || depth > 0) && <span className="tree-twist" />}
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
                      message: errorMessage(e),
                    }),
                  )
                }
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
  };
  return (
    <section
      className={`changed-files${folded ? " folded" : ""}`}
      aria-label="Changed files"
    >
      <header>
        <button
          type="button"
          className="changed-files-fold"
          aria-expanded={!folded}
          aria-label={folded ? "Show the files" : "Hide the files"}
          onClick={() => setFolded(!folded)}
        >
          <span className="tree-twist">
            <ChevronRight size={14} />
          </span>
          <strong>
            {files.length} changed file{files.length === 1 ? "" : "s"}
          </strong>
          <DiffStatBreakdown files={files} />
          {reverted > 0 && (
            <span className="changed-files-note">
              {reverted === files.length
                ? "Rolled back"
                : `${reverted} rolled back`}
            </span>
          )}
        </button>
        <span className="spacer" />
        {nested && !folded && (
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
          <span className="changed-files-label">Open diff</span>
        </button>
        {onCommit && reverted < files.length && (
          <button
            type="button"
            className="changed-files-open"
            title="Commit this turn's files"
            onClick={onCommit}
          >
            <GitCommitHorizontal size={14} />
            <span className="changed-files-label">Commit</span>
          </button>
        )}
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
                <span className="changed-files-label">Redo</span>
              </>
            ) : (
              <>
                <Undo2 size={14} />
                <span className="changed-files-label">Roll back</span>
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
      <div className="changed-files-tree" hidden={folded}>
        {tree.map((node) => row(node, 0))}
      </div>
    </section>
  );
});
