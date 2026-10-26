import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import { ShareGuestDialog } from "../guest-share/ShareGuestDialog";
import { ArchiveWorktreeDialog } from "./ArchiveWorktreeDialog";
import { SnoozePickDialog } from "./SnoozeMenu";
import type { useThreadActions } from "./useThreadActions";

/** The dialogs a thread's menu opens, each for the thread it was opened on. */
export function ThreadActionDialogs({
  actions,
}: {
  actions: ReturnType<typeof useThreadActions>;
}) {
  return (
    <>
      {actions.pickingSnooze && (
        <SnoozePickDialog
          onSnooze={(until) =>
            void actions.triage(actions.pickingSnooze!, {
              kind: "snooze",
              until,
            })
          }
          onClose={() => actions.setPickingSnooze(undefined)}
        />
      )}
      {actions.archiving && (
        <ArchiveWorktreeDialog
          chat={actions.archiving.chat}
          files={actions.archiving.files}
          onArchive={actions.archive}
          onCancel={actions.cancelArchive}
        />
      )}
      {actions.sharing && (
        <ShareGuestDialog
          threadId={actions.sharing}
          onClose={() => actions.setSharing(undefined)}
        />
      )}
      {actions.moving && (
        <MoveToWorktreeDialog
          chatId={actions.moving}
          onClose={() => actions.setMoving(undefined)}
        />
      )}
    </>
  );
}
