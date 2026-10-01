import { Menu } from "@base-ui/react/menu";
import {
  Archive,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Hourglass,
  Mail,
  Pencil,
  RotateCcw,
  Sparkles,
  Split,
  SquarePen,
  Sunrise,
} from "lucide-react";
import type { ChatSummary, ChatTriage } from "../../shared/projects";
import {
  chatActivitySection,
  snoozePresets,
  wakeLabel,
} from "../../shared/chat-activity";
import { agentName } from "../../shared/agents";
import { api } from "../lib/api";
import type { ThreadMenuAction } from "../lib/useThreadActions";
import { MenuAction, MenuPopup } from "./SidebarMenu";

/**
 * A thread's right-click menu, after T3 Code's: triage, naming, auto-settle
 * and copying, plus Fork from its latest answer on that answer's agent.
 */
export function ThreadMenu({
  chat,
  projectName,
  projectPath,
  now,
  unread,
  regenerating,
  autoSettleDays,
  settleKeys,
  onAction,
}: {
  chat: ChatSummary;
  projectName?: string;
  projectPath?: string;
  now: number;
  unread: boolean;
  regenerating: boolean;
  /** The Settings value; null turns auto-settle off everywhere. */
  autoSettleDays: number | null | undefined;
  settleKeys?: string;
  onAction: (action: ThreadMenuAction) => void;
}) {
  const section = chatActivitySection(chat, now);
  const busy = chat.running || chat.waiting;
  const review = chat.scope.kind === "review";
  const path = chat.worktree?.path ?? projectPath;
  const branch = chat.worktree?.branch ?? chat.branch;
  const triage = (triage: ChatTriage) => onAction({ kind: "triage", triage });
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
          {autoSettleDays === null ? (
            <div className="sb-menu-heading">
              Off for every thread in Settings
            </div>
          ) : (
            <>
              <Menu.Item
                className="sb-menu-item"
                onClick={() => triage({ kind: "auto-settle", enabled: true })}
              >
                <span>
                  After {autoSettleDays ?? "…"} quiet day
                  {autoSettleDays === 1 ? "" : "s"} or a merged PR
                </span>
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
