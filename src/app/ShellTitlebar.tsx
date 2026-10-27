import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderGit2,
  GitPullRequest,
  MessageSquare,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pencil,
} from "lucide-react";
import type { ChatSummary, Project } from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import { api } from "../lib/api";
import { useNavigationLock } from "../lib/navigation-lock";
import { useShortcutLabel } from "../lib/shortcuts";
import type { SidebarVisibility } from "./useSidebarVisibility";
import { sidebarDotSays, type SidebarAttention } from "./ActivityBar";
import type { ThreadTerminalDrawer } from "./useThreadTerminal";
import {
  panesOf,
  type PaneId,
  type WorkspacePanes,
} from "../lib/workspace-panes";
import { CiStatusIcon } from "./CiStatus";
import { ProjectBadge } from "../features/projects/ProjectBadge";
import {
  DevCheckoutLabel,
  DevSwitchMark,
} from "../features/sidebar/DevSwitchMenu";
import { DevRestartButton } from "../features/updates/DevRestartButton";
import { RunningVersion } from "../features/updates/RunningVersion";
import { openSettings } from "../lib/settings-page";
import { RelayMark } from "../ui/RelayMark";
import { PaneToggles } from "../ui/WorkspacePanes";
import "./titlebar.css";
import {
  projectComputer,
  usePairedComputers,
  useWakeComputer,
} from "../features/handoff/usePairedComputers";

/**
 * The sidebar's toggle, the mark and the version Relay runs, over the activity
 * bar and the sidebar. The sidebar's dot shows on the bar's Threads while
 * it's hidden, and on the toggle once the bar folds away with it.
 */
export function TitlebarBrand({
  sidebar: { hidden, barFolded, toggle, peekOpen, peekClose },
  attention,
  disabled,
}: {
  sidebar: SidebarVisibility;
  attention?: SidebarAttention;
  disabled: boolean;
}) {
  const keys = useShortcutLabel("sidebar");
  const dot = barFolded ? sidebarDotSays(attention) : undefined;
  return (
    <div className="project-titlebar-brand shell-brand">
      <span className="traffic-space" />
      <button
        type="button"
        className="icon-button relay-sidebar-toggle"
        title={`${hidden ? "Show" : "Hide"} sidebar${keys && ` · ${keys}`}`}
        aria-label={
          (hidden ? "Show sidebar" : "Hide sidebar") + (dot ? ` · ${dot}` : "")
        }
        aria-pressed={!hidden}
        disabled={disabled}
        onClick={toggle}
        onMouseEnter={peekOpen}
        onMouseLeave={peekClose}
      >
        <PanelLeft size={16} />
        {dot && (
          <span
            className={`sb-status ${attention} relay-brand-dot`}
            aria-hidden="true"
          >
            <i />
          </span>
        )}
      </button>
      <DevSwitchMark>
        <RelayMark size={38} />
      </DevSwitchMark>
      <RunningVersion onAbout={() => openSettings("about")} />
      {/* Under `npm run dev` only; empty, it takes no room. */}
      <div className="brand-dev">
        <DevCheckoutLabel />
        <DevRestartButton />
      </div>
    </div>
  );
}

/**
 * The window title: the project with its CI status, and the open thread; a
 * deep review's reviewer comes after its review, which opens on a click.
 */
export function ProjectTitle({
  project,
  chat,
  review,
  onError,
}: {
  project?: Project;
  chat?: ChatSummary;
  review?: { title: string; open: () => void };
  onError: (error: unknown) => void;
}) {
  const computers = usePairedComputers(!!project?.computer);
  const where = projectComputer(project, computers.data);
  return (
    <div className="project-window-title">
      {project?.plain || where ? (
        <span className="ci-plain">
          <ProjectBadge project={project} />
        </span>
      ) : project ? (
        <CiStatusIcon projectId={project.id} chatId={chat?.id}>
          <ProjectBadge project={project} />
        </CiStatusIcon>
      ) : (
        <FolderGit2 size={14} />
      )}
      <span className="project-window-name">
        {project?.name ?? "Workspace"}
      </span>
      {where && (
        <span className="project-window-where">
          on {where.name}
          {where.stopped ? " · WSL stopped" : where.online ? "" : " · offline"}
        </span>
      )}
      {where?.stopped && <WakeComputer id={where.id} onError={onError} />}
      <span className="breadcrumb-slash">/</span>
      {review && (
        <>
          <button
            type="button"
            className="breadcrumb-link"
            title={`Back to ${review.title}`}
            onClick={review.open}
          >
            {review.title}
          </button>
          <span className="breadcrumb-slash">/</span>
        </>
      )}
      {chat ? (
        <ThreadTitle key={chat.id} chat={chat} onError={onError} />
      ) : (
        <strong>{project?.scratch ? "New chat" : "New thread"}</strong>
      )}
    </div>
  );
}

/** WSL stopped the distribution the project lives in; nothing starts it again but this. */
function WakeComputer({
  id,
  onError,
}: {
  id: string;
  onError: (error: unknown) => void;
}) {
  const { waking, wake } = useWakeComputer(onError);
  return (
    <button
      type="button"
      className="breadcrumb-link"
      disabled={waking}
      onClick={() => void wake(id)}
    >
      {waking ? "Starting…" : "Reconnect"}
    </button>
  );
}

/** The header's thread name; double-click or use the pencil to rename it. */
function ThreadTitle({
  chat,
  onError,
}: {
  chat: ChatSummary;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const { title } = chat;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const done = useRef(false);
  async function rename(next: string) {
    const key = ["project-chats", chat.projectId];
    qc.setQueryData<ChatSummary[]>(key, (list) =>
      list?.map((c) =>
        c.id === chat.id ? { ...c, title: next, renamed: true } : c,
      ),
    );
    try {
      await api.renameProjectChat(chat.id, next);
    } catch (e) {
      onError(e);
    } finally {
      void qc.invalidateQueries({ queryKey: key });
    }
  }
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = value.replace(/\s+/g, " ").trim();
    if (commit && next && next !== title) void rename(next);
  };
  const edit = () => {
    done.current = false;
    setValue(title);
    setEditing(true);
  };
  if (!editing)
    return (
      <div className="thread-title">
        <strong title={`${title}\nDouble-click to rename`} onDoubleClick={edit}>
          {title}
        </strong>
        <button
          type="button"
          className="icon-button thread-title-edit"
          title="Rename thread"
          aria-label="Rename thread"
          onClick={edit}
        >
          <Pencil size={12} />
        </button>
      </div>
    );
  return (
    <input
      autoFocus
      className="thread-title-input"
      aria-label="Thread name"
      maxLength={120}
      value={value}
      size={Math.max(value.length, 8)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** How a pane's toggle looks; Changes is listed only for a PR thread, as its Review. */
function paneLook(id: PaneId, pull: PullRef | null, unseen?: boolean) {
  if (id === "chat")
    return { label: "Chat", icon: <MessageSquare size={14} /> };
  if (id === "panel")
    return { label: "Panel", icon: <PanelRight size={14} />, unseen };
  return { label: `PR #${pull?.number}`, icon: <GitPullRequest size={14} /> };
}

/**
 * Shows, hides and reorders the thread's panes. Its own changes aren't one:
 * they open in the editor from the Running card.
 */
export function ThreadPaneToggles({
  panes: { layout, visible, move },
  pull,
  filesOpen,
  unseen,
  onToggle,
}: {
  panes: WorkspacePanes;
  /** The panel has Files open, which may hold an unsaved edit. */
  filesOpen: boolean;
  /** The closed panel holds something the agent opened. */
  unseen?: boolean;
  pull: PullRef | null;
  onToggle: (id: PaneId) => void;
}) {
  const { locked } = useNavigationLock();
  return (
    <PaneToggles
      onToggle={onToggle}
      onMove={move}
      panes={panesOf(layout.order, !!pull).map((id) => ({
        id,
        open: visible.includes(id),
        // The panel stays open over an unsaved edit in Files, and so does
        // the last open pane. One off screen for lack of room still comes back.
        disabled:
          (id === "panel" && locked && visible.includes(id) && filesOpen) ||
          (visible.includes(id) && visible.length === 1),
        ...paneLook(id, pull, unseen),
      }))}
    />
  );
}

/** Shows or hides the thread's terminal drawer. */
export function TerminalToggle({
  terminal: { open, blocked, shown, toggle },
}: {
  terminal: ThreadTerminalDrawer;
}) {
  const keys = useShortcutLabel("terminal");
  return (
    <span
      title={
        blocked ?? `${open ? "Hide" : "Show"} terminal${keys && ` (${keys})`}`
      }
    >
      <button
        type="button"
        className={`pane-toggle ${shown ? "active" : ""}`}
        aria-label="Terminal"
        aria-pressed={shown}
        disabled={!!blocked}
        onClick={toggle}
      >
        <PanelBottom size={14} />
      </button>
    </span>
  );
}
