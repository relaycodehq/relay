import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Pencil,
  GitPullRequest,
  Plus,
  Search,
  Settings2,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import type { SidebarView } from "../../shared/types";
import {
  projectNameSchema,
  type Project,
  type ChatSummary,
} from "../../shared/projects";
import { chatActivitySections } from "../../shared/chat-activity";
import { agentsSince } from "../../shared/waiting";
import {
  parentGroup,
  type ProjectFolderNode,
} from "../../shared/project-folders";
import { api } from "../lib/api";
import { useShortcutLabel } from "../lib/shortcuts";
import { useNow } from "../lib/useNow";
import { useSidebarView } from "../lib/useSidebarView";
import { groupKey, useSidebarFolds } from "../lib/useSidebarFolds";
import { useShelves } from "../lib/useShelves";
import { useProjectGroups } from "../lib/useProjectGroups";
import { dropSide, useProjectDrag } from "../lib/useProjectDrag";
import { useSidebarThreads } from "../lib/useSidebarThreads";
import { useUnread } from "../lib/useUnread";
import { useThreadSearch } from "../lib/useThreadSearch";
import { useThreadActions } from "../lib/useThreadActions";
import { useActivityKeys } from "../lib/useActivityKeys";
import { useAttention } from "../lib/useAttention";
import { MenuAction, MenuPopup } from "./SidebarMenu";
import { ErrorBox, IconButton, Spinner } from "./ui";
import { CheckUpdatesButton, UpdateButton } from "./UpdateButton";
import { AgentUpdateButton } from "./AgentUpdates";
import type { SettingsCategory } from "./Settings";
import { ClockifyTimer } from "./plugins/ClockifyTimer";
import { useProjectIcon } from "./ProjectBadge";
import { NameInput } from "./NameInput";
import {
  firstThreads,
  ShowMore,
  ThreadRow,
  type SidebarRows,
} from "./SidebarThread";
import { ActivityView } from "./SidebarActivity";
import "./sidebar.css";

/** A section's heading; the label folds the list beneath it. */
function SectionTitle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <h2>
      <button
        className="sb-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <ChevronRight
          size={11}
          className="sb-project-chevron"
          data-open={open || undefined}
          aria-hidden
        />
      </button>
    </h2>
  );
}

function ProjectFolderIcon({ id, open }: { id: string; open: boolean }) {
  const icon = useProjectIcon(id);
  if (icon) return <img className="sb-project-icon" src={icon} alt="" />;
  return open ? <FolderOpen size={15} /> : <Folder size={15} />;
}

export function ProjectSidebar({
  initialView,
  projects,
  projectId,
  chatId,
  draftId,
  account,
  onChat,
  onNew,
  onPickNew,
  onNewScratch,
  onDraft,
  onSendDraft,
  onAdd,
  onShared,
  onSettings,
  onAccount,
  onInbox,
  inbox,
  onAttention,
}: {
  initialView?: SidebarView;
  projects: Project[];
  projectId?: string;
  chatId?: string;
  /** The unsent thread that's open, when no thread is. */
  draftId?: string;
  account?: string;
  onChat: (c: ChatSummary) => void;
  onNew: (p: Project) => void;
  /** New thread in a project still to be chosen. */
  onPickNew: () => void;
  onNewScratch: () => void;
  /** Back to one of a project's unsent threads. */
  onDraft: (p: Project, id: string) => void;
  /** Sends the open unsent thread's draft from its composer. */
  onSendDraft: () => void;
  onAdd: () => void;
  onShared: (p: Project) => void;
  /** Opens Settings, at `category` when given. */
  onSettings: (category?: SettingsCategory) => void;
  onAccount: () => void;
  onInbox: () => void;
  /** The Pull requests page is showing. */
  inbox?: boolean;
  /** Strongest status mark among active threads, for the collapsed titlebar. */
  onAttention?: (mark: "waiting" | "unread" | undefined) => void;
}) {
  const now = useNow(30_000);
  // Scratchpad chats list under their own heading, never as projects.
  const realProjects = projects.filter((p) => !p.scratch);
  const scratchIds = new Set(
    projects.filter((p) => p.scratch).map((p) => p.id),
  );
  const {
    view,
    toggle: toggleView,
    error: viewError,
  } = useSidebarView(initialView);
  const folds = useSidebarFolds();
  const shelves = useShelves();
  const [error, setError] = useState<string>();
  const groups = useProjectGroups(realProjects, folds.setOpen, setError);
  const drag = useProjectDrag(groups, folds.setOpen);
  const autoSettleDays = useQuery({
    queryKey: ["auto-settle-days"],
    queryFn: () => api.autoSettleDays(),
  }).data;
  const byId = new Map(projects.map((p) => [p.id, p]));
  const { all, away } = useSidebarThreads(realProjects, chatId);
  const unread = useUnread(chatId, all);
  const search = useThreadSearch(all, byId);
  const sections = chatActivitySections(all, now);
  const actions = useThreadActions({
    chatId,
    active: sections.active,
    projects: byId,
    scratch: scratchIds,
    open: onChat,
    onNew,
    setError,
  });
  const { open, settle } = actions;
  const shortcuts = view === "activity" && !search.query;
  const cmdHeld = useActivityKeys({
    active: sections.active,
    chatId,
    jumping: shortcuts,
    open,
    settle,
  });
  const attention = useAttention(sections.active, unread, onAttention);
  const settleKeys = useShortcutLabel("settle");
  const rows: SidebarRows = {
    chatId,
    now,
    unread,
    projects: byId,
    actions,
    autoSettleDays,
    settleKeys,
  };
  const newThreadKeys = useShortcutLabel("new-thread");
  const newScratchKeys = useShortcutLabel("new-scratch");
  const activityKeys = useShortcutLabel("activity");
  const renderProject = (p: Project) => {
    const chats = all.filter((c) => c.projectId === p.id);
    const isOpen = folds.isOpen(p.id, p.id === projectId);
    const more = folds.showsAll(p.id);
    const busy = chats.some((c) => c.running || agentsSince(c.pending));
    return (
      <section
        key={p.id}
        className={[
          "sb-project",
          p.id === projectId && "current",
          drag.dragging === p.id && "dragging",
          drag.drop?.kind === "project" &&
            drag.drop.id === p.id &&
            drag.dragging !== p.id &&
            `drop-${drag.drop.where}`,
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={(e) =>
          drag.over(e, { kind: "project", id: p.id, where: dropSide(e) })
        }
        onDrop={(e) =>
          drag.drop?.kind === "project" && drag.dropOn(e, drag.drop)
        }
      >
        {groups.renamingProject === p.id ? (
          <div className="sb-project-row">
            <span className="sb-project-expand">
              <ProjectFolderIcon id={p.id} open={isOpen} />
            </span>
            <NameInput
              label="Project name"
              initial={p.name}
              schema={projectNameSchema}
              placeholder="Project name"
              className="sb-group-input sb-project-input"
              onCancel={() => groups.setRenamingProject(undefined)}
              onSubmit={(name) => {
                groups.setRenamingProject(undefined);
                groups.renameProject(p.id, name);
              }}
            />
          </div>
        ) : (
          <ContextMenu.Root>
            <ContextMenu.Trigger
              className="sb-project-row"
              draggable
              onDragStart={(e) => drag.startProject(e, p.id)}
              onDragEnd={drag.end}
            >
              <button
                className="sb-project-expand"
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
                aria-expanded={isOpen}
                onClick={() => folds.setOpen(p.id, !isOpen)}
              >
                <ProjectFolderIcon id={p.id} open={isOpen} />
              </button>
              {/* Like a group label, the whole row toggles; only its actions don't. */}
              <button
                className="sb-project-name"
                title={p.path}
                aria-expanded={isOpen}
                onClick={() => folds.setOpen(p.id, !isOpen)}
              >
                <span>{p.name}</span>
                <ChevronRight
                  size={11}
                  className="sb-project-chevron"
                  data-open={isOpen || undefined}
                  aria-hidden
                />
                {busy && !isOpen && (
                  <span className="sb-status running" title="Working">
                    <Spinner size={11} steady />
                  </span>
                )}
              </button>
              <div className="sb-row-actions">
                <Menu.Root>
                  <Menu.Trigger
                    className="icon-button"
                    aria-label={`Project actions for ${p.name}`}
                    title="Project actions"
                  >
                    <Ellipsis size={13} />
                  </Menu.Trigger>
                  {projectMenu(p)}
                </Menu.Root>
                <IconButton
                  label={`Shared conversations in ${p.name}`}
                  onClick={() => onShared(p)}
                >
                  <Users size={13} />
                </IconButton>
                <IconButton
                  label={`New thread in ${p.name}`}
                  onClick={() => onNew(p)}
                >
                  <Plus size={14} />
                </IconButton>
              </div>
            </ContextMenu.Trigger>
            {projectMenu(p)}
          </ContextMenu.Root>
        )}
        {isOpen && (
          <div className="sb-thread-list">
            {firstThreads(chats, more).map((c) => (
              <ThreadRow key={c.id} chat={c} rows={rows} />
            ))}
            {!chats.length && (
              <button className="sb-thread sb-ghost" onClick={() => onNew(p)}>
                <span className="sb-thread-title">Start a thread</span>
              </button>
            )}
            <ShowMore
              total={chats.length}
              more={more}
              onToggle={() => folds.setShowsAll(p.id, !more)}
            />
          </div>
        )}
      </section>
    );
  };

  const projectMenu = (p: Project) => (
    <MenuPopup side="bottom" align="end">
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => groups.setRenamingProject(p.id)}
      >
        Rename
      </MenuAction>
      <MenuAction icon={<SquarePen size={13} />} onClick={() => onNew(p)}>
        New thread
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderOpen size={13} />}
        onClick={() => groups.reveal(p.id)}
      >
        Open in Finder
      </MenuAction>
      <MenuAction
        icon={<Copy size={13} />}
        onClick={() => void api.writeClipboard(p.path)}
      >
        Copy path
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger className="sb-menu-item">
          <span className="sb-menu-label">
            <FolderInput size={13} />
            Move to group
          </span>
          <ChevronRight size={12} />
        </Menu.SubmenuTrigger>
        {moveMenu(p)}
      </Menu.SubmenuRoot>
    </MenuPopup>
  );

  const moveMenu = (p: Project) => (
    <MenuPopup side="right" align="start">
      {groups.paths.map((path) => (
        <Menu.Item
          key={path}
          className="sb-menu-item"
          disabled={path === (p.folder ?? "")}
          onClick={() => groups.moveProject(p.id, { kind: "folder", path })}
        >
          <span className="sb-menu-group">
            {path.split("/").map((name, i, parts) => (
              <span key={i} className={i < parts.length - 1 ? "parent" : ""}>
                {name}
              </span>
            ))}
          </span>
          {path === p.folder && <Check size={13} />}
        </Menu.Item>
      ))}
      {p.folder && (
        <MenuAction
          icon={<FolderMinus size={13} />}
          onClick={() => groups.moveProject(p.id, { kind: "folder", path: "" })}
        >
          Remove from group
        </MenuAction>
      )}
      {groups.paths.length > 0 && (
        <Menu.Separator className="sb-menu-separator" />
      )}
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => groups.startGroup("", p.id)}
      >
        New group…
      </MenuAction>
    </MenuPopup>
  );

  const groupMenu = (folder: ProjectFolderNode) => (
    <MenuPopup side="bottom" align="end">
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => {
          groups.setAdding(undefined);
          groups.setRenaming(folder.path);
        }}
      >
        Rename
      </MenuAction>
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => groups.startGroup(folder.path)}
      >
        New group inside
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderMinus size={13} />}
        hint="Projects stay"
        onClick={() => groups.removeGroup(folder.path)}
      >
        Remove group
      </MenuAction>
    </MenuPopup>
  );

  function renderFolder(node: ProjectFolderNode): React.ReactNode {
    return (
      <>
        {groups.adding?.parent === node.path && (
          <NameInput
            label="New group name"
            onCancel={() => groups.setAdding(undefined)}
            onSubmit={(name) => {
              groups.setAdding(undefined);
              groups.createGroup(node.path, name, groups.adding?.project);
            }}
          />
        )}
        {node.folders.map((folder) => {
          const key = groupKey(folder.path);
          const isOpen = folds.isOpen(key, true);
          const into =
            drag.drop?.kind === "folder" && drag.drop.path === folder.path;
          const empty =
            !folder.folders.length &&
            !folder.projects.length &&
            groups.adding?.parent !== folder.path;
          return (
            <section
              key={folder.path}
              className={[
                "sb-folder",
                drag.draggingGroup === folder.path && "dragging",
                drag.drop?.kind === "group" &&
                  drag.drop.path === folder.path &&
                  `drop-${drag.drop.where}`,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={`Group ${folder.path}`}
              onDragOver={(e) => {
                // Groups only trade places with their siblings.
                const { draggingGroup } = drag;
                if (
                  !draggingGroup ||
                  draggingGroup === folder.path ||
                  parentGroup(draggingGroup) !== parentGroup(folder.path)
                )
                  return;
                drag.over(e, {
                  kind: "group",
                  path: folder.path,
                  where: dropSide(e),
                });
              }}
              onDrop={(e) =>
                drag.drop?.kind === "group" && drag.dropOn(e, drag.drop)
              }
            >
              {groups.renaming === folder.path ? (
                <NameInput
                  label="Group name"
                  initial={folder.name}
                  onCancel={() => groups.setRenaming(undefined)}
                  onSubmit={(name) => {
                    groups.setRenaming(undefined);
                    groups.renameGroup(folder.path, name, isOpen);
                  }}
                />
              ) : (
                <ContextMenu.Root>
                  <ContextMenu.Trigger
                    className={`sb-folder-row ${into ? "drop-into" : ""}`}
                    draggable
                    onDragStart={(e) => drag.startGroup(e, folder.path)}
                    onDragEnd={drag.end}
                    onDragOver={(e) => {
                      if (!drag.dragging) return;
                      drag.over(e, { kind: "folder", path: folder.path });
                      drag.openWhileDragging(key, isOpen);
                    }}
                    onDrop={(e) =>
                      drag.dropOn(e, { kind: "folder", path: folder.path })
                    }
                  >
                    <button
                      className="sb-folder-toggle"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} group ${folder.path}`}
                      aria-expanded={isOpen}
                      title="Double-click to rename"
                      onClick={() => folds.setOpen(key, !isOpen)}
                      onDoubleClick={() => groups.setRenaming(folder.path)}
                    >
                      <span>{folder.name}</span>
                      <ChevronRight size={11} />
                    </button>
                    <div className="sb-row-actions">
                      <Menu.Root>
                        <Menu.Trigger
                          className="icon-button"
                          aria-label={`Group actions for ${folder.path}`}
                          title="Group actions"
                        >
                          <Ellipsis size={13} />
                        </Menu.Trigger>
                        {groupMenu(folder)}
                      </Menu.Root>
                    </div>
                  </ContextMenu.Trigger>
                  {groupMenu(folder)}
                </ContextMenu.Root>
              )}
              {isOpen && (
                <div className="sb-folder-body">
                  {renderFolder(folder)}
                  {empty && (
                    <div
                      className={`sb-group-empty ${into ? "drop-into" : ""}`}
                      onDragOver={(e) =>
                        drag.over(e, { kind: "folder", path: folder.path })
                      }
                      onDrop={(e) =>
                        drag.dropOn(e, { kind: "folder", path: folder.path })
                      }
                    >
                      <FolderInput size={13} />
                      {drag.dragging ? "Drop here" : "Drag projects here"}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {node.projects.map(renderProject)}
      </>
    );
  }

  const scratch = all.filter((c) => scratchIds.has(c.projectId));
  const moreScratch = folds.showsAll("scratchpad");
  // The open Scratchpad chat before its first message.
  const scratchDraft = !!projectId && scratchIds.has(projectId) && !chatId;
  const scratchpad = (
    <section className="sb-scratchpad">
      <div className="sb-section-heading">
        <SectionTitle
          label="Scratchpad"
          open={!folds.folded.scratchpad}
          onToggle={() => folds.fold("scratchpad")}
        />
        <IconButton
          label={`New chat  ${newScratchKeys}`.trim()}
          onClick={onNewScratch}
        >
          <Plus size={14} />
        </IconButton>
      </div>
      {!folds.folded.scratchpad && (
        <div className="sb-thread-list flat">
          {scratchDraft && (
            <div className="sb-thread-row">
              <button className="sb-thread selected" disabled>
                <span className="sb-thread-title">New chat</span>
              </button>
            </div>
          )}
          {firstThreads(scratch, moreScratch).map((c) => (
            <ThreadRow key={c.id} chat={c} rows={rows} />
          ))}
          {!scratch.length && !scratchDraft && (
            <button className="sb-thread sb-ghost" onClick={onNewScratch}>
              <span className="sb-thread-title">Ask anything</span>
            </button>
          )}
          <ShowMore
            total={scratch.length}
            more={moreScratch}
            onToggle={() => folds.setShowsAll("scratchpad", !moreScratch)}
          />
        </div>
      )}
    </section>
  );

  const threads = (
    <div className="sb-scroll">
      <nav className="sb-nav">
        <button
          className={`sb-nav-item ${inbox ? "selected" : ""}`}
          aria-current={inbox ? "page" : undefined}
          onClick={onInbox}
        >
          <GitPullRequest size={15} />
          Pull requests
        </button>
      </nav>
      {scratchpad}
      <div
        className={`sb-section-heading ${
          drag.drop?.kind === "folder" && drag.drop.path === ""
            ? "drop-into"
            : ""
        }`}
        title={drag.dragging ? "Drop to move out of groups" : undefined}
        onDragOver={(e) => drag.over(e, { kind: "folder", path: "" })}
        onDrop={(e) => drag.dropOn(e, { kind: "folder", path: "" })}
      >
        <SectionTitle
          label="Projects"
          open={!folds.folded.projects}
          onToggle={() => folds.fold("projects")}
        />
        <div className="sb-heading-actions">
          <div className="sb-row-actions">
            <IconButton label="New group" onClick={() => groups.startGroup("")}>
              <FolderPlus size={13} />
            </IconButton>
          </div>
          <IconButton label="Add project" onClick={onAdd}>
            <Plus size={14} />
          </IconButton>
        </div>
      </div>
      {error && <p className="sb-note error">{error}</p>}
      {!folds.folded.projects && renderFolder(groups.tree)}
      {!folds.folded.projects && !realProjects.length && (
        <p className="sb-note">Add a project folder to get started.</p>
      )}
    </div>
  );

  const { results, listed } = search;
  const searching = (
    <div className="sb-scroll">
      <div className="sb-view-heading">
        <h2>Results</h2>
        <small>{results.length}</small>
      </div>
      <div className="sb-thread-list flat">
        {listed.map((c) => (
          <ThreadRow key={c.id} chat={c} rows={rows} withProject />
        ))}
        {listed.length < results.length && (
          <button className="sb-thread sb-ghost" onClick={search.listAll}>
            <span className="sb-thread-title">
              Show {results.length - listed.length} more
            </span>
          </button>
        )}
      </div>
      {!results.length && <p className="sb-note">No matching threads.</p>}
    </div>
  );

  return (
    <div className="sb">
      <div className="sb-top">
        <label className="sb-search">
          <Search size={13} />
          <input
            aria-label="Search threads"
            placeholder="Search"
            value={search.text}
            onChange={(e) => search.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") search.setText("");
            }}
          />
          {search.text && (
            <button
              className="sb-search-clear"
              aria-label="Clear search"
              onClick={() => search.setText("")}
            >
              <X size={12} />
            </button>
          )}
        </label>
        <button
          className="sb-top-button"
          aria-label="New thread"
          title={`New thread  ${newThreadKeys}`.trim()}
          onClick={onPickNew}
        >
          <Plus size={16} />
        </button>
        <button
          className={`sb-top-button sb-bell ${view === "activity" ? "active" : ""}`}
          aria-pressed={view === "activity"}
          aria-label="View activity"
          title={`View activity  ${activityKeys}`.trim()}
          onClick={() => {
            search.setText("");
            toggleView();
          }}
        >
          <Bell size={15} />
          {attention > 0 && (
            <span className="sb-bell-count">
              {attention > 9 ? "9+" : attention}
            </span>
          )}
        </button>
      </div>
      {search.query ? (
        searching
      ) : view === "activity" ? (
        <ActivityView
          rows={rows}
          threads={all}
          sections={sections}
          away={away}
          hints={shortcuts && cmdHeld}
          shelves={shelves}
          draftId={draftId}
          onDraft={onDraft}
          onSendDraft={onSendDraft}
        />
      ) : (
        threads
      )}
      {viewError && <ErrorBox error={viewError} />}
      <div className="sb-footer">
        <button
          className={`sb-account ${account ? "signed-in" : ""}`}
          title={account}
          aria-label={account}
          onClick={onAccount}
        >
          <span className="sb-avatar" aria-hidden>
            {(account ?? "?").slice(0, 2).toUpperCase()}
          </span>
          {!account && <span>Connect Gitea</span>}
        </button>
        <ClockifyTimer
          projectId={projectId}
          projectName={projects.find((p) => p.id === projectId)?.name}
          chatId={chatId}
          onSetUp={() => onSettings("plugins")}
        />
        <UpdateButton />
        <CheckUpdatesButton />
        <AgentUpdateButton onDetails={() => onSettings("models")} />
        <IconButton label="Open settings" onClick={() => onSettings()}>
          <Settings2 size={15} />
        </IconButton>
      </div>
    </div>
  );
}
