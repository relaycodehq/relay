import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { Bot, FolderGit2, MonitorUp, Settings2 } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import {
  handoffBlocked,
  worktreeFirst,
  type HandoffTarget,
  type PairedComputer,
} from "../../../shared/handoff";
import { api } from "../../lib/api";
import { DeviceIcon } from "./DeviceIcon";
import {
  canPick,
  cloneSetupPrompt,
  targetLine,
  useCloneThere,
  whileCloning,
} from "./clone-there";
import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import "./handoff.css";

/**
 * The thread header's hand-off button. With no computer paired it opens
 * Settings → Computers; otherwise it lists the paired ones, each with the
 * project it has for this repository, or why it can't take the thread. One
 * without the project clones it first, and when that fails, an agent in a
 * new thread here can set it up.
 */
export function HandoffButton({
  chat,
  onSettings,
  onError,
  onStartThread,
}: {
  chat: ChatSummary;
  onSettings: () => void;
  onError: (error: unknown) => void;
  onStartThread?: (text: string, send: boolean) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const computers = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
  });
  const blocked = handoffBlocked(chat);
  const targetsKey = ["handoff-targets", chat.id];
  const targets = useQuery({
    queryKey: targetsKey,
    queryFn: () => api.handoffTargets(chat.id),
    enabled: open && !blocked,
    staleTime: 5_000,
    refetchInterval: (q) => whileCloning(q.state.data),
  });
  const cloneThere = useCloneThere(chat.projectId, targetsKey);
  if (chat.sentTo || chat.cameFrom?.returnedAt) return null;
  const paired = computers.data ?? [];
  const label = "Hand off to another computer";
  if (!paired.length)
    return (
      <button
        type="button"
        className="pane-toggle"
        aria-label={label}
        title={`${label}: pair one in Settings first`}
        disabled={!computers.data}
        onClick={onSettings}
      >
        <MonitorUp size={14} />
      </button>
    );
  const handOff = async (target: HandoffTarget) => {
    try {
      await api.handOffThread(chat.id, target.id);
    } catch (e) {
      onError(e);
    } finally {
      void qc.invalidateQueries({ queryKey: ["project-chats"] });
      void qc.invalidateQueries({ queryKey: ["handoff-view", chat.id] });
    }
  };
  return (
    <>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger className="pane-toggle" aria-label={label} title={label}>
          <MonitorUp size={14} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="composer-popup-positioner"
            align="end"
            sideOffset={6}
          >
            <Menu.Popup className="composer-select-popup handoff-menu">
              <div className="composer-menu-label">Hand off to</div>
              {(targets.data ?? placeholders(paired)).map((target) => (
                <Fragment key={target.id}>
                  <Menu.Item
                    className="composer-select-item handoff-target"
                    disabled={!!blocked || !targets.data || !canPick(target)}
                    // A clone keeps the menu open to show how far it is.
                    closeOnClick={!!target.project}
                    onClick={() =>
                      target.project
                        ? void handOff(target)
                        : cloneThere(target, () => {
                            setOpen(false);
                            void handOff(target);
                          })
                    }
                  >
                    <DeviceIcon name={target.name} size={16} />
                    <span className="handoff-target-text">
                      <span>{target.name}</span>
                      <small title={target.cloneError}>
                        {blocked
                          ? ""
                          : !targets.data
                            ? "Checking…"
                            : targetLine(target, "Continues")}
                      </small>
                    </span>
                  </Menu.Item>
                  {!blocked && target.cloneError && onStartThread && (
                    <Menu.Item
                      className="composer-select-item handoff-target handoff-setup"
                      onClick={() =>
                        void onStartThread(cloneSetupPrompt(target), false)
                      }
                    >
                      <Bot size={14} />
                      <span className="handoff-target-text">
                        <span>Let an agent set it up…</span>
                      </span>
                    </Menu.Item>
                  )}
                </Fragment>
              ))}
              <p className="handoff-menu-note">
                {blocked ??
                  "The agent stops and writes a handoff note, everything in the worktree is committed, and the thread carries on there. Ignored files such as .env stay here."}
              </p>
              {blocked === worktreeFirst && chat.scope.kind === "project" && (
                <Menu.Item
                  className="composer-select-item handoff-target"
                  onClick={() => setMoving(true)}
                >
                  <FolderGit2 size={14} />
                  <span className="handoff-target-text">
                    <span>Move into its own worktree…</span>
                  </span>
                </Menu.Item>
              )}
              <Menu.Separator className="handoff-menu-separator" />
              <Menu.Item
                className="composer-select-item handoff-target"
                onClick={onSettings}
              >
                <Settings2 size={14} />
                <span className="handoff-target-text">
                  <span>Computers…</span>
                </span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {moving && (
        <MoveToWorktreeDialog
          chatId={chat.id}
          onClose={() => setMoving(false)}
        />
      )}
    </>
  );
}

/** The paired computers while the check for this repository runs. */
const placeholders = (paired: PairedComputer[]): HandoffTarget[] =>
  paired.map((c) => ({
    id: c.id,
    name: c.name,
    online: c.status === "online",
  }));
