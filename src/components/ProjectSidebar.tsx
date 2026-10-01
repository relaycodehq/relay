import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, GitPullRequest, Plus } from "lucide-react";
import type { SidebarView } from "../../shared/types";
import type { ChatSummary, Project } from "../../shared/projects";
import { chatActivitySections } from "../../shared/chat-activity";
import { api } from "../lib/api";
import { useShortcutLabel } from "../lib/shortcuts";
import { useNow } from "../lib/useNow";
import { useSidebarView } from "../lib/useSidebarView";
import { useSidebarFolds } from "../lib/useSidebarFolds";
import { useShelves } from "../lib/useShelves";
import { useProjectGroups } from "../lib/useProjectGroups";
import { useProjectDrag } from "../lib/useProjectDrag";
import { useSidebarThreads } from "../lib/useSidebarThreads";
import { useUnread } from "../lib/useUnread";
import { useThreadSearch } from "../lib/useThreadSearch";
import { useThreadActions } from "../lib/useThreadActions";
import { useActivityKeys } from "../lib/useActivityKeys";
import { useAttention } from "../lib/useAttention";
import { ErrorBox } from "./ui";
import type { SettingsCategory } from "./Settings";
import { SidebarFooter } from "./SidebarFooter";
import type { SidebarRows } from "./SidebarThread";
import { SearchField, SearchResults } from "./SidebarSearch";
import { ActivityView } from "./SidebarActivity";
import { ProjectsSection, Scratchpad } from "./SidebarProjects";
import "./sidebar.css";

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
  const activity = view === "activity" && !search.query;
  const cmdHeld = useActivityKeys({
    active: sections.active,
    chatId,
    jumping: activity,
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
  const activityKeys = useShortcutLabel("activity");
  return (
    <div className="sb">
      <div className="sb-top">
        <SearchField search={search} />
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
      {/* One scroller for every view, so it keeps its place across them. */}
      <div className={activity ? "sb-scroll sb-activity" : "sb-scroll"}>
        {search.query ? (
          <SearchResults search={search} rows={rows} />
        ) : activity ? (
          <ActivityView
            rows={rows}
            threads={all}
            sections={sections}
            away={away}
            hints={cmdHeld}
            shelves={shelves}
            draftId={draftId}
            onDraft={onDraft}
            onSendDraft={onSendDraft}
          />
        ) : (
          <>
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
            <Scratchpad
              chats={all.filter((c) => scratchIds.has(c.projectId))}
              draft={!!projectId && scratchIds.has(projectId) && !chatId}
              rows={rows}
              folds={folds}
              onNew={onNewScratch}
            />
            <ProjectsSection
              groups={groups}
              drag={drag}
              folds={folds}
              rows={rows}
              threads={all}
              current={projectId}
              onNew={onNew}
              onShared={onShared}
              error={error}
              empty={!realProjects.length}
              onAdd={onAdd}
            />
          </>
        )}
      </div>
      {viewError && <ErrorBox error={viewError} />}
      <SidebarFooter
        account={account}
        projectId={projectId}
        projectName={projects.find((p) => p.id === projectId)?.name}
        chatId={chatId}
        onAccount={onAccount}
        onSettings={onSettings}
      />
    </div>
  );
}
