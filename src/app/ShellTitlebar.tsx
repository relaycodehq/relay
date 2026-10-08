import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderGit2,
  GitCompareArrows,
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
import type { ThreadTerminalDrawer } from "./useThreadTerminal";
import {
  panesOf,
  type PaneId,
  type WorkspacePanes,
} from "../lib/workspace-panes";
import { CiStatusIcon } from "./CiStatus";
import { ProjectBadge } from "../features/projects/ProjectBadge";
import { DevSwitchMark } from "../features/sidebar/DevSwitchMenu";
import { RelayMark } from "../ui/RelayMark";
import { PaneToggles } from "../ui/WorkspacePanes";
import "./titlebar.css";

/** The sidebar's toggle and the mark; the toggle echoes the sidebar's dot while it's hidden. */
export function TitlebarBrand({
  sidebar: { hidden, toggle, peekOpen, peekClose },
  attention,
  disabled,
}: {
  sidebar: SidebarVisibility;
  /** The sidebar's unread / needs-input dot. */
  attention?: "waiting" | "unread";
  disabled: boolean;
}) {
  const keys = useShortcutLabel("sidebar");
  const dot =
    hidden && attention
      ? attention === "waiting"
        ? "Needs your input"
        : "New activity"
      : undefined;
  return (
    <div className="project-titlebar-brand">
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
    </div>
  );
}

/** The window title: the project with its CI status, and the open thread. */
export function ProjectTitle({
  project,
  chat,
  onError,
}: {
  project?: Project;
  chat?: ChatSummary;
  onError: (error: unknown) => void;
}) {
  return (
    <div className="project-window-title">
      {project?.plain ? (
        <span className="ci-plain">
          <ProjectBadge id={project.id} name={project.name} />
        </span>
      ) : project ? (
        <CiStatusIcon projectId={project.id} chatId={chat?.id}>
          <ProjectBadge id={project.id} name={project.name} />
        </CiStatusIcon>
      ) : (
        <FolderGit2 size={14} />
      )}
      <span>{project?.name ?? "Workspace"}</span>
      <span className="breadcrumb-slash">/</span>
      {chat ? (
        <ThreadTitle key={chat.id} chat={chat} onError={onError} />
      ) : (
        <strong>{project?.scratch ? "New chat" : "New thread"}</strong>
      )}
    </div>
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

/** Shows, hides and reorders the thread's panes; a PR thread's Changes is its Review. */
export function ThreadPaneToggles({
  panes: { layout, visible, move },
  plain,
  pull,
  lines,
  filesOpen,
  onToggle,
}: {
  panes: WorkspacePanes;
  /** The panel has Files open, which may hold an unsaved edit. */
  filesOpen: boolean;
  plain?: boolean;
  pull: PullRef | null;
  /** Lines the working tree changed, beside Changes. */
  lines?: { additions: number; deletions: number };
  onToggle: (id: PaneId) => void;
}) {
  const { locked } = useNavigationLock();
  return (
    <PaneToggles
      onToggle={onToggle}
      onMove={move}
      panes={panesOf(layout.order, plain).map((id) => ({
        id,
        open: layout.open[id],
        // The panel stays open over an unsaved edit in Files, and so does
        // the last open pane.
        disabled:
          (id === "panel" && locked && layout.open.panel && filesOpen) ||
          (layout.open[id] && visible.length === 1),
        ...(id === "chat"
          ? { label: "Chat", icon: <MessageSquare size={14} /> }
          : id === "panel"
            ? { label: "Panel", icon: <PanelRight size={14} /> }
            : pull
              ? {
                  label: `PR #${pull.number}`,
                  icon: <GitPullRequest size={14} />,
                }
              : {
                  label: "Changes",
                  icon: <GitCompareArrows size={14} />,
                  stat: lines,
                }),
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
