import { SquarePen } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { FilePair } from "../../../shared/types";
import type { WorkingTree } from "../../../shared/working-tree";
import type { CodeReference } from "../../../shared/code-references";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { sideLabels, type SelectedChange } from "../../lib/working-changes";
import { ErrorBox, IconButton, Loading } from "../ui";
import { SplitDiffToggle, WorkingDiff } from "../WorkingDiff";

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
  const sides = sideLabels(selected.area);
  return (
    <>
      <header>
        <strong title={selected.path}>{selected.path}</strong>
        <span>{`${sides.deletions} → ${sides.additions}`}</span>
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
