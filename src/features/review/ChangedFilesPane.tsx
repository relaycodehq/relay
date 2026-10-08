import type { ReactNode } from "react";
import { ArrowUpRight, PanelLeftClose, Search } from "lucide-react";
import type { PullRef } from "../../../shared/types";
import { api } from "../../lib/api";
import type { PullReview } from "./usePullReview";
import type { PullSelection } from "./usePullSelection";
import { GroupedFileList } from "./GroupedFileList";
import { PaneResizer } from "../../ui/PaneResizer";
import { TriageControls } from "./TriageControls";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { pullHostName } from "../../../shared/source-control";

/** The PR's changed files beside its review: filtered, grouped and paged in. */
export function ChangedFilesPane({
  review: {
    pull,
    checks,
    progress,
    changedSinceViewed,
    revision,
    triage,
    files,
    readCount,
    reviewGroup,
  },
  selection: { fileSelection, file, selectFile, restoring },
  selected,
  hidden,
  bare,
  server,
  note,
  onHide,
}: {
  review: PullReview;
  selection: PullSelection;
  selected: PullRef;
  hidden: boolean;
  /** In a pane with its own header: the titlebar, repository and footer stay hidden. */
  bare: boolean;
  /** The PR's host, which the footer opens. */
  server: string;
  /** What the footer says about the PR beside its host link. */
  note?: ReactNode;
  onHide: () => void;
}) {
  const total = pull.data?.changed_files ?? files.all.length;
  return (
    <section
      id="files-sidebar"
      className="files-pane"
      aria-label="Changed files"
      hidden={hidden}
    >
      <PaneResizer
        pane="inbox"
        label="Resize file list"
        initial={282}
        min={230}
        max={410}
      />
      <header className="titlebar files-titlebar" hidden={bare}>
        <strong>Changed files</strong>
        <span className="file-total">{total}</span>
        <IconButton label="Hide changed files" onClick={onHide}>
          <PanelLeftClose size={17} />
        </IconButton>
      </header>
      <div className="files-controls">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Filter files"
            placeholder="Filter files…"
            value={files.filter}
            onChange={(e) => files.setFilter(e.target.value)}
          />
        </div>
      </div>
      {pull.data && !restoring && (
        <TriageControls
          state={triage.query.data}
          busy={triage.busy}
          error={triage.error || triage.query.error}
          onStart={() => void triage.start()}
          onCancel={() => void triage.cancel()}
          plain={triage.plain}
          onToggle={() => triage.setPlain((v) => !v)}
          individualReason={
            file ? triage.query.data?.result?.ordinary[file] : undefined
          }
          incomplete={Boolean(
            file && triage.query.data?.result?.incompleteFiles?.includes(file),
          )}
        />
      )}
      <div className="files-context" hidden={bare}>
        <span title={`${selected.owner}/${selected.name}`}>
          {selected.owner}/{selected.name}
        </span>
        <span>
          {readCount}/{total} viewed
        </span>
      </div>
      <div className="file-tree">
        <GroupedFileList
          checks={checks.state}
          files={files.all}
          selection={fileSelection}
          onSelect={selectFile}
          progress={progress.progress}
          revision={revision}
          changedSinceViewed={changedSinceViewed}
          result={triage.result}
          groups={triage.groups}
          filter={files.filter}
          plain={triage.plain}
          onReviewGroup={reviewGroup}
        />
        {files.query.error && (
          <ErrorBox
            error={files.query.error}
            retry={() => void files.query.refetch()}
          />
        )}
        <div className="file-more">
          {!triage.result && files.query.hasNextPage && (
            <button
              onClick={() => void files.query.fetchNextPage()}
              disabled={files.query.isFetchingNextPage}
            >
              {files.query.isFetchingNextPage ? "Loading…" : "Load more files"}
            </button>
          )}
          {files.query.isPending && <Loading />}
        </div>
      </div>
      <footer className="files-footer" hidden={bare}>
        {note}
        <IconButton
          label={`Open ${pullHostName(server)}`}
          onClick={() => void api.openExternal(server)}
        >
          <ArrowUpRight size={13} />
        </IconButton>
      </footer>
    </section>
  );
}
