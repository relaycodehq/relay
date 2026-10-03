import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { SquarePen } from "lucide-react";
import type { FilePair } from "../../../shared/types";
import { PaneResizer } from "../../ui/PaneResizer";
import {
  SplitDiffToggle,
  useSplitDiff,
  WorkingDiff,
} from "../diff/WorkingDiff";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";

/** The resizable list of files a commit or turn changed, beside its diff. */
export function ChangesSidebar({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <aside className="working-sidebar">
      <PaneResizer
        pane="changes"
        label="Resize changed files"
        initial={250}
        min={200}
        max={600}
      />
      <div className="working-file-list">
        <section>
          <header>
            <strong>
              {title} <span>{count}</span>
            </strong>
          </header>
          {children}
        </section>
      </div>
    </aside>
  );
}

/** One file's diff under a header naming the two sides compared. */
export function ChangesReview({
  path,
  sides,
  diff,
  loading,
  empty,
  onOpenFile,
}: {
  path: string | undefined;
  sides: { deletions: string; additions: string };
  diff: UseQueryResult<FilePair>;
  loading: string;
  empty: string;
  onOpenFile: (path: string) => void;
}) {
  const [split, setSplit] = useSplitDiff();
  return (
    <div className="working-review">
      {path ? (
        <>
          <header>
            <strong title={path}>{path}</strong>
            <span>
              {sides.deletions} → {sides.additions}
            </span>
            <SplitDiffToggle split={split} onChange={setSplit} />
            <IconButton label="Open in editor" onClick={() => onOpenFile(path)}>
              <SquarePen size={14} />
            </IconButton>
          </header>
          {diff.error ? (
            <ErrorBox error={diff.error} />
          ) : diff.data ? (
            <WorkingDiff pair={diff.data} sideLabels={sides} split={split} />
          ) : (
            <Loading text={loading} />
          )}
        </>
      ) : (
        <div className="empty">
          <h2>{empty}</h2>
        </div>
      )}
    </div>
  );
}
