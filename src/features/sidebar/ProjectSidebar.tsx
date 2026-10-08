import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChartColumn, GitPullRequest, Plus } from "lucide-react";
import type { SidebarView } from "../../../shared/types";
import type { ChatSummary, Project } from "../../../shared/projects";
import { chatActivitySections } from "../../../shared/chat-activity";
import { startedFamilies } from "../../../shared/started-families";
import { api } from "../../lib/api";
import { useShortcutLabel } from "../../lib/shortcuts";
import { useNow } from "../../lib/useNow";
import { useSidebarView } from "./useSidebarView";
import { useSidebarFolds } from "./useSidebarFolds";
import { useShelves } from "./useShelves";
import { useProjectGroups } from "./useProjectGroups";
import { useProjectDrag } from "./useProjectDrag";
import { useSidebarThreads } from "./useSidebarThreads";
import { useUnread } from "./useUnread";
import { useThreadSearch } from "./useThreadSearch";
import { useThreadActions } from "./useThreadActions";
import { useActivityKeys } from "./useActivityKeys";
import { useAttention } from "./useAttention";
import { ErrorBox } from "../../ui/ui";
import { MoveToWorktreeDialog } from "../changes/MoveToWorktreeDialog";
import type { SettingsCategory } from "../settings/Settings";
import { SidebarFooter } from "./SidebarFooter";
import type { SidebarRows } from "./SidebarThread";
import { SearchField, SearchResults } from "./SidebarSearch";
import { ActivityView } from "./SidebarActivity";
import { ProjectsSection, Scratchpad } from "./SidebarProjects";
import "./sidebar.css";

/** What the main pane shows, so the sidebar marks it. */
interface SidebarShowing {
  projectId?: string;
  chatId?: string;
  /** The unsent thread that's open, when no thread is. */
  draftId?: string;
  /** The Pull requests page. */
  inbox?: boolean;
  usage?: boolean;
}

export function ProjectSidebar({
  initialView,
  projects,
  showing: { projectId, chatId, draftId, inbox, usage },
  onOpen,
  onPickNew,
  onNewScratch,
  onSendDraft,
  onAdd,
  onInbox,
  onUsage,
  onSettings,
  onAttention,
}: {
  initialView?: SidebarView;
  projects: Project[];
  showing: SidebarShowing;
  /**
   * Opens `chat` in `p`, or with `fresh` one of its unsent threads: a new
   * one, or with a draft's id that draft.
   */
  onOpen: (p: Project, chat?: ChatSummary, fresh?: true | string) => void;
  /** New thread in a project still to be chosen. */
  onPickNew: () => void;
  onNewScratch: () => void;
  /** Sends the open unsent thread's draft from its composer. */
  onSendDraft: () => void;
  onAdd: () => void;
  onInbox: () => void;
  onUsage?: () => void;
  /** Opens Settings, at `category` when given, scoped to `projectId` for project settings. */
  onSettings: (category?: SettingsCategory, projectId?: string) => void;
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
  const openChat = (c: ChatSummary) => {
    const p = byId.get(c.projectId);
    if (p) onOpen(p, c);
  };
  const newThread = (p: Project) => onOpen(p, undefined, true);
  const { all, away } = useSidebarThreads(realProjects, chatId);
  const unread = useUnread(chatId, all);
  const search = useThreadSearch(all, byId);
  const sections = chatActivitySections(all, now);
  const families = startedFamilies(sections.active, sections.settled);
  const actions = useThreadActions({
    chatId,
    active: sections.active,
    projects: byId,
    scratch: scratchIds,
    open: openChat,
    onNew: newThread,
    onProjectSettings: (id) => onSettings("project", id),
    setError,
  });
  const activity = view === "activity" && !search.query;
  const cmdHeld = useActivityKeys({
    // The shortcuts count the cards, which started threads and settled leads don't get.
    active: families.cards,
    chatId,
    jumping: activity,
    actions,
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
            families={families}
            away={away}
            hints={cmdHeld}
            shelves={shelves}
            draftId={draftId}
            onDraft={(p, id) => onOpen(p, undefined, id)}
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
              <button
                className={`sb-nav-item ${usage ? "selected" : ""}`}
                aria-current={usage ? "page" : undefined}
                onClick={onUsage}
              >
                <ChartColumn size={15} />
                Usage
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
              tree={{
                groups,
                drag,
                folds,
                rows,
                threads: all,
                current: projectId,
                onNew: newThread,
                onProjectSettings: (p) => onSettings("project", p.id),
              }}
              error={error}
              empty={!realProjects.length}
              onAdd={onAdd}
            />
          </>
        )}
      </div>
      {viewError && <ErrorBox error={viewError} />}
      {actions.moving && (
        <MoveToWorktreeDialog
          chatId={actions.moving}
          onClose={() => actions.setMoving(undefined)}
        />
      )}
      <SidebarFooter
        projectId={projectId}
        projectName={projects.find((p) => p.id === projectId)?.name}
        chatId={chatId}
        usage={usage}
        onUsage={onUsage}
        onSettings={onSettings}
      />
    </div>
  );
}
