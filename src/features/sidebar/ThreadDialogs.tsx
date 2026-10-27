import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import { ArchiveWorktreeDialog } from "./ArchiveWorktreeDialog";
import { SnoozePickDialog } from "./SnoozeMenu";
import type { ThreadActions } from "./useThreadActions";

/** What a thread's menu asks before it acts on the thread. */
export function ThreadDialogs({ actions }: { actions: ThreadActions }) {
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
      {actions.moving && (
        <MoveToWorktreeDialog
          chatId={actions.moving}
          onClose={() => actions.setMoving(undefined)}
        />
      )}
    </>
  );
}
