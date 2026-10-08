import { Menu } from "@base-ui/react/menu";
import {
  Archive,
  Check,
  ChevronRight,
  Clock,
  Copy,
  FolderGit2,
  Hourglass,
  Mail,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Split,
  SquarePen,
  Sunrise,
  Unlink,
} from "lucide-react";
import type { ChatSummary, ChatTriage } from "../../../shared/projects";
import {
  chatActivitySection,
  snoozePresets,
  wakeLabel,
} from "../../../shared/chat-activity";
import { agentName, agents } from "../../../shared/agents";
import { threadContextAgent } from "../../../shared/recipient";
import { api } from "../../lib/api";
import type { ThreadMenuAction } from "./useThreadActions";
import { MenuAction, MenuPopup } from "./SidebarMenu";

/** "After 3 quiet days, a merged PR or a commit". */
function autoSettleLabel(days: number | null | undefined, onCommit?: boolean) {
  const reasons = [
    ...(days === null
      ? []
      : [`${days ?? "…"} quiet day${days === 1 ? "" : "s"}`, "a merged PR"]),
    ...(onCommit ? ["a commit"] : []),
  ];
  const last = reasons.pop();
  return `After ${reasons.length ? `${reasons.join(", ")} or ${last}` : last}`;
}

/**
 * A thread's right-click menu: triage, naming, auto-settle
 * and copying, plus Fork from its latest answer on that answer's agent and
 * reloading the agent holding the conversation.
 */
export function ThreadMenu({
  chat,
  projectName,
  projectPath,
  now,
  unread,
  regenerating,
  reloading,
  autoSettleDays,
  settleOnCommit,
  settleKeys,
  canMove,
  onAction,
}: {
  chat: ChatSummary;
  projectName?: string;
  projectPath?: string;
  now: number;
  unread: boolean;
  regenerating: boolean;
  reloading: boolean;
  /** The project's value, else the app's; null settles nothing by time. */
  autoSettleDays: number | null | undefined;
  /** The project also settles a thread after its agent committed. */
  settleOnCommit?: boolean;
  settleKeys?: string;
  /** A Git project's thread working in the project folder. */
  canMove?: boolean;
  onAction: (action: ThreadMenuAction) => void;
}) {
  const section = chatActivitySection(chat, now);
  const busy = chat.running || chat.waiting;
  const review = chat.scope.kind === "review";
  const path = chat.worktree?.path ?? projectPath;
  const branch = chat.worktree?.branch ?? chat.branch;
  const triage = (triage: ChatTriage) => onAction({ kind: "triage", triage });
  const holder = threadContextAgent(chat);
  return (
    <MenuPopup side="bottom" align="start">
      <MenuAction
        icon={<SquarePen size={13} />}
        onClick={() => onAction({ kind: "new" })}
      >
        New thread{projectName ? ` in ${projectName}` : ""}
      </MenuAction>
      <MenuAction
        icon={<Split size={13} />}
        hint={chat.provider && agentName(chat.provider)}
        disabled={chat.running || review}
        onClick={() => onAction({ kind: "fork" })}
      >
        Fork from last answer
      </MenuAction>
      {holder && agents[holder].reload && (
        <MenuAction
          icon={<RefreshCw size={13} />}
          hint={agentName(holder)}
          // Restarting mid-answer or under background work would cut it off.
          disabled={busy || reloading || !!chat.pending?.length}
          onClick={() => onAction({ kind: "reload" })}
        >
          {reloading ? "Reloading session…" : "Reload session"}
        </MenuAction>
      )}
      {canMove && (
        <MenuAction
          icon={<FolderGit2 size={13} />}
          disabled={busy || !!chat.pending?.length}
          onClick={() => onAction({ kind: "move-worktree" })}
        >
          Move into its own worktree…
        </MenuAction>
      )}
      {section === "settled" ? (
        <MenuAction
          icon={<RotateCcw size={13} />}
          onClick={() => triage({ kind: "unsettle" })}
        >
          Unsettle thread
        </MenuAction>
      ) : (
        <MenuAction
          icon={<Check size={13} />}
          hint={settleKeys}
          disabled={busy}
          onClick={() => onAction({ kind: "settle" })}
        >
          Settle thread
        </MenuAction>
      )}
      {section === "snoozed" ? (
        <MenuAction
          icon={<Sunrise size={13} />}
          hint={wakeLabel(chat.snoozedUntil!, new Date(now))}
          onClick={() => triage({ kind: "wake" })}
        >
          Wake thread
        </MenuAction>
      ) : (
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger
            className="sb-menu-item"
            disabled={!!chat.waiting}
          >
            <span className="sb-menu-label">
              <Clock size={13} />
              Snooze
            </span>
            <ChevronRight size={12} />
          </Menu.SubmenuTrigger>
          <MenuPopup side="right" align="start">
            {snoozePresets(new Date(now)).map((preset) => (
              <Menu.Item
                key={preset.id}
                className="sb-menu-item"
                onClick={() => triage({ kind: "snooze", until: preset.until })}
              >
                <span>{preset.label}</span>
                <small>{wakeLabel(preset.until, new Date(now))}</small>
              </Menu.Item>
            ))}
          </MenuPopup>
        </Menu.SubmenuRoot>
      )}
      {chat.startedBy && (
        <MenuAction
          icon={<Unlink size={13} />}
          onClick={() => onAction({ kind: "detach" })}
        >
          Detach from lead
        </MenuAction>
      )}
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => onAction({ kind: "rename" })}
      >
        Rename thread
      </MenuAction>
      <MenuAction
        icon={<Sparkles size={13} />}
        disabled={regenerating}
        onClick={() => onAction({ kind: "regenerate" })}
      >
        {regenerating ? "Regenerating title…" : "Regenerate title"}
      </MenuAction>
      {!unread && (
        <MenuAction
          icon={<Mail size={13} />}
          onClick={() => triage({ kind: "unread" })}
        >
          Mark unread
        </MenuAction>
      )}
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger className="sb-menu-item">
          <span className="sb-menu-label">
            <Hourglass size={13} />
            Auto-settle
          </span>
          <ChevronRight size={12} />
        </Menu.SubmenuTrigger>
        <MenuPopup side="right" align="start">
          {autoSettleDays === null && !settleOnCommit ? (
            <div className="sb-menu-heading">Off in Settings</div>
          ) : (
            <>
              <Menu.Item
                className="sb-menu-item"
                onClick={() => triage({ kind: "auto-settle", enabled: true })}
              >
                <span>{autoSettleLabel(autoSettleDays, settleOnCommit)}</span>
                {!chat.autoSettleOff && <Check size={13} />}
              </Menu.Item>
              <Menu.Item
                className="sb-menu-item"
                onClick={() => triage({ kind: "auto-settle", enabled: false })}
              >
                <span>Never for this thread</span>
                {chat.autoSettleOff && <Check size={13} />}
              </Menu.Item>
            </>
          )}
        </MenuPopup>
      </Menu.SubmenuRoot>
      {projectName && (
        <MenuAction
          icon={<Settings2 size={13} />}
          onClick={() => onAction({ kind: "project-settings" })}
        >
          Project settings
        </MenuAction>
      )}
      <Menu.Separator className="sb-menu-separator" />
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger className="sb-menu-item">
          <span className="sb-menu-label">
            <Copy size={13} />
            Copy
          </span>
          <ChevronRight size={12} />
        </Menu.SubmenuTrigger>
        <MenuPopup side="right" align="start">
          <Menu.Item
            className="sb-menu-item"
            onClick={() => void api.writeClipboard(chat.title)}
          >
            Title
          </Menu.Item>
          {path && (
            <Menu.Item
              className="sb-menu-item"
              onClick={() => void api.writeClipboard(path)}
            >
              Path
            </Menu.Item>
          )}
          {branch && (
            <Menu.Item
              className="sb-menu-item"
              onClick={() => void api.writeClipboard(branch)}
            >
              Branch
            </Menu.Item>
          )}
          <Menu.Item
            className="sb-menu-item"
            onClick={() => void api.writeClipboard(chat.id)}
          >
            Thread ID
          </Menu.Item>
        </MenuPopup>
      </Menu.SubmenuRoot>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<Archive size={13} />}
        disabled={!!chat.running || !!chat.pending?.length || !!chat.nextSend}
        onClick={() => triage({ kind: "archive" })}
      >
        Archive thread
      </MenuAction>
    </MenuPopup>
  );
}
