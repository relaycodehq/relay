import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { ArrowDown, ArrowUp, CircleAlert } from "lucide-react";
import { Spinner } from "../../ui/ui";
import { RebaseConflictCard, resolvePrompt } from "./RebaseConflict";
import type { BranchSync } from "./useBranchSync";
import "./branch-picker.css";

/** The same push, pull and rebase control beside a checkout or worktree branch. */
export function BranchSyncControl({
  state,
  held,
  onStartThread,
}: {
  state: BranchSync;
  /** Pulling and rebasing wait for the agent and unsaved edits. */
  held: boolean;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const {
    t,
    remote,
    sync,
    clash,
    syncing,
    syncError,
    conflictOpen,
    setConflictOpen,
    runSync,
  } = state;
  return (
    <>
      {t?.operation?.startsWith("rebase") && (
        <span
          className="composer-branch-trigger workspace-trigger static composer-branch-rebasing"
          title="A rebase is in progress in this folder"
        >
          Rebasing…
        </span>
      )}
      {sync && t && (
        <Popover.Root
          open={conflictOpen && !!clash}
          onOpenChange={(next) => setConflictOpen(next && !!clash)}
        >
          <Popover.Trigger
            className="composer-branch-sync"
            data-state={clash ? "conflict" : sync}
            disabled={syncing || (sync !== "push" && held)}
            aria-label={
              clash
                ? `Couldn’t rebase onto ${t.upstream}`
                : sync === "pull"
                  ? `Pull ${t.behind} commit${t.behind === 1 ? "" : "s"} from ${t.upstream}`
                  : sync === "push"
                    ? `Push ${t.ahead} commit${t.ahead === 1 ? "" : "s"} to ${t.pushTarget ?? t.upstream}`
                    : `Rebase ${t.ahead} commit${t.ahead === 1 ? "" : "s"} onto ${t.upstream}`
            }
            title={
              sync !== "push" && held
                ? `Save your edits and wait for the agent before ${sync === "pull" ? "pulling" : "rebasing"}`
                : remote.error
                  ? `Couldn’t fetch ${t.upstream}: ${remote.error.message}`
                  : sync === "rebase" && !clash
                    ? `Rebase your ${t.ahead} onto the ${t.behind} new on ${t.upstream}`
                    : !t.upstream
                      ? `Not on ${t.pushTarget} yet. Push ${t.ahead} commit${t.ahead === 1 ? "" : "s"}`
                      : undefined
            }
            onClick={() => void runSync()}
          >
            {syncing ? (
              <Spinner size={12} />
            ) : (
              <>
                {t.behind > 0 && (
                  <span>
                    <ArrowDown size={12} />
                    {t.behind}
                  </span>
                )}
                {t.ahead > 0 && (
                  <span>
                    <ArrowUp size={12} />
                    {t.ahead}
                  </span>
                )}
              </>
            )}
          </Popover.Trigger>
          {clash && (
            <Popover.Portal>
              <Popover.Positioner
                className="composer-popup-positioner"
                side="top"
                align="end"
                sideOffset={6}
              >
                <Popover.Popup className="composer-select-popup rebase-conflict-card">
                  <RebaseConflictCard
                    conflict={clash}
                    onResolve={
                      onStartThread &&
                      ((draft) => {
                        setConflictOpen(false);
                        void onStartThread(
                          resolvePrompt(t.branch, clash),
                          !draft,
                        );
                      })
                    }
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          )}
        </Popover.Root>
      )}
      {syncError && (
        <Tooltip.Root>
          <span role="alert" className="sr-only">
            {syncError}
          </span>
          <Tooltip.Trigger
            className="composer-branch-error"
            aria-label={`Git sync failed: ${syncError}`}
            delay={200}
          >
            <CircleAlert size={14} aria-hidden="true" />
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Positioner
              className="composer-popup-positioner"
              side="top"
              align="end"
              sideOffset={6}
              collisionPadding={12}
            >
              <Tooltip.Popup
                role="tooltip"
                className="composer-branch-error-tooltip"
              >
                {syncError}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </>
  );
}
