import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { FolderGit2, MonitorUp, Settings2, Plus } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import {
  handoffBlocked,
  worktreeFirst,
  type HandoffTarget,
  type PairedComputer,
} from "../../../shared/handoff";
import { Modal } from "../../ui/ui";
import { ComputerPicker } from "./ComputerPicker";
import { api } from "../../lib/api";
import { DeviceIcon } from "./DeviceIcon";
import { canPick, targetLine } from "./clone-there";
import { reachable } from "./computer-status";
import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import "./handoff.css";

/**
 * The thread's hand-off button. With no computer paired it opens the
 * computer picker; otherwise it lists the paired ones, each with the
 * project it has for this repository, or why it can't take the thread.
 */
export function HandoffButton({
  chat,
  className,
  onSettings,
  onError,
}: {
  chat: ChatSummary;
  /** The look of the place it sits in. */
  className: string;
  onSettings: () => void;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState(false);
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
      {!paired.length ? (
        <button
          type="button"
          className={className}
          aria-label={label}
          title={label}
          disabled={!computers.data}
          onClick={() => setPicking(true)}
        >
          <MonitorUp size={14} />
        </button>
      ) : (
        <Menu.Root open={open} onOpenChange={setOpen}>
          <Menu.Trigger className={className} aria-label={label} title={label}>
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
                    disabled={!!blocked || !targets.data || !canPick(target)}
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
                            : targetLine(target, "Continues")}
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
                  onClick={() => setPicking(true)}
                >
                  <Plus size={14} />
                  <span>Connect another computer…</span>
                </Menu.Item>
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
      )}
      {picking && (
        <Modal
          title="Choose a computer"
          className="computer-picker-dialog"
          onClose={() => {
            if (!connecting) setPicking(false);
          }}
        >
          <ComputerPicker
            onBusy={setConnecting}
            onPick={() => {
              setPicking(false);
              setOpen(true);
            }}
          />
        </Modal>
      )}
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
    online: reachable(c),
  }));
