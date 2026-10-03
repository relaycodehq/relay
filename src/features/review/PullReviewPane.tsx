import { useEffect, useState } from "react";
import { FileCode2 } from "lucide-react";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { QuestionTarget } from "../../../shared/questions";
import type { Account, Pull, PullRef } from "../../../shared/types";
import type { RequestChannel } from "../../lib/request-channel";
import { useShortcut } from "../../lib/shortcuts";
import { useFileReveals } from "./useFileReveals";
import { usePullReview } from "./usePullReview";
import { usePullSelection } from "./usePullSelection";
import { useStoredFlag } from "../../lib/useStoredFlag";
import { ErrorToast, ReviewPanes } from "./ReviewPanes";
import { IconButton } from "../../ui/ui";
import type { PaneSlots } from "../../ui/WorkspacePanes";

/**
 * A PR thread's Review pane: its one PR, with the controls in the pane's
 * header. Questions about lines go to the thread, files open in its editor,
 * and files clicked in its chat open here.
 */
export function PullReviewPane({
  pull: ref,
  workspace,
  account,
  initialFile,
  slots,
  reveals,
  onPresence,
  onDiscuss,
  onEditFile,
}: {
  pull: PullRef;
  /** The thread's workspace: local changes and blame read its folder. */
  workspace?: string;
  account: Account;
  initialFile: string | null;
  slots: PaneSlots;
  /** Files to select, such as ones clicked in the thread's chat. */
  reveals: RequestChannel<ProjectFileLink>;
  /** The open file and how many are viewed, as they change. */
  onPresence: (v: {
    path: string | null;
    viewed: number;
    total: number;
  }) => void;
  onDiscuss: (target: QuestionTarget, pull: Pull) => void;
  onEditFile: (path: string, line?: number) => void;
}) {
  const selection = usePullSelection(ref, initialFile, false);
  const [filesHidden, setFilesHidden] = useStoredFlag("relay-files-hidden"),
    [error, setError] = useState<unknown>();
  const review = usePullReview(selection, account.user.id, setError);
  useFileReveals(
    reveals,
    review.files,
    review.triage.result,
    selection.selectFile,
    setError,
  );
  useShortcut("review-files", true, () => setFilesHidden((v) => !v));
  useEffect(() => {
    onPresence({
      path: selection.file,
      viewed: review.readCount,
      total: review.pull.data?.changed_files ?? 0,
    });
  }, [selection.file, review.readCount, review.pull.data?.changed_files]);
  return (
    <>
      <ReviewPanes
        review={review}
        selection={selection}
        selected={selection.selected!}
        filesHidden={filesHidden}
        onHideFiles={() => setFilesHidden(true)}
        bare
        server={account.server}
        paneControls={
          <IconButton
            label="Toggle changed files"
            onClick={() => setFilesHidden((v) => !v)}
          >
            <FileCode2 size={17} />
          </IconButton>
        }
        slots={slots}
        workspace={workspace}
        onDiscuss={onDiscuss}
        onEditFile={onEditFile}
        onError={setError}
      />
      {!!error && (
        <ErrorToast error={error} onDismiss={() => setError(undefined)} />
      )}
    </>
  );
}
