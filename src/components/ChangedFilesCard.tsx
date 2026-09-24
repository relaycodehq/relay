// Adapted from T3 Code's ChangedFilesCard: what one agent turn changed, as a
// folder tree with line counts. Rows open that turn's diff in the Changes pane;
// hovering one offers to roll it back.
import { memo, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  Folder,
  FolderOpen,
  MessagesSquare,
  Redo2,
  Undo2,
} from "lucide-react";
import type { TurnFileChange } from "../../shared/projects";
import {
  buildTurnTree,
  compactCount,
  sumStats,
  type DiffStat,
  type TurnTreeNode,
} from "../lib/turn-diff-tree";
import { FileEntryIcon, IconButton } from "./ui";
import "./changed-files.css";

// Short lists read best open; longer ones start as folders, like T3.
const EXPAND_UP_TO = 5;

function DiffStatLabel({ stat }: { stat: DiffStat }) {
  return (
    <span
      className="diff-stat"
      role="group"
      aria-label={`${stat.additions} additions, ${stat.deletions} deletions`}
    >
      <span aria-hidden className="diff-stat-add">
        +{compactCount(stat.additions)}
      </span>
      <span aria-hidden className="diff-stat-del">
        −{compactCount(stat.deletions)}
      </span>
    </span>
  );
}

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

/** Changes the agent didn't make, per thread that did; `by` is unset for the rest. */
interface OtherGroup {
  key: string;
  by?: TurnFileChange["changedBy"];
  tree: TurnTreeNode[];
  count: number;
}
function groupOthers(files: TurnFileChange[]): OtherGroup[] {
  const groups = new Map<string, TurnFileChange[]>();
  for (const f of files) {
    const key = f.changedBy?.chatId ?? "";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  // Threads first, what nobody in Relay claims last.
  return [...groups]
    .sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1))
    .map(([key, list]) => ({
      key,
      by: list[0].changedBy,
      tree: buildTurnTree(list),
      count: list.length,
    }));
}

const filesUnder = (node: TurnTreeNode): TurnFileChange[] =>
  node.kind === "file" ? [node.change] : node.children.flatMap(filesUnder);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const ChangedFilesCard = memo(function ChangedFilesCard({
  files,
  onOpen,
  onRewind,
  onOpenThread,
}: {
  files: TurnFileChange[];
  /** Opens this turn's diff, on a file when one was picked. */
  onOpen: (path?: string) => void;
  /** Opens the thread that changed some of these files meanwhile. */
  onOpenThread?: (chatId: string) => void;
  /** Rolls files back, or redoes that; all of the turn when `paths` is null. */
  onRewind?: Rewind;
}) {
  // The agent's own changes lead; the rest may not be its doing (see `unclaimed`).
  const own = useMemo(() => files.filter((f) => !f.unclaimed), [files]);
  const others = useMemo(() => files.filter((f) => f.unclaimed), [files]);
  const tree = useMemo(() => buildTurnTree(own), [own]);
  const otherGroups = useMemo(() => groupOthers(others), [others]);
  const total = useMemo(() => sumStats(own), [own]);
  const nested = tree.some((node) => node.kind === "directory");
  const [allOpen, setAllOpen] = useState(own.length <= EXPAND_UP_TO);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [working, setWorking] = useState(false);
  const reverted = own.filter((f) => f.revertedBy).length;
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
    return (
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
  };
  return (
    <section className="changed-files" aria-label="Changed files">
      {own.length > 0 && (
        <header>
          <strong>
            {own.length} changed file{own.length === 1 ? "" : "s"}
          </strong>
          {(total.additions > 0 || total.deletions > 0) && (
            <DiffStatLabel stat={total} />
          )}
          {reverted > 0 && (
            <span className="changed-files-note">
              {reverted === own.length
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
            onClick={() => onOpen(own[0]?.path)}
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
                reverted === own.length
                  ? "Redo this turn's changes"
                  : "Roll back this turn's changes"
              }
              onClick={() =>
                reverted === own.length
                  ? void rewind(null, "redo")
                  : own.length - reverted > 1
                    ? setPrompt({ kind: "confirm" })
                    : void rewind(null, "revert")
              }
            >
              {reverted === own.length ? (
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
      )}
      {prompt && (
        <div
          className={`changed-files-prompt${prompt.kind === "error" ? " error" : ""}`}
          role={prompt.kind === "confirm" ? undefined : "alert"}
        >
          {prompt.kind === "confirm" && (
            <>
              <span>
                Roll back {own.length - reverted} files to how they were before
                this turn? Later edits are kept where they merge.
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
      {otherGroups.map((group) => (
        <details key={group.key} className="changed-files-others">
          <summary
            title={
              group.by
                ? `The agent in “${group.by.title}” changed these while this turn ran. Roll each back on its own.`
                : "This thread didn't change these. Something else did while it ran: your editor, a command like rm -rf, or a session outside Relay. Roll each back on its own."
            }
          >
            <ChevronRight size={14} className="changed-files-chevron" />
            {group.by ? (
              <span className="changed-files-name">
                Changed in thread “{group.by.title}”
              </span>
            ) : (
              "Changed outside this thread"
            )}
            <span className="changed-files-note">
              {group.count} file{group.count === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="changed-files-tree">
            {group.by && onOpenThread && (
              <button
                type="button"
                className="changed-files-open"
                onClick={() => onOpenThread(group.by!.chatId)}
              >
                <MessagesSquare size={14} />
                Open that thread
              </button>
            )}
            {group.tree.map((node) => row(node, 0))}
          </div>
        </details>
      ))}
    </section>
  );
});
