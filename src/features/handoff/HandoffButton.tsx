import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { FolderGit2, MonitorUp, Settings2 } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import type { HandoffTarget, PairedComputer } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { DeviceIcon } from "./DeviceIcon";
import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import "./handoff.css";

const worktreeFirst =
  "Only a thread in its own worktree can move to another computer.";

/** Why this thread can't move to another computer, if it can't. */
function handoffBlocked(chat: ChatSummary) {
  if (chat.shared) return "Shared conversations stay on this computer.";
  if (chat.scope.kind === "review")
    return "A deep review stays on this computer.";
  if (chat.cameFrom?.abandonedAt)
    return `${chat.cameFrom.computer} took this thread back; it can't move on from here.`;
  if (chat.cameFrom)
    return `This thread came from ${chat.cameFrom.computer}; bring it back there.`;
  if (!chat.worktree) return worktreeFirst;
  if (chat.empty) return "Send a first message, then hand it off.";
}

/**
 * The thread header's hand-off button. With no computer paired it opens
 * Settings → Computers; otherwise it lists the paired ones, each with the
 * project it has for this repository, or why it can't take the thread.
 */
export function HandoffButton({
  chat,
  onSettings,
  onError,
}: {
  chat: ChatSummary;
  onSettings: () => void;
  onError: (error: unknown) => void;
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
  const targets = useQuery({
    queryKey: ["handoff-targets", chat.id],
    queryFn: () => api.handoffTargets(chat.id),
    enabled: open && !blocked,
    staleTime: 5_000,
  });
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
                <Menu.Item
                  key={target.id}
                  className="composer-select-item handoff-target"
                  disabled={!!blocked || !target.project}
                  onClick={() => void handOff(target)}
                >
                  <DeviceIcon name={target.name} size={16} />
                  <span className="handoff-target-text">
                    <span>{target.name}</span>
                    <small>
                      {blocked
                        ? ""
                        : !targets.data
                          ? "Checking…"
                          : target.project
                            ? `Continues in ${target.project.name}`
                            : target.problem}
                    </small>
                  </span>
                </Menu.Item>
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
