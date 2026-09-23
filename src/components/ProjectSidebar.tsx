import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  Archive,
  Bell,
  Check,
  ChevronRight,
  Clock,
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
  type Project,
  type ChatSummary,
  type ChatTriage,
} from "../../shared/projects";
import {
  chatActivitySection,
  chatIsEmpty,
  shortAge,
  snoozePresets,
  wakeLabel,
} from "../../shared/chat-activity";
import { api } from "../lib/api";
import { IconButton, Spinner } from "./ui";
import { UpdateButton } from "./UpdateButton";
import { ProviderIcon } from "./ComposerModelPicker";
import { ProjectBadge, useProjectIcon } from "./ProjectBadge";
import {
  joinGroup,
  moveProjectInList,
  parentGroup,
  projectFolderTree,
  projectGroupNameSchema,
  type ProjectFolderNode,
} from "../../shared/project-folders";
import "./sidebar.css";

const THREADS_PER_PROJECT = 5;
const STALE_AFTER = 24 * 60 * 60 * 1000;
const PROJECT_DRAG = "application/x-relay-project";

type DropTarget =
  | { kind: "project"; id: string; where: "before" | "after" }
  | { kind: "folder"; path: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sidebar conveniences never block the workspace.
  }
}

/** Last time each thread was open here; drives the unread dot. */
function useSeen(chatId: string | undefined, chats: ChatSummary[]) {
  const [since] = useState(() => {
    const saved = Number(localStorage.getItem("relay-thread-seen-since"));
    if (saved > 0) return saved;
    const now = Date.now();
    localStorage.setItem("relay-thread-seen-since", String(now));
    return now;
  });
  const [seen, setSeen] = useState<Record<string, number>>(() =>
    readJson("relay-thread-seen", {}),
  );
  const current = chats.find((c) => c.id === chatId);
  useEffect(() => {
    if (!current || (seen[current.id] ?? 0) >= current.updated) return;
    setSeen((s) => {
      const next = { ...s, [current.id]: current.updated };
      writeJson("relay-thread-seen", next);
      return next;
    });
  }, [current?.id, current?.updated]);
  return (c: ChatSummary) =>
    c.id !== chatId && c.updated > Math.max(since, seen[c.id] ?? 0);
}

function useNow(interval = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

function ProjectFolderIcon({ id, open }: { id: string; open: boolean }) {
  const icon = useProjectIcon(id);
  if (icon) return <img className="sb-project-icon" src={icon} alt="" />;
  return open ? <FolderOpen size={15} /> : <Folder size={15} />;
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
  if (chat.running)
    return (
      <span className="sb-status running" title="Working">
        <Spinner size={11} />
      </span>
    );
  if (unread)
    return (
      <span className="sb-status unread" title="New activity">
        <i />
      </span>
    );
  return <time className="sb-age">{shortAge(chat.updated, now)}</time>;
}

function SnoozeMenu({
  onSnooze,
  now,
}: {
  onSnooze: (until: number) => void;
  now: number;
}) {
  const presets = useMemo(() => snoozePresets(new Date(now)), [now]);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="sb-card-action icon"
        aria-label="Snooze"
        title="Snooze"
        onClick={(e) => e.stopPropagation()}
      >
        <Clock size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="sb-menu">
            <div className="sb-menu-heading">Snooze until…</div>
            {presets.map((preset) => (
              <Menu.Item
                key={preset.id}
                className="sb-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  onSnooze(preset.until);
                }}
              >
                <span>{preset.label}</span>
                <small>{wakeLabel(preset.until, new Date(now))}</small>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Right side of a card's top row: live state, else the age. */
function CardState({
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
      <span className="sb-card-state waiting">
        <i />
        Needs input
      </span>
    );
  if (chat.running)
    return (
      <span className="sb-card-state running">
        <Spinner size={11} />
        Working
        {chat.runningSince && <Elapsed since={chat.runningSince} />}
      </span>
    );
  if (chat.snoozedUntil && chat.snoozedUntil <= now)
    return <span className="sb-card-state unread">Woke up</span>;
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

interface ComposerDraft {
  key: string;
  text: string;
  chatId?: string;
  projectId?: string;
}

/**
 * Unsent composer text from ProjectChat's `chat-draft:<chat>[:<reply>]` and
 * `chat-draft:new:<project>` keys. The open thread's own draft is already on
 * screen, so it is left out.
 */
function composerDrafts(
  chatId: string | undefined,
  projectId: string | undefined,
  inChat: boolean,
): ComposerDraft[] {
  const drafts: ComposerDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("chat-draft:")) continue;
      const text = localStorage.getItem(key)?.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const rest = key.slice("chat-draft:".length);
      if (rest.startsWith("new:")) {
        const project = rest.slice(4);
        if (!inChat && project === projectId) continue;
        drafts.push({ key, text, projectId: project });
      } else {
        const chat = rest.split(":")[0];
        // One card per thread, even with reply drafts alongside the main one.
        if (chat === chatId || drafts.some((d) => d.chatId === chat)) continue;
        drafts.push({ key, text, chatId: chat });
      }
    }
  } catch {
    // Storage is a convenience here.
  }
  return drafts.sort((a, b) => a.key.localeCompare(b.key));
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
  schema?: typeof projectGroupNameSchema | typeof projectNameSchema;
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
        maxLength={schema === projectNameSchema ? 80 : 60}
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
  projects,
  projectId,
  chatId,
  dirty,
  account,
  onProject,
  onChat,
  onNew,
  onAdd,
  onShared,
  onSettings,
  onAccount,
  onInbox,
}: {
  projects: Project[];
  projectId?: string;
  chatId?: string;
  dirty: boolean;
  account?: string;
  onProject: (p: Project) => void;
  onChat: (c: ChatSummary) => void;
  onNew: (p: Project) => void;
  onAdd: () => void;
  onShared: (p: Project) => void;
  onSettings: () => void;
  onAccount: () => void;
  onInbox: () => void;
}) {
  const qc = useQueryClient();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"threads" | "activity">(() =>
    localStorage.getItem("relay-sidebar-view") === "activity"
      ? "activity"
      : "threads",
  );
  useEffect(() => localStorage.setItem("relay-sidebar-view", view), [view]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      Object.entries(
        readJson<Record<string, unknown>>("relay-project-expansion", {}),
      )
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => [key, value === true]),
    ),
  );
  useEffect(() => writeJson("relay-project-expansion", expanded), [expanded]);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [shelves, setShelves] = useState({ snoozed: false, settled: false });
  const groups = useQuery({
    queryKey: ["project-groups"],
    queryFn: () => api.projectGroups(),
  }).data;
  /** Where a new group's name is being typed, and a project to move into it. */
  const [draft, setDraft] = useState<{ parent: string; project?: string }>();
  const [renaming, setRenaming] = useState<string>();
  const [renamingProject, setRenamingProject] = useState<string>();
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
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const expandTimer = useRef<{ key: string; timer: number } | null>(null);
  const clearDrag = () => {
    setDragging(null);
    setDrop(null);
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  const moveProject = async (id: string, target: DropTarget) => {
    let folder = "",
      before: string | null = null;
    if (target.kind === "folder") folder = target.path;
    else {
      const others = projects.filter((p) => p.id !== id);
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
  /** Shared dragover handling: accept only project drags, mark the target. */
  const dragOver = (e: React.DragEvent, target: DropTarget) => {
    if (!dragging || !e.dataTransfer.types.includes(PROJECT_DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDrop((current) =>
      JSON.stringify(current) === JSON.stringify(target) ? current : target,
    );
  };
  const dropOn = (e: React.DragEvent, target: DropTarget) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const id = dragging;
    clearDrag();
    if (target.kind === "project" && target.id === id) return;
    void moveProject(id, target);
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
  const lists = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["project-chats", p.id],
      queryFn: () => api.projectChats(p.id),
      refetchInterval: 5000,
    })),
  });
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (
          e.title ||
          e.message.role === "user" ||
          e.message.status !== "streaming"
        )
          void qc.invalidateQueries({ queryKey: ["project-chats"] });
      }),
    [qc],
  );
  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyU") {
        e.preventDefault();
        setView((v) => (v === "activity" ? "threads" : "activity"));
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);
  /** Holding ⌘ on the activity view shows ⌘1–⌘9 on the first nine cards. */
  const [cmdHeld, setCmdHeld] = useState(false);
  const jumpTo = useRef<(index: number) => boolean>(() => false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      setCmdHeld(e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey);
      if (!e.metaKey || e.altKey || e.shiftKey || e.ctrlKey) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && jumpTo.current(Number(digit[1]) - 1)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (!e.metaKey) setCmdHeld(false);
    };
    const release = () => setCmdHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const all = lists
    .flatMap((q) => q.data ?? [])
    .filter((c) => !c.archivedAt && (c.id === chatId || !chatIsEmpty(c)))
    .sort((a, b) => b.updated - a.updated);
  const unread = useSeen(chatId, all);
  const triage = async (c: ChatSummary, action: ChatTriage) => {
    qc.setQueryData<ChatSummary[]>(["project-chats", c.projectId], (list) =>
      list?.map((entry) =>
        entry.id !== c.id
          ? entry
          : action.kind === "archive"
            ? { ...entry, archivedAt: Date.now() }
            : {
              ...entry,
              settledAt: action.kind === "settle" ? Date.now() : undefined,
              snoozedAt: action.kind === "snooze" ? Date.now() : undefined,
              snoozedUntil: action.kind === "snooze" ? action.until : undefined,
            },
      ),
    );
    try {
      await api.triageProjectChat(c.id, action);
    } finally {
      void qc.invalidateQueries({ queryKey: ["project-chats", c.projectId] });
    }
  };
  const sections = {
    active: [] as ChatSummary[],
    snoozed: [] as ChatSummary[],
    settled: [] as ChatSummary[],
  };
  for (const c of all) sections[chatActivitySection(c, now)].push(c);
  const attention = sections.active.filter(
    (c) => c.waiting || unread(c),
  ).length;
  const query = search.trim().toLowerCase();
  const matches = (c: ChatSummary) =>
    `${c.title} ${byId.get(c.projectId)?.name ?? ""}`
      .toLowerCase()
      .includes(query);
  const open = (c: ChatSummary) => {
    if (!dirty) onChat(c);
  };
  const shortcuts = view === "activity" && !query;
  // Re-read on every render: drafts live in localStorage and the sidebar
  // re-renders on its clock and chat refetches anyway.
  const drafts =
    view === "activity" ? composerDrafts(chatId, projectId, !!chatId) : [];
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
    return (
      <div key={c.id} className={`sb-thread-row ${stale ? "stale" : ""}`}>
        <button
          className={`sb-thread ${chatId === c.id ? "selected" : ""} ${unread(c) ? "unread" : ""}`}
          disabled={dirty}
          title={c.title}
          onClick={() => open(c)}
        >
          <span className="sb-thread-title">{c.title}</span>
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
        {!c.running && (
          <button
            className="sb-thread-archive"
            title="Archive"
            aria-label={`Archive ${c.title}`}
            onClick={() => void triage(c, { kind: "archive" })}
          >
            <Archive size={13} />
          </button>
        )}
      </div>
    );
  };

  const renderProject = (p: Project) => {
    const chats = all.filter((c) => c.projectId === p.id);
    const isOpen = expanded[p.id] ?? p.id === projectId;
    const more = showAll[p.id];
    const visible = more ? chats : chats.slice(0, THREADS_PER_PROJECT);
    const busy = chats.some((c) => c.running);
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
              draggable={!dirty}
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
              <button
                className="sb-project-name"
                disabled={dirty}
                title={p.path}
                onClick={() => {
                  onProject(p);
                  setExpanded((s) => ({ ...s, [p.id]: true }));
                }}
                >
                <span>{p.name}</span>
                {/* The folder icon is the accessible toggle; this mirrors groups. */}
                <ChevronRight
                  size={11}
                  className="sb-project-chevron"
                  data-open={isOpen || undefined}
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((s) => ({ ...s, [p.id]: !isOpen }));
                  }}
                />
                {busy && !isOpen && (
                  <span className="sb-status running" title="Working">
                    <Spinner size={11} />
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
                  disabled={dirty}
                  onClick={() => onShared(p)}
                >
                  <Users size={13} />
                </IconButton>
                <IconButton
                  label={`New thread in ${p.name}`}
                  disabled={dirty}
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
              <button
                className="sb-thread sb-ghost"
                disabled={dirty}
                onClick={() => onNew(p)}
              >
                <span className="sb-thread-title">Start a thread</span>
              </button>
            )}
            {chats.length > THREADS_PER_PROJECT && (
              <button
                className="sb-thread sb-ghost"
                onClick={() => setShowAll((s) => ({ ...s, [p.id]: !more }))}
              >
                <span className="sb-thread-title">
                  {more
                    ? "Show less"
                    : `Show ${chats.length - THREADS_PER_PROJECT} more`}
                </span>
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  const groupPaths: string[] = [];
  const tree = projectFolderTree(projects, groups);
  (function collect(node: ProjectFolderNode) {
    for (const folder of node.folders) {
      groupPaths.push(folder.path);
      collect(folder);
    }
  })(tree);

  const projectMenu = (p: Project) => (
    <Menu.Portal>
      <Menu.Positioner
        side="bottom"
        align="end"
        className="sb-menu-positioner"
        sideOffset={4}
      >
        <Menu.Popup className="sb-menu">
          <Menu.Item
            className="sb-menu-item"
            onClick={() => setRenamingProject(p.id)}
          >
            <span className="sb-menu-label">
              <Pencil size={13} />
              Rename
            </span>
          </Menu.Item>
          <Menu.Item
            className="sb-menu-item"
            disabled={dirty}
            onClick={() => onNew(p)}
          >
            <span className="sb-menu-label">
              <SquarePen size={13} />
              New thread
            </span>
          </Menu.Item>
          <Menu.Separator className="sb-menu-separator" />
          <Menu.Item
            className="sb-menu-item"
            onClick={() =>
              void api
                .revealProject(p.id)
                .catch((e) =>
                  setGroupError(e instanceof Error ? e.message : String(e)),
                )
            }
          >
            <span className="sb-menu-label">
              <FolderOpen size={13} />
              Open in Finder
            </span>
          </Menu.Item>
          <Menu.Item
            className="sb-menu-item"
            onClick={() => void navigator.clipboard.writeText(p.path)}
          >
            <span className="sb-menu-label">
              <Copy size={13} />
              Copy path
            </span>
          </Menu.Item>
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
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );

  const moveMenu = (p: Project) => (
    <Menu.Portal>
      <Menu.Positioner
        side="right"
        align="start"
        className="sb-menu-positioner"
        sideOffset={4}
      >
        <Menu.Popup className="sb-menu">
          {groupPaths.map((path) => (
            <Menu.Item
              key={path}
              className="sb-menu-item"
              disabled={path === (p.folder ?? "")}
              onClick={() => void moveProject(p.id, { kind: "folder", path })}
            >
              <span className="sb-menu-group">
                {path.split("/").map((name, i, parts) => (
                  <span
                    key={i}
                    className={i < parts.length - 1 ? "parent" : ""}
                  >
                    {name}
                  </span>
                ))}
              </span>
              {path === p.folder && <Check size={13} />}
            </Menu.Item>
          ))}
          {p.folder && (
            <Menu.Item
              className="sb-menu-item"
              onClick={() =>
                void moveProject(p.id, { kind: "folder", path: "" })
              }
            >
              <span className="sb-menu-label">
                <FolderMinus size={13} />
                Remove from group
              </span>
            </Menu.Item>
          )}
          {groupPaths.length > 0 && (
            <Menu.Separator className="sb-menu-separator" />
          )}
          <Menu.Item
            className="sb-menu-item"
            onClick={() => startGroup("", p.id)}
          >
            <span className="sb-menu-label">
              <FolderPlus size={13} />
              New group…
            </span>
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );

  const groupMenu = (folder: ProjectFolderNode) => (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align="end" sideOffset={4}>
        <Menu.Popup className="sb-menu">
          <Menu.Item
            className="sb-menu-item"
            onClick={() => {
              setDraft(undefined);
              setRenaming(folder.path);
            }}
          >
            <span className="sb-menu-label">
              <Pencil size={13} />
              Rename
            </span>
          </Menu.Item>
          <Menu.Item
            className="sb-menu-item"
            onClick={() => startGroup(folder.path)}
          >
            <span className="sb-menu-label">
              <FolderPlus size={13} />
              New group inside
            </span>
          </Menu.Item>
          <Menu.Separator className="sb-menu-separator" />
          <Menu.Item
            className="sb-menu-item"
            onClick={() =>
              void changeGroups(() => api.removeProjectGroup(folder.path))
            }
          >
            <span className="sb-menu-label">
              <FolderMinus size={13} />
              Remove group
            </span>
            <small>Projects stay</small>
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
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
              className="sb-folder"
              aria-label={`Group ${folder.path}`}
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
                    onDragOver={(e) => {
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
    const shortcut = shortcuts && cmdHeld && index < 9 ? index + 1 : undefined;
    const isUnread = unread(c);
    const selected = chatId === c.id;
    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        aria-disabled={dirty}
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open(c);
          }
        }}
      >
        <div className="sb-card-top">
          <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
          <span className="sb-card-project">{p?.name}</span>
          {shortcut && (
            <kbd className="sb-card-shortcut" aria-hidden>
              ⌘{shortcut}
            </kbd>
          )}
          <CardState chat={c} unread={isUnread} now={now} />
          <div className="sb-card-actions">
            {!c.waiting && (
              <SnoozeMenu
                now={now}
                onSnooze={(until) => void triage(c, { kind: "snooze", until })}
              />
            )}
            {!c.running && !c.waiting && (
              <button
                className="sb-card-action"
                title="Settle — hide until something new happens"
                onClick={(e) => {
                  e.stopPropagation();
                  void triage(c, { kind: "settle" });
                }}
              >
                <Check size={13} />
                Settle
              </button>
            )}
          </div>
        </div>
        <div className="sb-card-title">{c.title}</div>
        <div className="sb-card-meta">
          {c.scope.kind === "pr" && (
            <span className="sb-card-scope">
              <GitPullRequest size={11} />#{c.scope.ref.number}
            </span>
          )}
          <span className="sb-card-branch">{c.branch}</span>
          {c.provider && (
            <span className="sb-card-provider">
              <ProviderIcon provider={c.provider} />
            </span>
          )}
        </div>
      </div>
    );
  };

  const draftCard = (d: ComposerDraft) => {
    const chat = d.chatId ? all.find((c) => c.id === d.chatId) : undefined;
    const p = byId.get(chat?.projectId ?? d.projectId ?? "");
    if (!p || (d.chatId && !chat)) return null;
    const resume = () => {
      if (dirty) return;
      if (chat) onChat(chat);
      else onNew(p);
    };
    return (
      <div
        key={d.key}
        role="button"
        tabIndex={0}
        aria-disabled={dirty}
        className="sb-card draft"
        title={chat ? `Draft in ${chat.title}` : `New thread in ${p.name}`}
        onClick={resume}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            resume();
          }
        }}
      >
        <div className="sb-card-top">
          <SquarePen size={14} className="sb-draft-icon" aria-label="Draft" />
          <ProjectBadge id={p.id} name={p.name} />
          <span className="sb-card-project">{p.name}</span>
        </div>
        <div className="sb-draft-text">{d.text}</div>
      </div>
    );
  };

  const compactRow = (c: ChatSummary, kind: "snoozed" | "settled") => {
    const p = byId.get(c.projectId);
    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        className={`sb-compact ${chatId === c.id ? "selected" : ""}`}
        onClick={() => open(c)}
        onKeyDown={(e) => {
          if (e.key === "Enter") open(c);
        }}
      >
        <ProjectBadge id={p?.id} name={p?.name ?? "?"} />
        <span className="sb-compact-title">{c.title}</span>
        <small>
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
            void triage(c, { kind: kind === "snoozed" ? "wake" : "unsettle" });
          }}
        >
          {kind === "snoozed" ? <Sunrise size={13} /> : <RotateCcw size={13} />}
        </button>
      </div>
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
          onClick={() => setShelves((s) => ({ ...s, [kind]: !s[kind] }))}
        >
          <span>
            {label} <b>{items.length}</b>
          </span>
          <hr />
          <ChevronRight size={12} />
        </button>
        {shelves[kind] && (
          <div className="sb-shelf-list">
            {items.map((c) => compactRow(c, kind))}
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

  const threads = (
    <div className="sb-scroll">
      <nav className="sb-nav">
        <button
          className="sb-nav-item primary"
          disabled={dirty || !projects.length}
          onClick={() => {
            const p = byId.get(projectId ?? "") ?? projects[0];
            if (p) onNew(p);
          }}
        >
          <SquarePen size={15} />
          New thread
        </button>
        <button className="sb-nav-item" disabled={dirty} onClick={onInbox}>
          <GitPullRequest size={15} />
          Pull requests
        </button>
      </nav>
      <div
        className={`sb-section-heading ${
          drop?.kind === "folder" && drop.path === "" ? "drop-into" : ""
        }`}
        title={dragging ? "Drop to move out of groups" : undefined}
        onDragOver={(e) => dragOver(e, { kind: "folder", path: "" })}
        onDrop={(e) => dropOn(e, { kind: "folder", path: "" })}
      >
        <h2>Projects</h2>
        <div className="sb-row-actions">
          <IconButton label="New group" onClick={() => startGroup("")}>
            <FolderPlus size={13} />
          </IconButton>
          <IconButton label="Add project" disabled={dirty} onClick={onAdd}>
            <Plus size={14} />
          </IconButton>
        </div>
      </div>
      {groupError && <p className="sb-note error">{groupError}</p>}
      {renderFolder(tree)}
      {!projects.length && (
        <p className="sb-note">Add a local Git folder to get started.</p>
      )}
    </div>
  );

  const results = all.filter(matches);
  const searching = (
    <div className="sb-scroll">
      <div className="sb-view-heading">
        <h2>Results</h2>
        <small>{results.length}</small>
      </div>
      <div className="sb-thread-list flat">
        {results.slice(0, 50).map((c) => threadRow(c, true))}
      </div>
      {!results.length && <p className="sb-note">No matching threads.</p>}
    </div>
  );

  return (
    <div className="sb">
      <div className="sb-top">
        <div className="sb-search">
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
        </div>
        <button
          className={`sb-bell ${view === "activity" ? "active" : ""}`}
          aria-pressed={view === "activity"}
          aria-label="View activity"
          title="View activity  ⌥⌘U"
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
      <div className="sb-footer">
        <button className="sb-account" onClick={onAccount}>
          <span className="sb-avatar" aria-hidden>
            {(account ?? "?").slice(0, 2).toUpperCase()}
          </span>
          <span>{account ?? "Connect Gitea"}</span>
        </button>
        <UpdateButton />
        <IconButton label="Open settings" onClick={onSettings}>
          <Settings2 size={15} />
        </IconButton>
      </div>
    </div>
  );
}
