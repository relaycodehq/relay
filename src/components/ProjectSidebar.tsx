import { useEffect, useRef, useState } from "react";
import { useNow } from "../lib/useNow";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Bootstrap, SidebarView } from "../../shared/types";
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ThreadMenu, type ThreadMenuAction } from "./ThreadMenu";
import { forkThreadSettings } from "../lib/composer-settings";
import {
  Archive,
  Bell,
  Check,
  ChevronRight,
  CalendarClock,
  CircleAlert,
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
  RotateCcw,
  Search,
  Settings2,
  SquarePen,
  Sunrise,
  Users,
  X,
} from "lucide-react";
import {
  projectNameSchema,
  threadTitleSchema,
  type Project,
  type ChatPending,
  type ChatSummary,
  type ChatTriage,
} from "../../shared/projects";
import {
  chatActivitySections,
  chatIsEmpty,
  movedSinceSeen,
  shortAge,
  wakeLabel,
} from "../../shared/chat-activity";
import { agentsSince } from "../../shared/waiting";
import { MenuAction, MenuPopup } from "./SidebarMenu";
import { SnoozeMenu } from "./SnoozeMenu";
import { api } from "../lib/api";
import { SCRATCH_CHATS } from "../lib/chat-events";
import { mac } from "../lib/mod-key";
import {
  digitOf,
  holdsModifiersOf,
  modifiersLabel,
  useBindings,
  useShortcut,
  useShortcutLabel,
} from "../lib/shortcuts";
import { modifierCode } from "../../shared/shortcuts";
import { useWindowFocused } from "../lib/window-focus";
import { readJson } from "../lib/persisted-store";
import { ErrorBox, IconButton, rowKeys, Spinner } from "./ui";
import { CheckUpdatesButton, UpdateButton } from "./UpdateButton";
import { AgentUpdateButton } from "./AgentUpdates";
import type { SettingsCategory } from "./Settings";
import { ClockifyTimer } from "./plugins/ClockifyTimer";
import { ProviderIcon } from "./ComposerModelPicker";
import { agentName } from "../../shared/agents";
import { ProjectBadge, useProjectIcon } from "./ProjectBadge";
import { DraftCard } from "./DraftCard";
import {
  activityDrafts,
  useDraftKeys,
  type ActivityDraft,
} from "../lib/drafts";
import {
  joinGroup,
  moveGroupInList,
  moveProjectInList,
  parentGroup,
  projectFolderTree,
  projectGroupNameSchema,
  type ProjectFolderNode,
} from "../../shared/project-folders";
import "./sidebar.css";
import {
  awayStopped,
  AwayPeek,
  AwayWhere,
  useAwayViews,
  withAway,
} from "./AwayCard";

const THREADS_PER_PROJECT = 5;
const SEARCH_RESULTS = 50;
const STALE_AFTER = 24 * 60 * 60 * 1000;
const SHELF_PAGE = 5;
const CMD_HINT_DELAY_MS = 500;
const PROJECT_DRAG = "application/x-relay-project";
const GROUP_DRAG = "application/x-relay-group";

type DropTarget =
  | { kind: "project"; id: string; where: "before" | "after" }
  | { kind: "folder"; path: string }
  | { kind: "group"; path: string; where: "before" | "after" };

function readObject<T>(key: string, fallback: T): T {
  const value = readJson(key);
  return value && typeof value === "object" ? (value as T) : fallback;
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sidebar conveniences never block the workspace.
  }
}

/**
 * Last time each thread was open here; drives the unread dot. The open thread
 * only counts as seen while Relay is in front: an answer that lands while
 * you're in another app stays unread until you come back.
 */
function useSeen(chatId: string | undefined, chats: ChatSummary[]) {
  const focused = useWindowFocused();
  const [since] = useState(() => {
    const saved = Number(localStorage.getItem("relay-thread-seen-since"));
    if (saved > 0) return saved;
    const now = Date.now();
    localStorage.setItem("relay-thread-seen-since", String(now));
    return now;
  });
  const [seen, setSeen] = useState<Record<string, number>>(() =>
    readObject("relay-thread-seen", {}),
  );
  const current = chats.find((c) => c.id === chatId);
  /** The thread last read here; marking it unread while it's open holds until it's opened again. */
  const opened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!current) {
      opened.current = undefined;
      return;
    }
    if (!focused) return;
    const reopened = opened.current !== current.id;
    opened.current = current.id;
    if (
      !(current.markedUnread && reopened) &&
      (seen[current.id] ?? 0) >= current.updated
    )
      return;
    setSeen((s) => {
      const next = { ...s, [current.id]: current.updated };
      writeJson("relay-thread-seen", next);
      return next;
    });
    // Phones read it from the desktop, so their marks clear too.
    void window.relay
      ?.markProjectChatSeen?.(current.id, current.updated)
      .catch(() => {});
  }, [focused, current?.id, current?.updated]);
  return (c: ChatSummary) =>
    ((c.id !== chatId || (!focused && !c.running)) && !!c.markedUnread) ||
    movedSinceSeen(c, since, seen);
}

/** A thread's name, dimmed while it's being generated again. */
function ThreadTitle({
  className,
  title,
  regenerating,
}: {
  className: string;
  title: string;
  regenerating: boolean;
}) {
  return (
    <span
      className={`${className} ${regenerating ? "sb-title-regenerating" : ""}`}
      aria-busy={regenerating || undefined}
    >
      {title}
    </span>
  );
}

/** The row that expands or collapses a long thread list. */
function ShowMore({
  more,
  hidden,
  onToggle,
}: {
  more: boolean;
  hidden: number;
  onToggle: () => void;
}) {
  return (
    <button className="sb-thread sb-ghost" onClick={onToggle}>
      <span className="sb-thread-title">
        {more ? "Show less" : `Show ${hidden} more`}
      </span>
    </button>
  );
}

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

/** Past this many agents, the last slot counts the rest. */
const CARD_AGENT_ICONS = 3;
/** Who's answering while it runs, otherwise who answered last. */
function CardAgents({ chat }: { chat: ChatSummary }) {
  const agents = chat.runningAgents?.length
    ? chat.runningAgents
    : chat.provider
      ? [chat.provider]
      : [];
  if (!agents.length) return null;
  const more = agents.length - CARD_AGENT_ICONS;
  return (
    <span className="sb-card-provider" title={agents.map(agentName).join(", ")}>
      {agents.slice(0, more > 0 ? CARD_AGENT_ICONS - 1 : undefined).map((p) => (
        <ProviderIcon key={p} provider={p} />
      ))}
      {more > 0 && <span className="sb-card-provider-more">+{more + 1}</span>}
    </span>
  );
}

function StatusMark({
  chat,
  unread,
  now,
}: {
  chat: ChatSummary;
  unread: boolean;
  now: number;
}) {
  if (chat.waiting)
    return (
      <span className="sb-status waiting" title="Needs your input">
        <i />
      </span>
    );
  if (chat.running || agentsSince(chat.pending))
    return (
      <span
        className="sb-status running"
        title={chat.running ? "Working" : pendingTitle(chat.pending!)}
      >
        <Spinner size={11} steady />
      </span>
    );
  if (unread)
    return (
      <span className="sb-status unread" title="New activity">
        <i />
      </span>
    );
  if (chat.pending?.length)
    return (
      <span
        className="sb-status pending"
        title="Claude will continue on its own"
      >
        <i />
      </span>
    );
  if (chat.nextSend)
    return (
      <span className="sb-status scheduled" title={sendsTitle(chat.nextSend)}>
        <CalendarClock size={12} />
      </span>
    );
  return <time className="sb-age">{shortAge(chat.updated, now)}</time>;
}

const sendsTitle = (at: number) =>
  `Sends a scheduled message ${wakeLabel(at, new Date())}`;

const pendingTitle = (pending: ChatPending[]) =>
  `Claude will continue on its own after:\n${pending
    .map((p) => (p.kind === "task" ? p.description : p.prompt || "a wake-up"))
    .join("\n")}`;

/** Right side of a card's top row: live state, else the age. */
function CardState({
  chat,
  unread,
  now,
  stopped,
}: {
  chat: ChatSummary;
  unread: boolean;
  now: number;
  /** Its turn on another computer ended in an error. */
  stopped?: boolean;
}) {
  if (chat.waiting)
    return (
      <span className="sb-card-state waiting">
        <i />
        Needs input
      </span>
    );
  const since = chat.running ? chat.runningSince : agentsSince(chat.pending);
  if (chat.running || since)
    return (
      <span
        className="sb-card-state running"
        title={chat.running ? undefined : pendingTitle(chat.pending!)}
      >
        <Spinner size={11} steady />
        Working
        {since && <Elapsed since={since} />}
      </span>
    );
  if (stopped)
    return (
      <span className="sb-card-state stopped">
        <CircleAlert size={12} />
        Stopped
      </span>
    );
  if (chat.snoozedUntil && chat.snoozedUntil <= now)
    return <span className="sb-card-state unread">Woke up</span>;
  if (chat.pending?.length)
    return (
      <span
        className={`sb-card-state pending ${unread ? "unread" : ""}`}
        title={pendingTitle(chat.pending)}
      >
        <i />
        Waiting
      </span>
    );
  if (chat.nextSend && !unread)
    return (
      <span
        className="sb-card-state scheduled"
        title={sendsTitle(chat.nextSend)}
      >
        <CalendarClock size={12} />
        Sends {wakeLabel(chat.nextSend, new Date(now))}
      </span>
    );
  return (
    <time className={`sb-card-state ${unread ? "unread" : ""}`}>
      {unread && <i />}
      {shortAge(chat.updated, now)}
    </time>
  );
}

/** "26s", "4m 12s", "1h 3m" — ticks on its own so only this label re-renders. */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const text =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
  return <span className="sb-elapsed">{text}</span>;
}

/** Inline name field for naming a group, or renaming a project, in place. */
function GroupNameInput({
  label,
  initial = "",
  schema = projectGroupNameSchema,
  placeholder = "Group name",
  className = "sb-group-input",
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  schema?:
    | typeof projectGroupNameSchema
    | typeof projectNameSchema
    | typeof threadTitleSchema;
  placeholder?: string;
  className?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const parsed = schema.safeParse(value);
  const invalid = !!value.trim() && !parsed.success;
  const finish = (commit: boolean) => {
    if (done.current) return;
    if (commit && parsed.success && parsed.data !== initial) {
      done.current = true;
      onSubmit(parsed.data);
    } else if (!commit || !invalid) {
      done.current = true;
      onCancel();
    }
  };
  return (
    <div className={className}>
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        maxLength={
          schema === threadTitleSchema
            ? 120
            : schema === projectNameSchema
              ? 80
              : 60
        }
        value={value}
        aria-invalid={invalid}
        title={invalid ? parsed.error?.issues[0].message : undefined}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => {
          if (!invalid) return finish(true);
          done.current = true;
          onCancel();
        }}
      />
    </div>
  );
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
  onSettings: (category?: SettingsCategory, projectId?: string) => void;
  onAccount: () => void;
  onInbox: () => void;
  /** The Pull requests page is showing. */
  inbox?: boolean;
  /** Strongest status mark among active threads, for the collapsed titlebar. */
  onAttention?: (mark: "waiting" | "unread" | undefined) => void;
}) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  // Follows drafts as they gain or lose text; each card follows its own.
  const draftKeys = useDraftKeys();
  // Scratchpad chats list under their own heading, never as projects.
  const realProjects = projects.filter((p) => !p.scratch);
  const scratchIds = new Set(
    projects.filter((p) => p.scratch).map((p) => p.id),
  );
  const [search, setSearch] = useState("");
  /** The query whose results are listed past the first SEARCH_RESULTS. */
  const [allResultsFor, setAllResultsFor] = useState<string>();
  const [view, setView] = useState<SidebarView>(() => {
    if (initialView) return initialView;
    // Preserve the selection from versions that only used browser storage.
    try {
      if (localStorage.getItem("relay-sidebar-view") === "activity")
        return "activity";
    } catch {
      // App data remains usable when browser storage isn't.
    }
    return "threads";
  });
  const { mutate: saveView, error: viewError } = useMutation({
    mutationFn: (next: SidebarView) => api.saveSidebarView(next),
    onSuccess: (_, sidebarView) => {
      qc.setQueryData<Bootstrap>(["bootstrap"], (boot) =>
        boot ? { ...boot, sidebarView } : boot,
      );
      try {
        localStorage.removeItem("relay-sidebar-view");
      } catch {
        // The choice has already been saved in app data.
      }
    },
  });
  useEffect(() => saveView(view), [view, saveView]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      Object.entries(
        readObject<Record<string, unknown>>("relay-project-expansion", {}),
      )
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => [key, value === true]),
    ),
  );
  useEffect(() => writeJson("relay-project-expansion", expanded), [expanded]);
  const [folded, setFolded] = useState(() => {
    const saved = readObject<Record<string, unknown>>(
      "relay-sidebar-folded",
      {},
    );
    return {
      scratchpad: saved.scratchpad === true,
      projects: saved.projects === true,
    };
  });
  useEffect(() => writeJson("relay-sidebar-folded", folded), [folded]);
  const fold = (section: keyof typeof folded) =>
    setFolded((s) => ({ ...s, [section]: !s[section] }));
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [shelves, setShelves] = useState({ snoozed: false, settled: false });
  const [shelfShown, setShelfShown] = useState({
    snoozed: SHELF_PAGE,
    settled: SHELF_PAGE,
  });
  const groups = useQuery({
    queryKey: ["project-groups"],
    queryFn: () => api.projectGroups(),
  }).data;
  /** Where a new group's name is being typed, and a project to move into it. */
  const [draft, setDraft] = useState<{ parent: string; project?: string }>();
  const [renaming, setRenaming] = useState<string>();
  const [renamingProject, setRenamingProject] = useState<string>();
  const [renamingThread, setRenamingThread] = useState<string>();
  /** Threads whose title is being generated again. */
  const [regenerating, setRegenerating] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const autoSettleDays = useQuery({
    queryKey: ["auto-settle-days"],
    queryFn: () => api.autoSettleDays(),
  }).data;
  const [groupError, setGroupError] = useState<string>();
  const refreshGroups = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["project-groups"] }),
    ]);
  const changeGroups = async (
    change: () => Promise<void>,
    optimistic?: (groups: string[]) => string[],
  ) => {
    setGroupError(undefined);
    if (optimistic)
      qc.setQueryData<string[]>(["project-groups"], (list) =>
        optimistic(list ?? []),
      );
    try {
      await change();
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : String(e));
    } finally {
      void refreshGroups();
    }
  };
  const createGroup = (parent: string, name: string, project?: string) => {
    const path = joinGroup(parent, name);
    setExpanded((state) => ({ ...state, ["folder:" + path]: true }));
    void changeGroups(
      () =>
        project
          ? moveProject(project, { kind: "folder", path })
          : api.createProjectGroup(path),
      (list) => [...list, path],
    );
  };
  const renameProject = (id: string, name: string) => {
    qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
      list?.map((p) => (p.id === id ? { ...p, name } : p)),
    );
    void changeGroups(async () => {
      await api.renameProject(id, name);
    });
  };
  const startGroup = (parent: string, project?: string) => {
    setRenaming(undefined);
    if (parent)
      setExpanded((state) => ({ ...state, ["folder:" + parent]: true }));
    setDraft({ parent, project });
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const expandTimer = useRef<{ key: string; timer: number } | null>(null);
  const clearDrag = () => {
    setDragging(null);
    setDraggingGroup(null);
    setDrop(null);
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  const moveProject = async (
    id: string,
    target: Exclude<DropTarget, { kind: "group" }>,
  ) => {
    let folder = "",
      before: string | null = null;
    if (target.kind === "folder") folder = target.path;
    else {
      const others = realProjects.filter((p) => p.id !== id);
      const index = others.findIndex((p) => p.id === target.id);
      if (index < 0) return;
      folder = others[index].folder ?? "";
      before =
        target.where === "before"
          ? target.id
          : (others.slice(index + 1).find((p) => (p.folder ?? "") === folder)
              ?.id ?? null);
    }
    qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
      list ? moveProjectInList(list, id, folder, before) : list,
    );
    try {
      await api.moveProject(id, folder, before);
    } finally {
      void refreshGroups();
    }
  };
  const moveGroup = (path: string, target: { path: string; where: string }) => {
    const parent = parentGroup(path);
    const before =
      target.where === "before"
        ? target.path
        : (groupPaths
            .slice(groupPaths.indexOf(target.path) + 1)
            .find((p) => p !== path && parentGroup(p) === parent) ?? null);
    void changeGroups(
      () => api.moveProjectGroup(path, before),
      (list) => moveGroupInList(list, path, before),
    );
  };
  /** Shared dragover handling: accepts the drag the target takes, marks it. */
  const dragOver = (e: React.DragEvent, target: DropTarget) => {
    const group = target.kind === "group";
    if (
      !(group ? draggingGroup : dragging) ||
      !e.dataTransfer.types.includes(group ? GROUP_DRAG : PROJECT_DRAG)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDrop((current) =>
      JSON.stringify(current) === JSON.stringify(target) ? current : target,
    );
  };
  const dropOn = (e: React.DragEvent, target: DropTarget) => {
    if (target.kind === "group") {
      if (!draggingGroup) return;
      e.preventDefault();
      e.stopPropagation();
      const path = draggingGroup;
      clearDrag();
      if (target.path !== path) moveGroup(path, target);
      return;
    }
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const id = dragging;
    clearDrag();
    if (target.kind === "project" && target.id === id) return;
    void changeGroups(() => moveProject(id, target));
  };
  /** Hovering a collapsed folder while dragging opens it, like Finder. */
  const openWhileDragging = (key: string, isOpen: boolean) => {
    if (isOpen || expandTimer.current?.key === key) return;
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = {
      key,
      timer: window.setTimeout(
        () => setExpanded((state) => ({ ...state, [key]: true })),
        550,
      ),
    };
  };
  // Kept current by the desktop's pushes; see lib/chat-events.
  const lists = useQueries({
    queries: [
      ...realProjects.map((p) => ({
        queryKey: ["project-chats", p.id],
        queryFn: () => api.projectChats(p.id),
      })),
      // One list for every Scratchpad folder: there's one per chat.
      {
        queryKey: SCRATCH_CHATS,
        queryFn: () => api.scratchChats(),
      },
    ],
  });
  useShortcut("activity", true, () =>
    setView((v) => (v === "activity" ? "threads" : "activity")),
  );
  /**
   * Holding ⌘ on its own for a beat on the activity view shows ⌘1–⌘9 on the
   * first nine cards (or whichever modifiers open them). ⌘ used as part of
   * another shortcut or a ⌘-click never shows them.
   */
  const [cmdHeld, setCmdHeld] = useState(false);
  const jumpBinding = useBindings("jump-thread")[0];
  const settleKeys = useShortcutLabel("settle");
  const newThreadKeys = useShortcutLabel("new-thread");
  const newScratchKeys = useShortcutLabel("new-scratch");
  const activityKeys = useShortcutLabel("activity");
  const jumpTo = useRef<(index: number) => boolean>(() => false);
  const settleOpen = useRef<() => boolean>(() => false);
  useShortcut("settle", true, () => settleOpen.current());
  useEffect(() => {
    let reveal: number | undefined;
    const cancel = () => {
      clearTimeout(reveal);
      reveal = undefined;
    };
    const release = () => {
      cancel();
      setCmdHeld(false);
    };
    const down = (e: KeyboardEvent) => {
      // Ctrl keys typed in a terminal belong to its shell.
      if (
        !mac &&
        e.ctrlKey &&
        (e.target as Element | null)?.closest?.(".xterm")
      )
        return release();
      if (!holdsModifiersOf("jump-thread", e)) release();
      else if (!modifierCode.test(e.code)) cancel();
      else if (reveal === undefined)
        reveal = window.setTimeout(() => setCmdHeld(true), CMD_HINT_DELAY_MS);
      const digit = digitOf("jump-thread", e);
      if (digit && jumpTo.current(digit - 1)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (!holdsModifiersOf("jump-thread", e)) release();
    };
    const click = (e: PointerEvent) => {
      if (holdsModifiersOf("jump-thread", e)) cancel();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", click);
    window.addEventListener("blur", release);
    return () => {
      cancel();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", click);
      window.removeEventListener("blur", release);
    };
  }, []);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const away = useAwayViews(lists.flatMap((q) => q.data ?? []));
  const all = lists
    .flatMap((q) => q.data ?? [])
    .filter((c) => !c.archivedAt && (c.id === chatId || !chatIsEmpty(c)))
    .map((c) => withAway(c, away[c.id]))
    .sort((a, b) => b.updated - a.updated);
  const unread = useSeen(chatId, all);
  const triage = async (c: ChatSummary, action: ChatTriage) => {
    // Every list holding it: its project's, and Scratchpad's for a scratch chat.
    const triaged = (entry: ChatSummary): ChatSummary => {
      switch (action.kind) {
        case "archive":
          return { ...entry, archivedAt: Date.now() };
        case "unread":
          return { ...entry, markedUnread: true };
        case "auto-settle":
          return { ...entry, autoSettleOff: action.enabled ? undefined : true };
        default:
          return {
            ...entry,
            settledAt: action.kind === "settle" ? Date.now() : undefined,
            autoSettled: undefined,
            snoozedAt: action.kind === "snooze" ? Date.now() : undefined,
            snoozedUntil: action.kind === "snooze" ? action.until : undefined,
          };
      }
    };
    patchChat(c, triaged);
    try {
      await api.triageProjectChat(c.id, action);
    } finally {
      refreshChats(c);
    }
  };
  /** Every list holding it: its project's, and Scratchpad's for a scratch chat. */
  const patchChat = (c: ChatSummary, patch: (c: ChatSummary) => ChatSummary) =>
    qc.setQueriesData<ChatSummary[]>({ queryKey: ["project-chats"] }, (list) =>
      list?.map((entry) => (entry.id === c.id ? patch(entry) : entry)),
    );
  const refreshChats = (c: ChatSummary) =>
    qc.invalidateQueries({
      queryKey: scratchIds.has(c.projectId)
        ? ["project-chats"]
        : ["project-chats", c.projectId],
    });
  const failed = (e: unknown) =>
    setGroupError(e instanceof Error ? e.message : String(e));
  const renameThread = async (c: ChatSummary, title: string) => {
    patchChat(c, (entry) => ({ ...entry, title, renamed: true }));
    try {
      await api.renameProjectChat(c.id, title);
    } catch (e) {
      failed(e);
    } finally {
      void refreshChats(c);
    }
  };
  const regenerateTitle = async (c: ChatSummary) => {
    setRegenerating((ids) => new Set(ids).add(c.id));
    setGroupError(undefined);
    try {
      const named = await api.regenerateProjectChatTitle(c.id);
      patchChat(c, (entry) => ({
        ...entry,
        title: named.title,
        renamed: undefined,
      }));
    } catch (e) {
      failed(e);
    } finally {
      setRegenerating((ids) => {
        const next = new Set(ids);
        next.delete(c.id);
        return next;
      });
      void refreshChats(c);
    }
  };
  /** Forks from the latest answer and opens the fork on that answer's agent. */
  const fork = async (c: ChatSummary) => {
    setGroupError(undefined);
    try {
      const forked = await api.forkProjectChat(c.id);
      forkThreadSettings(c.id, forked.id, forked.provider);
      await refreshChats(c);
      onChat(forked);
    } catch (e) {
      failed(e);
    }
  };
  const threadAction = (c: ChatSummary, action: ThreadMenuAction) => {
    const p = byId.get(c.projectId);
    switch (action.kind) {
      case "new":
        if (p) onNew(p);
        return;
      case "fork":
        return void fork(c);
      case "settle":
        return settle(c);
      case "rename":
        return setRenamingThread(c.id);
      case "regenerate":
        return void regenerateTitle(c);
      case "triage":
        return void triage(c, action.triage).catch(failed);
    }
  };
  /** Right-click on a thread anywhere in the sidebar. */
  const threadMenu = (c: ChatSummary) => {
    const own = byId.get(c.projectId)?.settings;
    return (
      <ThreadMenu
        chat={c}
        projectName={byId.get(c.projectId)?.name}
        projectPath={byId.get(c.projectId)?.path}
        now={now}
        unread={unread(c)}
        regenerating={regenerating.has(c.id)}
        autoSettleDays={
          own?.autoSettleDays === undefined
            ? autoSettleDays
            : own.autoSettleDays
        }
        settleOnCommit={own?.settleOnCommit}
        settleKeys={c.id === chatId ? settleKeys : undefined}
        onAction={(action) => threadAction(c, action)}
      />
    );
  };
  // Inside a card the row's own click and keys would open the thread.
  const renameInput = (c: ChatSummary, className: string) => (
    <span
      className="sb-thread-rename"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <GroupNameInput
        label="Thread name"
        initial={c.title}
        schema={threadTitleSchema}
        placeholder="Thread name"
        className={className}
        onCancel={() => setRenamingThread(undefined)}
        onSubmit={(title) => {
          setRenamingThread(undefined);
          void renameThread(c, title);
        }}
      />
    </span>
  );
  const sections = chatActivitySections(all, now);
  const attention = sections.active.filter(
    (c) => c.waiting || unread(c),
  ).length;
  const mark = sections.active.some((c) => c.waiting)
    ? "waiting"
    : attention > 0
      ? "unread"
      : undefined;
  useEffect(() => onAttention?.(mark), [mark]);
  useEffect(() => {
    // A plain browser preview has no desktop bridge.
    void api?.setBadge?.(attention)?.catch(() => {});
  }, [attention]);
  const query = search.trim().toLowerCase();
  const matches = (c: ChatSummary) =>
    `${c.title} ${byId.get(c.projectId)?.name ?? ""}`
      .toLowerCase()
      .includes(query);
  const open = (c: ChatSummary) => {
    onChat(c);
  };
  /** Settling the open thread moves on to its neighbour in activity, or a new thread. */
  const settle = (c: ChatSummary) => {
    if (c.id === chatId) {
      const index = sections.active.findIndex((a) => a.id === c.id);
      const rest = sections.active.filter((a) => a.id !== c.id);
      const next = rest[Math.min(Math.max(index, 0), rest.length - 1)];
      const p = byId.get(c.projectId);
      if (next) onChat(next);
      else if (p) onNew(p);
    }
    void triage(c, { kind: "settle" });
  };
  const shortcuts = view === "activity" && !query;
  const drafts =
    view === "activity"
      ? activityDrafts(
          draftKeys,
          byId,
          new Map(all.map((c) => [c.id, c])),
          chatId,
        )
      : [];
  settleOpen.current = () => {
    const c = sections.active.find((a) => a.id === chatId);
    if (!c || c.running || c.waiting) return false;
    settle(c);
    return true;
  };
  jumpTo.current = (index) => {
    const c = sections.active[index];
    if (!shortcuts || !c) return false;
    open(c);
    return true;
  };

  const threadRow = (c: ChatSummary, withProject = false) => {
    const stale =
      now - c.updated > STALE_AFTER &&
      chatId !== c.id &&
      !c.running &&
      !c.waiting &&
      !unread(c);
    if (renamingThread === c.id)
      return (
        <div key={c.id} className="sb-thread-row">
          {renameInput(c, "sb-group-input sb-thread-input")}
        </div>
      );
    return (
      <ContextMenu.Root key={c.id}>
        <ContextMenu.Trigger
          className={`sb-thread-row ${stale ? "stale" : ""}`}
        >
          <button
            className={`sb-thread ${chatId === c.id ? "selected" : ""} ${unread(c) ? "unread" : ""}`}
            title={c.title}
            onClick={() => open(c)}
          >
            <ThreadTitle
              className="sb-thread-title"
              title={c.title}
              regenerating={regenerating.has(c.id)}
            />
            {withProject && (
              <small className="sb-thread-project">
                {byId.get(c.projectId)?.name}
              </small>
            )}
            {c.scope.kind === "pr" && !withProject && (
              <small className="sb-thread-pr">#{c.scope.ref.number}</small>
            )}
            <StatusMark chat={c} unread={unread(c)} now={now} />
          </button>
          {!c.running && !c.pending?.length && !c.nextSend && (
            <button
              className="sb-thread-archive"
              title="Archive"
              aria-label={`Archive ${c.title}`}
              onClick={() => void triage(c, { kind: "archive" })}
            >
              <Archive size={13} />
            </button>
          )}
        </ContextMenu.Trigger>
        {threadMenu(c)}
      </ContextMenu.Root>
    );
  };

  const renderProject = (p: Project) => {
    const chats = all.filter((c) => c.projectId === p.id);
    const isOpen = expanded[p.id] ?? p.id === projectId;
    const more = showAll[p.id];
    const visible = more ? chats : chats.slice(0, THREADS_PER_PROJECT);
    const busy = chats.some((c) => c.running || agentsSince(c.pending));
    return (
      <section
        key={p.id}
        className={[
          "sb-project",
          p.id === projectId && "current",
          dragging === p.id && "dragging",
          drop?.kind === "project" &&
            drop.id === p.id &&
            dragging !== p.id &&
            `drop-${drop.where}`,
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={(e) => {
          const row =
            e.currentTarget.firstElementChild!.getBoundingClientRect();
          dragOver(e, {
            kind: "project",
            id: p.id,
            where: e.clientY < row.top + row.height / 2 ? "before" : "after",
          });
        }}
        onDrop={(e) => drop?.kind === "project" && dropOn(e, drop)}
      >
        {renamingProject === p.id ? (
          <div className="sb-project-row">
            <span className="sb-project-expand">
              <ProjectFolderIcon id={p.id} open={isOpen} />
            </span>
            <GroupNameInput
              label="Project name"
              initial={p.name}
              schema={projectNameSchema}
              placeholder="Project name"
              className="sb-group-input sb-project-input"
              onCancel={() => setRenamingProject(undefined)}
              onSubmit={(name) => {
                setRenamingProject(undefined);
                renameProject(p.id, name);
              }}
            />
          </div>
        ) : (
          <ContextMenu.Root>
            <ContextMenu.Trigger
              className="sb-project-row"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PROJECT_DRAG, p.id);
                e.dataTransfer.effectAllowed = "move";
                setDragging(p.id);
              }}
              onDragEnd={clearDrag}
            >
              <button
                className="sb-project-expand"
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
                aria-expanded={isOpen}
                onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))}
              >
                <ProjectFolderIcon id={p.id} open={isOpen} />
              </button>
              {/* Like a group label, the whole row toggles; only its actions don't. */}
              <button
                className="sb-project-name"
                title={p.path}
                aria-expanded={isOpen}
                onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))}
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
            {visible.map((c) => threadRow(c))}
            {!chats.length && (
              <button className="sb-thread sb-ghost" onClick={() => onNew(p)}>
                <span className="sb-thread-title">Start a thread</span>
              </button>
            )}
            {chats.length > THREADS_PER_PROJECT && (
              <ShowMore
                more={more}
                hidden={chats.length - THREADS_PER_PROJECT}
                onToggle={() => setShowAll((s) => ({ ...s, [p.id]: !more }))}
              />
            )}
          </div>
        )}
      </section>
    );
  };

  const groupPaths: string[] = [];
  const tree = projectFolderTree(realProjects, groups);
  (function collect(node: ProjectFolderNode) {
    for (const folder of node.folders) {
      groupPaths.push(folder.path);
      collect(folder);
    }
  })(tree);

  const projectMenu = (p: Project) => (
    <MenuPopup side="bottom" align="end">
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => setRenamingProject(p.id)}
      >
        Rename
      </MenuAction>
      <MenuAction icon={<SquarePen size={13} />} onClick={() => onNew(p)}>
        New thread
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderOpen size={13} />}
        onClick={() =>
          void api
            .revealProject(p.id)
            .catch((e) =>
              setGroupError(e instanceof Error ? e.message : String(e)),
            )
        }
      >
        Open in Finder
      </MenuAction>
      <MenuAction
        icon={<Copy size={13} />}
        onClick={() => void api.writeClipboard(p.path)}
      >
        Copy path
      </MenuAction>
      <MenuAction
        icon={<Settings2 size={13} />}
        onClick={() => onSettings("projects", p.id)}
      >
        Project settings
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
      {groupPaths.map((path) => (
        <Menu.Item
          key={path}
          className="sb-menu-item"
          disabled={path === (p.folder ?? "")}
          onClick={() =>
            void changeGroups(() => moveProject(p.id, { kind: "folder", path }))
          }
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
          onClick={() =>
            void changeGroups(() =>
              moveProject(p.id, { kind: "folder", path: "" }),
            )
          }
        >
          Remove from group
        </MenuAction>
      )}
      {groupPaths.length > 0 && (
        <Menu.Separator className="sb-menu-separator" />
      )}
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => startGroup("", p.id)}
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
          setDraft(undefined);
          setRenaming(folder.path);
        }}
      >
        Rename
      </MenuAction>
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => startGroup(folder.path)}
      >
        New group inside
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderMinus size={13} />}
        hint="Projects stay"
        onClick={() =>
          void changeGroups(() => api.removeProjectGroup(folder.path))
        }
      >
        Remove group
      </MenuAction>
    </MenuPopup>
  );

  function renderFolder(node: ProjectFolderNode): React.ReactNode {
    return (
      <>
        {draft?.parent === node.path && (
          <GroupNameInput
            label="New group name"
            onCancel={() => setDraft(undefined)}
            onSubmit={(name) => {
              setDraft(undefined);
              createGroup(node.path, name, draft.project);
            }}
          />
        )}
        {node.folders.map((folder) => {
          const key = "folder:" + folder.path;
          const isOpen = expanded[key] ?? true;
          const into = drop?.kind === "folder" && drop.path === folder.path;
          const empty =
            !folder.folders.length &&
            !folder.projects.length &&
            draft?.parent !== folder.path;
          return (
            <section
              key={folder.path}
              className={[
                "sb-folder",
                draggingGroup === folder.path && "dragging",
                drop?.kind === "group" &&
                  drop.path === folder.path &&
                  `drop-${drop.where}`,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={`Group ${folder.path}`}
              onDragOver={(e) => {
                // Groups only trade places with their siblings.
                if (
                  !draggingGroup ||
                  draggingGroup === folder.path ||
                  parentGroup(draggingGroup) !== parentGroup(folder.path)
                )
                  return;
                const row =
                  e.currentTarget.firstElementChild!.getBoundingClientRect();
                dragOver(e, {
                  kind: "group",
                  path: folder.path,
                  where:
                    e.clientY < row.top + row.height / 2 ? "before" : "after",
                });
              }}
              onDrop={(e) => drop?.kind === "group" && dropOn(e, drop)}
            >
              {renaming === folder.path ? (
                <GroupNameInput
                  label="Group name"
                  initial={folder.name}
                  onCancel={() => setRenaming(undefined)}
                  onSubmit={(name) => {
                    setRenaming(undefined);
                    const to = joinGroup(parentGroup(folder.path), name);
                    setExpanded((state) => ({
                      ...state,
                      ["folder:" + to]: isOpen,
                    }));
                    void changeGroups(() =>
                      api.renameProjectGroup(folder.path, to),
                    );
                  }}
                />
              ) : (
                <ContextMenu.Root>
                  <ContextMenu.Trigger
                    className={`sb-folder-row ${into ? "drop-into" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(GROUP_DRAG, folder.path);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingGroup(folder.path);
                    }}
                    onDragEnd={clearDrag}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      dragOver(e, { kind: "folder", path: folder.path });
                      openWhileDragging(key, isOpen);
                    }}
                    onDrop={(e) =>
                      dropOn(e, { kind: "folder", path: folder.path })
                    }
                  >
                    <button
                      className="sb-folder-toggle"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} group ${folder.path}`}
                      aria-expanded={isOpen}
                      title="Double-click to rename"
                      onClick={() =>
                        setExpanded((state) => ({ ...state, [key]: !isOpen }))
                      }
                      onDoubleClick={() => setRenaming(folder.path)}
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
                        dragOver(e, { kind: "folder", path: folder.path })
                      }
                      onDrop={(e) =>
                        dropOn(e, { kind: "folder", path: folder.path })
                      }
                    >
                      <FolderInput size={13} />
                      {dragging ? "Drop here" : "Drag projects here"}
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

  const card = (c: ChatSummary, index: number) => {
    const p = byId.get(c.projectId);
    const shortcut =
      shortcuts && cmdHeld && jumpBinding && index < 9 ? index + 1 : undefined;
    const isUnread = unread(c);
    const selected = chatId === c.id;
    return (
      <ContextMenu.Root key={c.id}>
        <AwayPeek view={away[c.id]}>
          <ContextMenu.Trigger
            role="button"
            tabIndex={0}
            className={[
              "sb-card",
              selected && "selected",
              isUnread && "unread",
              // Only the open thread, finished-but-unread ones and open
              // questions stay bright; everything else, running included, dims.
              !selected && !isUnread && !c.waiting && "dim",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => open(c)}
            onKeyDown={rowKeys(() => open(c))}
          >
            <div className="sb-card-top">
              <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
              <span className="sb-card-name">
                <span className="sb-card-project">{p?.name}</span>
                {shortcut && (
                  <kbd className="sb-card-shortcut" aria-hidden>
                    <span className={mac ? "glyph" : undefined}>
                      {modifiersLabel(jumpBinding)}
                    </span>
                    {shortcut}
                  </kbd>
                )}
              </span>
              <CardState
                chat={c}
                unread={isUnread}
                now={now}
                stopped={awayStopped(away[c.id])}
              />
              <div className="sb-card-actions">
                {!c.waiting && (
                  <SnoozeMenu
                    now={now}
                    onSnooze={(until) =>
                      void triage(c, { kind: "snooze", until })
                    }
                  />
                )}
                {!c.running && !c.waiting && (
                  <button
                    className="sb-card-action"
                    title={`Settle${c.id === chatId && settleKeys ? ` (${settleKeys})` : ""} — hide until something new happens`}
                    onClick={(e) => {
                      e.stopPropagation();
                      settle(c);
                    }}
                  >
                    <Check size={13} />
                    Settle
                  </button>
                )}
              </div>
            </div>
            {renamingThread === c.id ? (
              renameInput(c, "sb-group-input sb-card-title-input")
            ) : (
              <ThreadTitle
                className="sb-card-title"
                title={c.title}
                regenerating={regenerating.has(c.id)}
              />
            )}
            <div className="sb-card-meta">
              {c.scope.kind === "pr" && (
                <span className="sb-card-scope">
                  <GitPullRequest size={11} />#{c.scope.ref.number}
                </span>
              )}
              <span className="sb-card-branch">{c.branch}</span>
              <AwayWhere view={away[c.id]} />
              <CardAgents chat={c} />
            </div>
          </ContextMenu.Trigger>
        </AwayPeek>
        {threadMenu(c)}
      </ContextMenu.Root>
    );
  };

  const draftCard = (d: ActivityDraft) => (
    <DraftCard
      key={d.key}
      draft={d}
      selected={d.id === draftId}
      onOpen={() => (d.chat ? onChat(d.chat) : onDraft(d.project, d.id))}
      onSendOpen={onSendDraft}
    />
  );

  const compactRow = (c: ChatSummary, kind: "snoozed" | "settled") => {
    const p = byId.get(c.projectId);
    return (
      <ContextMenu.Root key={c.id}>
        <ContextMenu.Trigger
          role="button"
          tabIndex={0}
          className={`sb-compact ${chatId === c.id ? "selected" : ""}`}
          onClick={() => open(c)}
          onKeyDown={rowKeys(() => open(c))}
        >
          <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
          {renamingThread === c.id ? (
            renameInput(c, "sb-group-input sb-compact-title-input")
          ) : (
            <ThreadTitle
              className="sb-compact-title"
              title={c.title}
              regenerating={regenerating.has(c.id)}
            />
          )}
          <small
            title={
              c.autoSettled
                ? c.worktree?.landed
                  ? "Settled when its PR merged"
                  : "Settled after days without activity"
                : undefined
            }
          >
            {kind === "snoozed"
              ? wakeLabel(c.snoozedUntil!, new Date(now))
              : shortAge(c.updated, now)}
          </small>
          <button
            className="sb-card-action icon"
            title={kind === "snoozed" ? "Wake now" : "Move back to activity"}
            aria-label={kind === "snoozed" ? "Wake now" : "Unsettle"}
            onClick={(e) => {
              e.stopPropagation();
              void triage(c, {
                kind: kind === "snoozed" ? "wake" : "unsettle",
              });
            }}
          >
            {kind === "snoozed" ? (
              <Sunrise size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
          </button>
        </ContextMenu.Trigger>
        {threadMenu(c)}
      </ContextMenu.Root>
    );
  };

  const shelf = (
    kind: "snoozed" | "settled",
    label: string,
    items: ChatSummary[],
  ) =>
    items.length > 0 && (
      <section className="sb-shelf">
        <button
          className="sb-shelf-toggle"
          aria-expanded={shelves[kind]}
          onClick={() => {
            setShelves((s) => ({ ...s, [kind]: !s[kind] }));
            setShelfShown((s) => ({ ...s, [kind]: SHELF_PAGE }));
          }}
        >
          <span>
            {label} <b>{items.length}</b>
          </span>
          <hr />
          <ChevronRight size={12} />
        </button>
        {shelves[kind] && (
          <div className="sb-shelf-list">
            {items.slice(0, shelfShown[kind]).map((c) => compactRow(c, kind))}
            {items.length > shelfShown[kind] && (
              <button
                className="sb-thread sb-ghost"
                onClick={() =>
                  setShelfShown((s) => ({ ...s, [kind]: s[kind] + SHELF_PAGE }))
                }
              >
                <span className="sb-thread-title">
                  Show {Math.min(SHELF_PAGE, items.length - shelfShown[kind])}{" "}
                  more
                </span>
              </button>
            )}
          </div>
        )}
      </section>
    );

  const activity = (
    <div className="sb-scroll sb-activity">
      <div className="sb-view-heading">
        <h2>Activity</h2>
        <small>
          {sections.active.length
            ? `${sections.active.length} open`
            : "All settled"}
        </small>
      </div>
      <div className={`sb-cards ${shortcuts && cmdHeld ? "shortcuts" : ""}`}>
        {drafts.map(draftCard)}
        {sections.active.map(card)}
      </div>
      {!sections.active.length && !drafts.length && (
        <div className="sb-empty">
          <span className="sb-empty-icon">
            <Check size={18} />
          </span>
          <strong>Inbox zero</strong>
          <p>Threads come back here when an agent replies or needs you.</p>
        </div>
      )}
      {shelf("snoozed", "Snoozed", sections.snoozed)}
      {shelf("settled", "Settled", sections.settled)}
    </div>
  );

  const scratch = all.filter((c) => scratchIds.has(c.projectId));
  const moreScratch = showAll.scratchpad;
  // The open Scratchpad chat before its first message.
  const scratchDraft = !!projectId && scratchIds.has(projectId) && !chatId;
  const scratchpad = (
    <section className="sb-scratchpad">
      <div className="sb-section-heading">
        <SectionTitle
          label="Scratchpad"
          open={!folded.scratchpad}
          onToggle={() => fold("scratchpad")}
        />
        <IconButton
          label={`New chat  ${newScratchKeys}`.trim()}
          onClick={onNewScratch}
        >
          <Plus size={14} />
        </IconButton>
      </div>
      {!folded.scratchpad && (
        <div className="sb-thread-list flat">
          {scratchDraft && (
            <div className="sb-thread-row">
              <button className="sb-thread selected" disabled>
                <span className="sb-thread-title">New chat</span>
              </button>
            </div>
          )}
          {(moreScratch ? scratch : scratch.slice(0, THREADS_PER_PROJECT)).map(
            (c) => threadRow(c),
          )}
          {!scratch.length && !scratchDraft && (
            <button className="sb-thread sb-ghost" onClick={onNewScratch}>
              <span className="sb-thread-title">Ask anything</span>
            </button>
          )}
          {scratch.length > THREADS_PER_PROJECT && (
            <ShowMore
              more={moreScratch}
              hidden={scratch.length - THREADS_PER_PROJECT}
              onToggle={() =>
                setShowAll((s) => ({ ...s, scratchpad: !moreScratch }))
              }
            />
          )}
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
          drop?.kind === "folder" && drop.path === "" ? "drop-into" : ""
        }`}
        title={dragging ? "Drop to move out of groups" : undefined}
        onDragOver={(e) => dragOver(e, { kind: "folder", path: "" })}
        onDrop={(e) => dropOn(e, { kind: "folder", path: "" })}
      >
        <SectionTitle
          label="Projects"
          open={!folded.projects}
          onToggle={() => fold("projects")}
        />
        <div className="sb-heading-actions">
          <div className="sb-row-actions">
            <IconButton label="New group" onClick={() => startGroup("")}>
              <FolderPlus size={13} />
            </IconButton>
          </div>
          <IconButton label="Add project" onClick={onAdd}>
            <Plus size={14} />
          </IconButton>
        </div>
      </div>
      {groupError && <p className="sb-note error">{groupError}</p>}
      {!folded.projects && renderFolder(tree)}
      {!folded.projects && !realProjects.length && (
        <p className="sb-note">Add a project folder to get started.</p>
      )}
    </div>
  );

  const results = all.filter(matches);
  const listed =
    allResultsFor === query ? results : results.slice(0, SEARCH_RESULTS);
  const searching = (
    <div className="sb-scroll">
      <div className="sb-view-heading">
        <h2>Results</h2>
        <small>{results.length}</small>
      </div>
      <div className="sb-thread-list flat">
        {listed.map((c) => threadRow(c, true))}
        {listed.length < results.length && (
          <button
            className="sb-thread sb-ghost"
            onClick={() => setAllResultsFor(query)}
          >
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
          />
          {search && (
            <button
              className="sb-search-clear"
              aria-label="Clear search"
              onClick={() => setSearch("")}
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
            setSearch("");
            setView((v) => (v === "activity" ? "threads" : "activity"));
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
      {query ? searching : view === "activity" ? activity : threads}
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
