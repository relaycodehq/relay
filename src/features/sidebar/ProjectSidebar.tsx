import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Plus, Search } from "lucide-react";
import type { SidebarView } from "../../../shared/types";
import type {
  AgentProvider,
  ChatSummary,
  Project,
} from "../../../shared/projects";
import { chatActivitySections } from "../../../shared/chat-activity";
import { startedFamilies } from "../../../shared/started-families";
import { api } from "../../lib/api";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";
import { useNow } from "../../lib/useNow";
import { useSidebarView } from "./useSidebarView";
import { useSidebarFolds } from "./useSidebarFolds";
import { useShelves } from "./useShelves";
import { useProjectGroups } from "./useProjectGroups";
import {
  movePlanned,
  plannedChats,
  plannedProjects,
  regroupPlanned,
  useShownPlan,
} from "../import-offer/import-plan";
import { useProjectDrag } from "./useProjectDrag";
import { useSidebarThreads } from "./useSidebarThreads";
import { useUnread } from "./useUnread";
import {
  chatAgents,
  passes,
  pruneTree,
  SCRATCHPAD,
  takesProject,
  useThreadFilter,
} from "./useThreadFilter";
import { useThreadActions } from "./useThreadActions";
import { useActivityKeys } from "./useActivityKeys";
import { draftsFirst } from "./activity";
import { useDraftRaise } from "./useDraftRaise";
import { activityDrafts, useDraftKeys } from "../composer/drafts";
import { useAttention } from "./useAttention";
import { ErrorBox } from "../../ui/ui";
import type { SettingsCategory } from "../settings/Settings";
import { SidebarFooter } from "./SidebarFooter";
import { ThreadActionDialogs } from "./ThreadActionDialogs";
import type { SidebarRows } from "./SidebarThread";
import { SearchPalette } from "./SearchPalette";
import { FilterMenu } from "./FilterMenu";
import { ActivityView } from "./SidebarActivity";
import { ProjectsSection, Scratchpad } from "./SidebarProjects";
import { HoverMark } from "./HoverMark";
import type { AddProjectPage } from "../add-project/AddProjectPalette";
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
  schedules?: boolean;
}

export function ProjectSidebar({
  initialView,
  projects,
  showing: { projectId, chatId, draftId, inbox, usage, schedules },
  onOpen,
  onPickNew,
  onNewScratch,
  onSendDraft,
  onAdd,
  onInbox,
  onUsage,
  onSchedules,
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
  /** Add a project, the menu having named how. */
  onAdd: (page: AddProjectPage) => void;
  onInbox: () => void;
  onUsage?: () => void;
  onSchedules?: () => void;
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
  // The open thread's import offer stands its new projects in the tree.
  const plan = useShownPlan();
  const treeProjects = plan ? plannedProjects(realProjects, plan) : realProjects;
  const groups = useProjectGroups(
    treeProjects,
    folds.setOpen,
    setError,
    plan && {
      move: (id, folder, before) =>
        movePlanned(plan, treeProjects, id, folder, before),
      regroup: (from, to) => regroupPlanned(plan, from, to),
    },
  );
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
  const { all: listed, away, loaded } = useSidebarThreads(realProjects, chatId);
  const unread = useUnread(chatId, listed);
  // A deep review shows as one thread: its reviewers open from the review,
  // which stays picked while one of them is open.
  const everything = listed.filter((c) => !c.reviewer);
  const shown =
    listed.find((c) => c.id === chatId)?.reviewer?.parent ?? chatId;
  const [searching, setSearching] = useState(false);
  useShortcut("search-threads", true, () => setSearching(true));
  const projectKey = (id: string) => (scratchIds.has(id) ? SCRATCHPAD : id);
  const filtering = useThreadFilter();
  // A removed project's id would hide everything, with nothing to untick.
  const filter = {
    ...filtering.filter,
    projects: filtering.filter.projects.filter(
      (id) => id === SCRATCHPAD || byId.has(id),
    ),
  };
  const filtered = !!(filter.projects.length || filter.agents.length);
  const all = filtered
    ? everything.filter((c) => passes(filter, projectKey(c.projectId), c))
    : everything;
  // Follows drafts as they gain or lose text; each card follows its own.
  const draftKeys = useDraftKeys();
  const everyDraft = activityDrafts(
    draftKeys,
    byId,
    new Map(everything.map((c) => [c.id, c])),
  );
  const draftedIn = (ds: typeof everyDraft) =>
    new Set(ds.flatMap((d) => (d.chat ? [d.chat.id] : [])));
  const everyDrafted = draftedIn(everyDraft);
  const raised = useDraftRaise(everyDrafted);
  const every = draftsFirst(
    chatActivitySections(everything, now),
    everything,
    everyDrafted,
    raised,
  );
  const kept = new Set(all.map((c) => c.id));
  const drafts = filtered
    ? everyDraft.filter((d) =>
        d.chat
          ? kept.has(d.chat.id)
          : takesProject(filter, projectKey(d.project.id)),
      )
    : everyDraft;
  const sections = filtered
    ? draftsFirst(
        chatActivitySections(all, now),
        all,
        draftedIn(drafts),
        raised,
      )
    : every;
  const families = startedFamilies(sections.active, sections.settled);
  const actions = useThreadActions({
    chatId: shown,
    active: sections.active,
    projects: byId,
    scratch: scratchIds,
    open: openChat,
    onNew: newThread,
    onProjectSettings: (id) => onSettings("project", id),
    setError,
  });
  const activity = view === "activity";
  const cmdHeld = useActivityKeys({
    active: sections.active,
    // Count drafts first, then thread cards; started threads and settled leads
    // don't get numbers.
    cards: [
      ...drafts
        .filter((d) => !d.chat)
        .map((d) => () => onOpen(d.project, undefined, d.id)),
      ...families.cards.map((c) => () => actions.open(c)),
    ],
    threads: families.cards.map((c) => ({
      id: c.id,
      open: () => actions.open(c),
    })),
    loaded,
    chatId: shown,
    jumping: activity,
    actions,
  });
  // The bell counts what wants you even where the filter hides it.
  const attention = useAttention(every.active, unread, onAttention);
  const settleKeys = useShortcutLabel("settle");
  const rows: SidebarRows = {
    chatId: shown,
    now,
    unread,
    projects: byId,
    actions,
    autoSettleDays,
    settleKeys,
  };
  const newThreadKeys = useShortcutLabel("new-thread");
  const activityKeys = useShortcutLabel("activity");
  const searchKeys = useShortcutLabel("search-threads");
  // The filter offers the projects with threads, the one whose threads
  // changed last first, and the agents threads ran.
  const latest = new Map<string, { project: Project; at: number }>();
  const agents = new Set<AgentProvider>();
  for (const c of everything) {
    const key = projectKey(c.projectId);
    const project = byId.get(c.projectId);
    if (project && !latest.has(key))
      latest.set(key, { project, at: c.updated });
    for (const a of chatAgents(c)) agents.add(a);
  }
  // A ticked agent no thread ran any more still shows, to untick it.
  for (const a of filter.agents) agents.add(a);
  const offered = [
    ...[...latest].map(([key, last]) => ({ key, ...last })),
    // A ticked one whose threads are gone still shows, to untick it.
    ...filter.projects.flatMap((key) => {
      const project = byId.get(key);
      return project && !latest.has(key) ? [{ key, project }] : [];
    }),
  ];
  return (
    <div className="sb">
      <div className="sb-top">
        <h2 className="sb-top-title">
          {activity ? (
            <>
              Activity <small>({families.top.length})</small>
            </>
          ) : (
            "Threads"
          )}
        </h2>
        <button
          className="sb-top-button"
          aria-label="Search threads"
          title={`Search threads  ${searchKeys}`.trim()}
          onClick={() => setSearching(true)}
        >
          <Search size={15} />
        </button>
        <FilterMenu
          state={filtering}
          filter={filter}
          projects={offered}
          agents={[...agents]}
        />
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
          onClick={toggleView}
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
        {activity ? (
          <ActivityView
            rows={rows}
            sections={sections}
            families={families}
            drafts={drafts}
            away={away}
            hints={cmdHeld}
            shelves={shelves}
            draftId={draftId}
            onDraft={(p, id) => onOpen(p, undefined, id)}
            onSendDraft={onSendDraft}
          />
        ) : (
          <>
            {takesProject(filter, SCRATCHPAD) && (
              <Scratchpad
                chats={all.filter((c) => scratchIds.has(c.projectId))}
                draft={!!projectId && scratchIds.has(projectId) && !chatId}
                rows={rows}
                folds={folds}
                onNew={onNewScratch}
              />
            )}
            <ProjectsSection
              tree={{
                groups,
                shown: filter.projects.length
                  ? pruneTree(groups.tree, (id) => filter.projects.includes(id))
                  : groups.tree,
                drag,
                folds,
                rows,
                threads: all,
                current: projectId,
                onNew: newThread,
                onProjectSettings: (p) => onSettings("project", p.id),
                importing: plan && plannedChats(plan),
              }}
              error={error}
              empty={!realProjects.length}
              onAdd={onAdd}
            />
            <HoverMark />
          </>
        )}
      </div>
      {viewError && <ErrorBox error={viewError} />}
      {searching && (
        <SearchPalette
          threads={everything}
          projects={byId}
          onOpen={openChat}
          onClose={() => setSearching(false)}
        />
      )}
      <ThreadActionDialogs actions={actions} />
      <SidebarFooter
        projectId={projectId}
        projectName={projects.find((p) => p.id === projectId)?.name}
        chatId={chatId}
        inbox={inbox}
        onInbox={onInbox}
        usage={usage}
        onUsage={onUsage}
        schedules={schedules}
        onSchedules={onSchedules}
        onSettings={onSettings}
      />
    </div>
  );
}
