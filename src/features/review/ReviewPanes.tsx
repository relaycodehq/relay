import type { ReactNode } from "react";
import type { QuestionTarget } from "../../../shared/questions";
import type { Pull, PullRef } from "../../../shared/types";
import type { PullReview } from "./usePullReview";
import type { PullSelection } from "./usePullSelection";
import { ChangedFilesPane } from "./ChangedFilesPane";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { ErrorBox, Loading } from "../../ui/ui";
import type { PaneSlots } from "../../ui/WorkspacePanes";

/**
 * A PR under review, on the Pull requests page or in a PR thread's pane: its
 * changed files and the review.
 */
export function ReviewPanes({
  review,
  selection,
  selected,
  filesHidden,
  onHideFiles,
  bare,
  server,
  note,
  paneControls,
  slots,
  workspace,
  onDiscuss,
  onEditFile,
  onError,
}: {
  review: PullReview;
  selection: PullSelection;
  selected: PullRef;
  filesHidden: boolean;
  onHideFiles: () => void;
  /** In a pane with its own header, which takes the review's controls. */
  bare: boolean;
  server: string;
  /** What the file list's footer says about the PR. */
  note?: ReactNode;
  paneControls: ReactNode;
  slots?: PaneSlots;
  /** A PR thread's workspace, where local changes and blame are read. */
  workspace?: string;
  onDiscuss: (target: QuestionTarget, pull: Pull) => void;
  onEditFile: (path: string, line?: number) => void;
  onError: (e: unknown) => void;
}) {
  const { pull, resume } = review;
  const { restoring } = selection;
  return (
    <>
      <ChangedFilesPane
        review={review}
        selection={selection}
        selected={selected}
        hidden={filesHidden}
        bare={bare}
        server={server}
        note={note}
        onHide={onHideFiles}
      />
      <main className="review-main">
        {(pull.error || !pull.data || restoring) && (
          <header className="titlebar empty-titlebar">
            <span>Your review workspace</span>
            <div className="toolbar-actions">{paneControls}</div>
          </header>
        )}
        {pull.error ? (
          <ErrorBox error={pull.error} retry={() => void pull.refetch()} />
        ) : !pull.data ? (
          <Loading text="Opening pull request…" />
        ) : restoring ? (
          resume.error ? (
            <ErrorBox
              error={resume.error}
              retry={() => void resume.refetch()}
            />
          ) : (
            <Loading text="Checking your last review…" />
          )
        ) : (
          <ReviewWorkspace
            onDiscuss={(target) => onDiscuss(target, pull.data!)}
            checks={review.checks}
            key={JSON.stringify(selected)}
            pull={pull.data}
            file={review.current}
            files={review.files.order}
            progressController={review.progress}
            changedSinceViewed={review.changedSinceViewed}
            onCommentPaths={review.triage.setCommentPaths}
            onError={onError}
            onRefresh={review.refresh}
            onSelectFile={selection.selectFile}
            onFileViewed={review.files.advanceUnread}
            paneControls={paneControls}
            slots={slots}
            workspace={workspace}
            onEditFile={onEditFile}
          />
        )}
      </main>
    </>
  );
}

export function ErrorToast({
  error,
  onDismiss,
}: {
  error: unknown;
  onDismiss: () => void;
}) {
  return (
    <div className="toast error" role="alert">
      <ErrorBox error={error} />
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
