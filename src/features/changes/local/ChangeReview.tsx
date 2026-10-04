import { SquarePen } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { FilePair } from "../../../../shared/types";
import type { WorkingTree } from "../../../../shared/working-tree";
import type { CodeReference } from "../../../../shared/code-references";
import type { ProjectFileLink } from "../../../../shared/project-file-links";
import {
  ignoredSides,
  sideLabels,
  type SelectedChange,
} from "../working-changes";
import { ErrorBox, IconButton, Loading } from "../../../ui/ui";
import { MiddleTruncate } from "../../../ui/MiddleTruncate";
import { SplitDiffToggle, WorkingDiff } from "../../diff/WorkingDiff";

type Props = {
  tree: WorkingTree;
  selected: SelectedChange | null;
  diff: UseQueryResult<FilePair>;
  /** A file asked for that has no local changes. */
  missing: ProjectFileLink | null;
  split: boolean;
  onSplit: (split: boolean) => void;
  line?: number;
  onLineShown: () => void;
  onOpenFile?: (path: string, line?: number) => void;
  onAsk?: (ref: CodeReference) => void;
};

/** The selected file's diff, or why there's none to show. */
export function ChangeReview({ selected, missing, ...props }: Props) {
  const { tree, onOpenFile } = props;
  return (
    <div className="working-review">
      {selected ? (
        <SelectedDiff selected={selected} {...props} />
      ) : missing ? (
        <div className="empty">
          <h2>
            {missing.directory
              ? `Nothing in ${missing.path}/ has local changes.`
              : `${missing.path} has no local changes.`}
          </h2>
          {onOpenFile && !missing.directory && (
            <div>
              <button onClick={() => onOpenFile(missing.path, missing.line)}>
                <SquarePen size={14} />
                Open in editor
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="empty">
          <h2>
            {tree.changes.length
              ? "Your changes, before the commit."
              : "Working tree is clean."}
          </h2>
          <p>Select a file to review its local diff.</p>
        </div>
      )}
    </div>
  );
}

function SelectedDiff({
  tree,
  selected,
  diff,
  split,
  onSplit,
  line,
  onLineShown,
  onOpenFile,
  onAsk,
}: Omit<Props, "missing"> & { selected: SelectedChange }) {
  const touch =
    selected.area === "ignored"
      ? tree.ignored?.find((t) => t.path === selected.path)
      : undefined;
  const ignored = touch && ignoredSides(touch);
  const sides =
    ignored?.sides ??
    sideLabels(selected.area === "staged" ? "staged" : "unstaged");
  return (
    <>
      <header>
        <strong>
          <MiddleTruncate text={selected.path} kind="path" />
        </strong>
        <span title={touch?.rule && `Gitignored by ${touch.rule}`}>
          {ignored?.said ?? `${sides.deletions} → ${sides.additions}`}
        </span>
        <SplitDiffToggle split={split} onChange={onSplit} />
        {onOpenFile && (
          <IconButton
            label="Open in editor"
            disabled={
              tree.changes.find((c) => c.path === selected.path)?.worktree ===
              "D"
            }
            onClick={() => onOpenFile(selected.path)}
          >
            <SquarePen size={14} />
          </IconButton>
        )}
      </header>
      {diff.error ? (
        <ErrorBox error={diff.error} />
      ) : diff.data ? (
        <WorkingDiff
          pair={diff.data}
          sideLabels={sides}
          split={split}
          line={line}
          onLineShown={onLineShown}
          onAsk={
            onAsk &&
            ((t) =>
              onAsk({
                path: selected.path,
                start: t.start,
                end: t.end,
                label: sides[t.side],
                code: t.code,
              }))
          }
        />
      ) : (
        <Loading text="Loading local diff…" />
      )}
    </>
  );
}
