// Three ways to lay out what a thread shows besides its chat: the pane strip
// trimmed to what's open, a rail of surfaces, or one work pane with tabs.
// Real sidebar, messages and composer on sample data.
// Open http://127.0.0.1:5177/previews/surfaces/ (?v=a|b|c)
import "../_shared/desktop-stub";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Files,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitFork,
  GitGraph,
  Globe,
  MessageSquare,
  MonitorUp,
  Maximize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RotateCcw,
  SquareTerminal,
  X,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/ui/workspace-panes.css";
import "../../src/features/changes/git-actions.css";
import "../../src/features/changes/working-tree.css";
import "../../src/features/terminal/terminal-drawer.css";
import "../../src/app/ci-status.css";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./surfaces.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { RelayMark } from "../../src/ui/RelayMark";
import { Pane as RealPane, PaneHeader, PaneToggles } from "../../src/ui/WorkspacePanes";
import { paneFrame, useWorkspacePanes, type PaneId } from "../../src/lib/workspace-panes";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { Message } from "../../src/features/thread/ProjectMessage";
import { ProjectComposer } from "../../src/features/composer/ProjectComposer";
import type { ChatMessage } from "../../shared/projects";
import type { Api } from "../../shared/types";
import { projectRoot } from "../unread-divider/unread-divider-data";
import {
  changedFiles,
  chats,
  commits,
  diff,
  lines,
  messages,
  openChat,
  projects,
  terminalLines,
  tree,
} from "./surfaces-data";

localStorage.setItem("relay-sidebar-view", "activity");
localStorage.setItem("composer-settings:new:sf", JSON.stringify({ agent: "claude" }));
initAppearance();
initWindowFocus();

Object.assign(window.relay, {
  projectChats: async (id: string) => chats.filter((c) => c.projectId === id),
  scratchChats: async () => [],
  projectGroups: async () => [],
  updateState: async () => ({ status: "off", current: "0.9.1" }),
  onUpdate: () => () => {},
  agentVersions: async () => ({ agents: [], checking: false }),
  onAgentVersions: () => () => {},
  onProjectChat: () => () => {},
  triageProjectChat: async () => {},
  handoffViews: async () => ({}),
  bringBackThread: async () => {},
  agentAccounts: async () => ({ accounts: [], inUse: {} as never, signingIn: null, signInError: null }),
  onAgentAccounts: () => () => {},
  onDictationState: () => () => {},
} satisfies Partial<Record<keyof Api, unknown>>);

const queryClient = new QueryClient();

type Variant = "a" | "b" | "c" | "d" | "e";
type Surface = "chat" | "changes" | "files" | "history" | "terminal" | "browser";
type GitState = "clean" | "dirty" | "ahead";

const variants: { id: Variant; label: string; about: string }[] = [
  {
    id: "e",
    label: "E · Chat + Changes, panel for the rest",
    about:
      "Chat and Changes stay as they are, and the panel is a third pane like them: toggle it in the strip, drag the toggles or the pane heads to reorder, drag the edges to resize. Empty, it lists Files, History, Terminal, Browser and Pull request with one-letter shortcuts; picking one makes it a tab, + adds another. The terminal also keeps its place below the panes (⌘J) with tabs for more; the panel can hold terminals too.",
  },
  {
    id: "d",
    label: "D · Panels with a picker",
    about:
      "The title bar keeps the title, checks and two buttons: a panel under the chat and a panel beside it. An empty panel lists the surfaces with one-letter shortcuts; picking one makes it a tab, and + adds another. Commit and Push sit in the panel's head while Changes is in front.",
  },
  {
    id: "a",
    label: "A · Only what's open",
    about:
      "Chat and Changes stay in the strip. Files, History, Terminal and Browser show up there only while they're open; + lists the rest with their shortcuts. Hand off and the rare things moved into the thread's ⋯ menu.",
  },
  {
    id: "b",
    label: "B · Rail",
    about:
      "The title bar keeps only the title, checks and Git. Every surface is an icon on a rail at the window's edge, lit while it's open. Changes carries its +/− under the icon. Hand off is in the ⋯ menu.",
  },
  {
    id: "c",
    label: "C · One work pane",
    about:
      "Chat on the left, one work pane on the right with tabs: Changes, Files, History, Terminal, Browser. The title bar has a single button to show or hide the pane. Hand off is in the ⋯ menu.",
  },
];

const SURFACES: { id: Surface; label: string; icon: ReactNode; key: string }[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={14} />, key: "⌘⇧C" },
  { id: "changes", label: "Changes", icon: <GitCompareArrows size={14} />, key: "⌘⇧D" },
  { id: "files", label: "Files", icon: <Files size={14} />, key: "⌘⇧E" },
  { id: "history", label: "History", icon: <GitGraph size={14} />, key: "⌘⇧H" },
  { id: "terminal", label: "Terminal", icon: <SquareTerminal size={14} />, key: "⌘J" },
  { id: "browser", label: "Browser", icon: <Globe size={14} />, key: "⌘⇧B" },
];
const surface = (id: Surface) => SURFACES.find((s) => s.id === id)!;
const PINNED: Surface[] = ["chat", "changes"];
const EXTRAS: Surface[] = ["files", "history", "terminal", "browser"];
const PANES: Surface[] = ["changes", "files", "history", "browser"];
const TABS: Surface[] = ["changes", "files", "history", "terminal", "browser"];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="preview-control">
      <span>{label}</span>
      <div className="preview-segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A button that opens a menu under itself; closes on outside click or Esc. */
function MenuButton({
  button,
  className,
  title,
  align = "end",
  children,
}: {
  button: ReactNode;
  className: string;
  title: string;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="sf-menu-host" ref={host}>
      <button
        type="button"
        className={`${className}${open ? " active" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div className={`sb-menu sf-menu sf-menu-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" role="menuitem" className="sb-menu-item" onClick={onClick}>
      <span className="sb-menu-label">
        {icon}
        {label}
      </span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

/** Rename, fork, hand off and the rest: things you do to the thread, not look at. */
function ThreadMenu() {
  return (
    <MenuButton
      button={<Ellipsis size={15} />}
      className="icon-button sf-thread-more"
      title="Thread actions"
      align="start"
    >
      {(close) => (
        <>
          <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={close} />
          <MenuItem icon={<GitFork size={14} />} label="Fork from here" onClick={close} />
          <MenuItem icon={<RotateCcw size={14} />} label="Reload session" onClick={close} />
          <div className="sb-menu-separator" />
          <MenuItem icon={<MonitorUp size={14} />} label="Hand off to…" onClick={close} />
          <MenuItem icon={<FolderOpen size={14} />} label="Open in editor" onClick={close} />
          <MenuItem icon={<Check size={14} />} label="Settle" onClick={close} />
        </>
      )}
    </MenuButton>
  );
}

function Checks() {
  const errors = 1;
  const warnings = 3;
  const title = `${plural(errors, "error")} · ${plural(warnings, "warning")} · 25 suggestions`;
  return (
    <button type="button" className="sf-checks" title={title} aria-label={title}>
      {!errors && !warnings ? (
        <CheckCircle2 size={15} className="sf-ok" />
      ) : (
        <>
          <span className="sf-count error">
            <AlertCircle size={14} />
            {errors}
          </span>
          <span className="sf-count warning">
            <AlertTriangle size={14} />
            {warnings}
          </span>
        </>
      )}
    </button>
  );
}

/** Idle: a Git glyph that opens the menu. Something to do: the one verb that matters. */
function Git({ state }: { state: GitState }) {
  if (state === "clean")
    return (
      <button type="button" className="sf-icon" title="Git actions" aria-label="Git actions">
        <GitBranch size={14} />
        <ChevronDown size={11} className="sf-caret" />
      </button>
    );
  const label = state === "dirty" ? "Commit" : "Push";
  const Icon = state === "dirty" ? GitCommitHorizontal : ArrowUp;
  return (
    <div className="git-actions">
      <button type="button" className="git-actions-main" title={state === "ahead" ? "Push 2 commits" : "Commit 3 files"}>
        <Icon size={14} />
        <span className="git-actions-label">{label}</span>
        {state === "ahead" && <span className="git-actions-ahead">2</span>}
      </button>
      <button type="button" className="git-actions-more" aria-label="More Git actions">
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

function Stat({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="pane-toggle-stat">
      <span className="pane-toggle-add">+{lines.additions}</span>
      <span className="pane-toggle-del">−{lines.deletions}</span>
    </span>
  );
}

function Toggle({
  id,
  active,
  label,
  stat,
  onClick,
}: {
  id: Surface;
  active: boolean;
  label: boolean;
  stat: boolean;
  onClick: () => void;
}) {
  const s = surface(id);
  return (
    <button
      type="button"
      className={`pane-toggle ${active ? "active" : ""}`}
      aria-pressed={active}
      aria-label={s.label}
      title={`${active ? "Hide" : "Show"} ${s.label.toLowerCase()} · ${s.key}`}
      onClick={onClick}
    >
      {s.icon}
      {label && <span className="pane-toggle-label">{s.label}</span>}
      <Stat show={stat} />
    </button>
  );
}

function Brand() {
  return (
    <div className="project-titlebar-brand">
      <span className="traffic-space sf-traffic">
        <i />
        <i />
        <i />
      </span>
      <button type="button" className="icon-button" aria-label="Hide sidebar">
        <PanelLeft size={16} />
      </button>
      <RelayMark size={38} />
    </div>
  );
}

function Title() {
  return (
    <div className="project-window-title">
      <a className="ci-trigger" href="#" aria-label="CI passing on main" onClick={(e) => e.preventDefault()}>
        <span className="sb-project-badge" style={{ "--hue": 250 } as CSSProperties}>
          R
        </span>
        <span className="sb-status ci-dot" data-state="success">
          <i />
        </span>
      </a>
      <span>relay</span>
      <span className="breadcrumb-slash">/</span>
      <strong>{openChat.title}</strong>
      <ThreadMenu />
    </div>
  );
}

/** D: two buttons, one per panel. Lit while that panel is open. */
function Layouts({
  right,
  bottom,
  onRight,
  onBottom,
}: {
  right: boolean;
  bottom: boolean;
  onRight: () => void;
  onBottom: () => void;
}) {
  return (
    <div className="sf-layouts" role="toolbar" aria-label="Panels">
      <button
        type="button"
        className={`icon-button sf-layout${bottom ? " open" : ""}`}
        aria-pressed={bottom}
        aria-label="Panel below"
        title={`${bottom ? "Hide" : "Show"} the panel below · ⌘J`}
        onClick={onBottom}
      >
        <PanelBottom size={16} />
      </button>
      <button
        type="button"
        className={`icon-button sf-layout${right ? " open" : ""}`}
        aria-pressed={right}
        aria-label="Panel beside"
        title={`${right ? "Hide" : "Show"} the panel beside · ⌘\\`}
        onClick={onRight}
      >
        <PanelRight size={16} />
      </button>
    </div>
  );
}

function Header({
  variant,
  git,
  open,
  onToggle,
  work,
  onWork,
  panels,
}: {
  variant: Variant;
  git: GitState;
  open: Record<Surface, boolean>;
  onToggle: (id: Surface) => void;
  work: boolean;
  onWork: () => void;
  panels: { right: boolean; bottom: boolean; onRight: () => void; onBottom: () => void };
}) {
  const dirty = git === "dirty";
  const closed = EXTRAS.filter((id) => !open[id]);
  return (
    <header className={`titlebar project-titlebar sf-header sf-${variant}`}>
      <Brand />
      <div className="project-titlebar-main">
        <Title />
        <span className="spacer" />
        <div className="thread-header-actions">
          <Checks />
          {variant !== "d" && <Git state={git} />}
          {variant === "d" && <Layouts {...panels} />}
          {variant === "a" && (
            <div className="header-strip">
              <div className="pane-toggles">
                {PINNED.map((id) => (
                  <Toggle
                    key={id}
                    id={id}
                    active={open[id]}
                    label
                    stat={id === "changes" && dirty}
                    onClick={() => onToggle(id)}
                  />
                ))}
                {EXTRAS.filter((id) => open[id]).map((id) => (
                  <Toggle key={id} id={id} active label stat={false} onClick={() => onToggle(id)} />
                ))}
              </div>
              {closed.length > 0 && (
                <>
                  <span className="header-strip-sep" aria-hidden />
                  <MenuButton button={<Plus size={14} />} className="pane-toggle sf-add" title="Open a surface">
                    {(close) => (
                      <>
                        <div className="sb-menu-heading">Open</div>
                        {closed.map((id) => (
                          <MenuItem
                            key={id}
                            icon={surface(id).icon}
                            label={surface(id).label}
                            hint={surface(id).key}
                            onClick={() => {
                              onToggle(id);
                              close();
                            }}
                          />
                        ))}
                      </>
                    )}
                  </MenuButton>
                </>
              )}
            </div>
          )}
          {variant === "c" && (
            <button
              type="button"
              className={`icon-button sf-work-toggle ${work ? "active" : ""}`}
              aria-pressed={work}
              title={`${work ? "Hide" : "Show"} the work pane · ⌘\\`}
              aria-label="Work pane"
              onClick={onWork}
            >
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function Rail({
  open,
  dirty,
  onToggle,
}: {
  open: Record<Surface, boolean>;
  dirty: boolean;
  onToggle: (id: Surface) => void;
}) {
  return (
    <nav className="sf-rail" aria-label="Surfaces">
      {SURFACES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`sf-rail-button ${open[s.id] ? "active" : ""}`}
          aria-pressed={open[s.id]}
          aria-label={s.label}
          title={`${s.label} · ${s.key}`}
          onClick={() => onToggle(s.id)}
        >
          {s.icon}
          {s.id === "changes" && dirty && (
            <span className="sf-rail-stat">
              <span className="pane-toggle-add">+{lines.additions}</span>
              <span className="pane-toggle-del">−{lines.deletions}</span>
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

function Chat({ onChanges }: { onChanges: () => void }) {
  const scroll = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState(0);
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDock(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dock]);
  const message = (m: ChatMessage) => (
    <Message
      key={m.id}
      message={m}
      chatId=""
      onReply={() => {}}
      onFork={() => {}}
      onChanges={onChanges}
      onTurnDiff={onChanges}
      onRewind={async () => ({ conflicts: [] })}
      projectRoot={projectRoot}
      onOpenFile={() => {}}
    />
  );
  return (
    <section
      className="project-chat"
      aria-label="Project chat"
      style={{ "--composer-dock-height": `${dock}px` } as CSSProperties}
    >
      <div className="project-messages" ref={scroll}>
        <div className="thread-message-column">{messages.map(message)}</div>
      </div>
      <div className="thread-bottom-composer" ref={dockRef}>
        <div className="thread-compose-wrap">
          <ProjectComposer
            projectId="relay"
            keys={{ draft: "preview-draft:sf", settings: "new:sf" }}
            conversation={{ running: false, busy: false }}
            onSend={async () => false}
            onStop={() => {}}
            onCommand={() => false}
          />
        </div>
      </div>
    </section>
  );
}

function PaneHead({ id, onClose, children }: { id: Surface; onClose?: () => void; children?: ReactNode }) {
  const s = surface(id);
  return (
    <div className="pane-header">
      <div className="pane-header-title">
        {s.icon}
        <strong>{s.label}</strong>
        {children}
      </div>
      <div className="pane-header-actions">
        {onClose && (
          <button type="button" className="icon-button" aria-label={`Close ${s.label.toLowerCase()}`} title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function ChangesBody({ dirty }: { dirty: boolean }) {
  const [picked, setPicked] = useState(changedFiles[0]!.path);
  if (!dirty)
    return (
      <div className="sf-empty">
        <GitCompareArrows size={22} />
        <p>No local changes on relay/fix-flaky-worktrees-spec.</p>
      </div>
    );
  const file = changedFiles.find((f) => f.path === picked)!;
  return (
    <section className="local-changes" aria-label="Local changes">
      <div className="working-content">
        <aside className="working-sidebar">
          <div className="working-file-list">
            <section>
              <header>
                <button type="button" className="change-section-toggle" aria-expanded="true">
                  <ChevronRight size={12} />
                </button>
                <strong>Changes</strong>
                <span className="muted">{changedFiles.length}</span>
              </header>
              {changedFiles.map((f) => {
                const slash = f.path.lastIndexOf("/");
                return (
                  <div key={f.path} className={`working-file ${f.path === picked ? "selected" : ""}`}>
                    <input type="checkbox" defaultChecked aria-label={`Stage ${f.path}`} />
                    <button type="button" className="change-select" onClick={() => setPicked(f.path)}>
                      <span className="change-name modified">{f.path.slice(slash + 1)}</span>
                      <span className="change-dir">{f.path.slice(0, slash)}</span>
                    </button>
                  </div>
                );
              })}
            </section>
          </div>
          <div className="working-commit">
            <textarea placeholder="Commit message" defaultValue="Wait for git before announcing worktree changes" />
            <div className="sf-commit-row">
              <button type="button" className="primary">
                Commit 3 files
              </button>
              <small>
                +{lines.additions} −{lines.deletions}
              </small>
            </div>
          </div>
        </aside>
        <div className="working-review">
          <header>
            <strong>{file.path}</strong>
            <span>
              <span className="pane-toggle-add">+{file.additions}</span>{" "}
              <span className="pane-toggle-del">−{file.deletions}</span>
            </span>
          </header>
          <div className="working-diff">
            <pre className="sf-diff">
              {diff.map((l, i) => (
                <span key={i} className={`sf-diff-line ${l.kind}`}>
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
                  {l.text}
                </span>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilesBody() {
  return (
    <div className="sf-tree">
      {tree.map((n, i) => (
        <button
          key={i}
          type="button"
          className={`sf-tree-row ${n.name === "worktrees.ts" ? "selected" : ""}`}
          style={{ paddingLeft: 10 + n.depth * 16 }}
        >
          <span className="sf-tree-twist">
            {n.dir && <ChevronRight size={12} className={n.open ? "open" : ""} />}
          </span>
          <span className={n.dir ? "sf-tree-dir" : ""}>{n.name}</span>
        </button>
      ))}
    </div>
  );
}

function HistoryBody() {
  return (
    <div className="sf-commits">
      {commits.map((c) => (
        <button key={c.sha} type="button" className="sf-commit">
          <span className="sf-commit-title">{c.title}</span>
          <span className="sf-commit-meta">
            <code>{c.sha}</code> · {c.who} · {c.when}
          </span>
        </button>
      ))}
    </div>
  );
}

function TerminalBody() {
  return (
    <pre className="sf-term">
      {terminalLines.map((l, i) => (
        <span key={i}>{l || " "}</span>
      ))}
      <span className="sf-term-cursor" aria-hidden />
    </pre>
  );
}

function BrowserBody() {
  return (
    <div className="sf-browser">
      <div className="sf-browser-bar">
        <button type="button" className="icon-button" aria-label="Reload">
          <RotateCcw size={13} />
        </button>
        <span className="sf-browser-url">
          <span className="muted">http://</span>fix-flaky-worktrees-spec.relay.localhost:5177
        </span>
        <small className="muted">dev server · up 4 min</small>
      </div>
      <div className="sf-browser-page">
        <div className="sf-page-bar" />
        <div className="sf-page-cols">
          <div className="sf-page-side" />
          <div className="sf-page-main">
            <i />
            <i style={{ width: "60%" }} />
            <i style={{ width: "80%" }} />
            <i style={{ width: "45%" }} />
          </div>
        </div>
        <small>Sample page · the worktree's own dev server</small>
      </div>
    </div>
  );
}

function Body({ id, dirty }: { id: Surface; dirty: boolean }) {
  switch (id) {
    case "changes":
      return <ChangesBody dirty={dirty} />;
    case "files":
      return <FilesBody />;
    case "history":
      return <HistoryBody />;
    case "terminal":
      return <TerminalBody />;
    case "browser":
      return <BrowserBody />;
    default:
      return null;
  }
}

function Pane({ id, order, dirty, onClose, header }: { id: Surface; order: number; dirty: boolean; onClose: () => void; header?: ReactNode }) {
  return (
    <section className="workspace-pane sf-pane" data-pane={id} aria-label={surface(id).label} style={{ order, flexGrow: 1 }}>
      {header ?? <PaneHead id={id} onClose={onClose} />}
      <Body id={id} dirty={dirty} />
    </section>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="terminal-drawer" style={{ height: 200 }}>
      <header className="terminal-drawer-header">
        <span className="terminal-drawer-title">Terminal</span>
        <span className="terminal-drawer-cwd">~/code/relay/.worktrees/fix-flaky-worktrees-spec</span>
        <small className="terminal-drawer-where">worktree</small>
        <span className="spacer" />
        <button type="button" className="icon-button" aria-label="Close terminal" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="terminal-drawer-body">
        <TerminalBody />
      </div>
    </div>
  );
}

/** A panel's tab. Terminals can be open several times, so tabs have their own key and a number. */
type PanelTab = { key: string; id: Surface; n: number };
type PanelState = { tabs: PanelTab[]; front: string | "new" | null };

const tabLabel = (tab: PanelTab) => (tab.n > 1 ? `${surface(tab.id).label} ${tab.n}` : surface(tab.id).label);

/** One of D's panels: a picker while it has no tab in front, tabs and + otherwise. */
function usePanel(initial: Surface[]) {
  const [state, setState] = useState<PanelState>(() => {
    const tabs = initial.map((id) => ({ key: id, id, n: 1 }));
    return { tabs, front: tabs[tabs.length - 1]?.key ?? null };
  });
  const show = (id: Surface) =>
    setState((p) => {
      const had = p.tabs.find((t) => t.id === id);
      if (had && id !== "terminal") return { ...p, front: had.key };
      const n = p.tabs.filter((t) => t.id === id).length + 1;
      const tab = { key: `${id}-${n}`, id, n };
      return { tabs: [...p.tabs, tab], front: tab.key };
    });
  const close = (key: string) =>
    setState((p) => {
      const tabs = p.tabs.filter((x) => x.key !== key);
      return { tabs, front: p.front === key ? (tabs[tabs.length - 1]?.key ?? null) : p.front };
    });
  const add = () => setState((p) => ({ ...p, front: "new" }));
  const bring = (key: string) => setState((p) => ({ ...p, front: key }));
  const empty = state.tabs.length === 0;
  const frontTab = state.tabs.find((t) => t.key === state.front) ?? null;
  return { ...state, show, close, add, bring, empty, frontTab };
}

const EXTRA_PICK: { id: Surface; key: string }[] = [
  { id: "files", key: "F" },
  { id: "history", key: "H" },
  { id: "terminal", key: "T" },
  { id: "browser", key: "B" },
];
const PICK: { id: Surface; key: string }[] = [
  { id: "changes", key: "D" },
  { id: "files", key: "F" },
  { id: "history", key: "H" },
  { id: "terminal", key: "T" },
  { id: "browser", key: "B" },
];

function Picker({
  dirty,
  onPick,
  items = PICK,
}: {
  dirty: boolean;
  onPick: (id: Surface) => void;
  items?: typeof PICK;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      const hit = items.find((p) => p.key.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        onPick(hit.id);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onPick, items]);
  return (
    <div className="sf-picker">
      <h3>Open a surface</h3>
      <div className="sf-picker-list" role="menu">
        {items.map(({ id, key }) => (
          <button key={id} type="button" role="menuitem" className="sf-picker-item" onClick={() => onPick(id)}>
            {surface(id).icon}
            <span className="sf-picker-label">{surface(id).label}</span>
            {id === "changes" && dirty && (
              <span className="sf-picker-stat">
                <span className="pane-toggle-add">+{lines.additions}</span>
                <span className="pane-toggle-del">−{lines.deletions}</span>
              </span>
            )}
            <kbd>{key}</kbd>
          </button>
        ))}
        <button type="button" role="menuitem" className="sf-picker-item" disabled>
          <GitBranch size={14} />
          <span className="sf-picker-label">Pull request</span>
          <kbd>P</kbd>
        </button>
      </div>
    </div>
  );
}

const PANE_DRAG = "application/x-relay-pane";

/** A panel's head and body: tabs and + once something is open, the picker before. */
function PanelContent({
  where,
  panel,
  git,
  onClose,
  onMove,
  items,
  dragId,
  terminals,
}: {
  where: "right" | "bottom";
  panel: ReturnType<typeof usePanel>;
  git: GitState;
  onClose: () => void;
  onMove?: () => void;
  items?: typeof PICK;
  /** Set when the head drags the pane around like the app's own pane headers. */
  dragId?: PaneId;
  /** Terminals only: + opens another terminal instead of the picker. */
  terminals?: boolean;
}) {
  const dirty = git !== "clean";
  const front: Surface | null = panel.frontTab?.id ?? null;
  const picking = front === null;
  const drag = dragId
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent<HTMLElement>) => {
          e.dataTransfer.setData(PANE_DRAG, dragId);
          e.dataTransfer.effectAllowed = "move";
        },
      }
    : {};
  return (
    <>
      <div className="pane-header sf-tabs-head" {...drag}>
        <div className="sf-tabs" role="tablist">
          {panel.tabs.map((tab) => (
            <div key={tab.key} className={`sf-tab-host${panel.front === tab.key ? " active" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={panel.front === tab.key}
                className={`sf-tab ${panel.front === tab.key ? "active" : ""}`}
                onClick={() => panel.bring(tab.key)}
              >
                {surface(tab.id).icon}
                <span>{tabLabel(tab)}</span>
              </button>
              <button type="button" className="sf-tab-close" aria-label={`Close ${tabLabel(tab).toLowerCase()}`} title="Close" onClick={() => panel.close(tab.key)}>
                <X size={12} />
              </button>
            </div>
          ))}
          {!panel.empty && (
            <button
              type="button"
              className={`sf-tab sf-tab-add${picking ? " active" : ""}`}
              aria-label={terminals ? "New terminal" : "Open another surface"}
              title={terminals ? "New terminal" : "Open another surface"}
              onClick={terminals ? () => panel.show("terminal") : panel.add}
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        <div className="pane-header-actions">
          {front === "changes" && <Git state={git} />}
          <button type="button" className="icon-button" aria-label="Expand" title="Expand">
            <Maximize2 size={13} />
          </button>
          {onMove && (
            <button
              type="button"
              className="icon-button"
              aria-label={where === "right" ? "Move below the chat" : "Move beside the chat"}
              title={where === "right" ? "Move below the chat" : "Move beside the chat"}
              onClick={onMove}
            >
              {where === "right" ? <PanelBottom size={14} /> : <PanelRight size={14} />}
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Close panel" title="Close panel" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      {front === null ? <Picker dirty={dirty} onPick={panel.show} items={items} /> : <Body id={front} dirty={dirty} />}
    </>
  );
}

function Panel(props: {
  where: "right" | "bottom";
  panel: ReturnType<typeof usePanel>;
  git: GitState;
  onClose: () => void;
  onMove?: () => void;
  items?: typeof PICK;
  order?: number;
}) {
  const { where, panel, order = 1 } = props;
  const front = panel.frontTab?.id ?? "new";
  return (
    <section
      className={`workspace-pane sf-pane sf-work sf-panel-${where}`}
      data-pane={front}
      aria-label={where === "right" ? "Panel beside" : "Panel below"}
      style={where === "right" ? { order, flexGrow: 1 } : undefined}
    >
      <PanelContent {...props} />
    </section>
  );
}

function Sidebar() {
  return (
    <aside className="projects-sidebar">
      <ProjectSidebar
        projects={projects}
        showing={{ chatId: openChat.id }}
        onOpen={() => {}}
        onPickNew={() => {}}
        onNewScratch={() => {}}
        onSendDraft={() => {}}
        onAdd={() => {}}
        onSettings={() => {}}
        onAccount={() => {}}
        onInbox={() => {}}
      />
    </aside>
  );
}

/** Use the app's panel id so order and widths share its layout model. */
const PANEL: PaneId = "panel";

/** E: terminals under the panes, like the app's terminal drawer, with tabs and a height handle. */
function TerminalDock({
  dock,
  git,
  onClose,
}: {
  dock: ReturnType<typeof usePanel>;
  git: GitState;
  onClose: () => void;
}) {
  const [height, setHeight] = useState(240);
  const [dragging, setDragging] = useState(false);
  const grab = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY;
    const start = height;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: PointerEvent) => setHeight(Math.max(120, start + (startY - ev.clientY)));
    const up = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  return (
    <section className="workspace-pane sf-pane sf-work sf-dock" data-pane="terminal" aria-label="Terminal" style={{ height }}>
      <div
        className={`sf-dock-handle${dragging ? " dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        title="Drag to resize · double-click to reset"
        onPointerDown={grab}
        onDoubleClick={() => setHeight(240)}
      />
      <PanelContent where="bottom" panel={dock} git={git} onClose={onClose} terminals />
    </section>
  );
}

/** E: the app's real panes (toggle, drag to reorder, splitters) with the panel as the third. */
function WindowE({ git }: { git: GitState }) {
  const dirty = git !== "clean";
  const { layout, visible, setOpen, move, resize } = useWorkspacePanes("sf-e");
  const edge = usePanel([]);
  const dock = usePanel([]);
  const [dockOpen, setDockOpen] = useState(false);
  const toggleDock = () => {
    if (!dockOpen && dock.empty) dock.show("terminal");
    setDockOpen((o) => !o);
  };
  useEffect(() => {
    setOpen("changes", true);
  }, [setOpen]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleDock();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const toggle = (id: PaneId) => setOpen(id, !layout.open[id]);
  const ids: PaneId[] = layout.order.filter((id) => id === "chat" || id === "changes" || id === PANEL);
  const frame = (id: PaneId) => ({ ...paneFrame(layout, id), onResize: resize, onMove: move });
  const showChanges = () => setOpen("changes", true);
  return (
    <div className="sf-window project-app sf-e" style={{ "--sidebar-width": "250px" } as CSSProperties}>
      <header className="titlebar project-titlebar sf-header">
        <Brand />
        <div className="project-titlebar-main">
          <Title />
          <span className="spacer" />
          <div className="thread-header-actions">
            <Checks />
            <Git state={git} />
            <div className="header-strip">
              <PaneToggles
                onToggle={toggle}
                onMove={move}
                panes={ids.map((id) => ({
                  id,
                  open: layout.open[id],
                  disabled: layout.open[id] && visible.length === 1,
                  ...(id === "chat"
                    ? { label: "Chat", icon: <MessageSquare size={14} /> }
                    : id === "changes"
                      ? { label: "Changes", icon: <GitCompareArrows size={14} />, stat: dirty ? lines : undefined }
                      : { label: "Panel", icon: <PanelRight size={14} /> }),
                }))}
              />
              <span className="header-strip-sep" aria-hidden="true" />
              <button
                type="button"
                className={`pane-toggle ${dockOpen ? "active" : ""}`}
                aria-label="Terminal"
                aria-pressed={dockOpen}
                title={`${dockOpen ? "Hide" : "Show"} terminal (⌘J)`}
                onClick={toggleDock}
              >
                <PanelBottom size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>
      <div className="project-layout">
        <Sidebar />
        <div className="workspace-column">
          <div className="workspace-panes">
            <RealPane id="chat" label="Chat" {...frame("chat")}>
              <Chat onChanges={showChanges} />
            </RealPane>
            <RealPane id="changes" label="Changes" {...frame("changes")}>
              <PaneHeader id="changes" icon={<GitCompareArrows size={14} />} title="Changes" onClose={() => toggle("changes")} closeDisabled={visible.length === 1} />
              <ChangesBody dirty={dirty} />
            </RealPane>
            <RealPane id={PANEL} label="Panel" className="sf-work" {...frame(PANEL)}>
              <PanelContent where="right" panel={edge} git={git} onClose={() => toggle(PANEL)} items={EXTRA_PICK} dragId={PANEL} />
            </RealPane>
          </div>
          {dockOpen && <TerminalDock dock={dock} git={git} onClose={() => setDockOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

function App() {
  const asked = new URLSearchParams(location.search).get("v");
  const [variant, setVariant] = useState<Variant>(
    asked === "a" || asked === "b" || asked === "c" || asked === "d" ? asked : "e",
  );
  const [git, setGit] = useState<GitState>("dirty");
  const [open, setOpen] = useState<Record<Surface, boolean>>({
    chat: true,
    changes: true,
    files: false,
    history: false,
    terminal: false,
    browser: false,
  });
  const [work, setWork] = useState(true);
  const [tab, setTab] = useState<Surface>("changes");
  // D: a panel beside the chat and one below it, each with its own tabs.
  const right = usePanel(["changes"]);
  const bottom = usePanel([]);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const show = (id: Surface) => {
    right.show(id);
    setRightOpen(true);
  };
  // Moving hands the front tab to the other panel.
  const moveFrom = (from: ReturnType<typeof usePanel>, to: ReturnType<typeof usePanel>, openTo: () => void) => {
    const tab = from.frontTab;
    if (tab) {
      from.close(tab.key);
      to.show(tab.id);
    }
    openTo();
  };
  const toggle = (id: Surface) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      if (!PANES.some((p) => next[p]) && !next.chat) return o;
      return next;
    });
  const pick = (id: Surface) => {
    setTab(id);
    setWork(true);
  };
  const dirty = git !== "clean";
  const about = variants.find((v) => v.id === variant)!.about;

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Surfaces</strong>
        <span className="preview-tag">Preview · sample data</span>
        <Segmented
          label="Variant"
          value={variant}
          options={variants.map((v) => ({ id: v.id, label: v.label }))}
          onChange={setVariant}
        />
        <Segmented
          label="Git"
          value={git}
          options={[
            { id: "clean", label: "Clean" },
            { id: "dirty", label: "Uncommitted" },
            { id: "ahead", label: "Commits to push" },
          ]}
          onChange={setGit}
        />
        <p className="sf-about">{about}</p>
      </div>
      {variant === "e" && <WindowE git={git} />}
      {variant !== "e" && (
      <div className="sf-window project-app" style={{ "--sidebar-width": "250px" } as CSSProperties}>
        <Header
          variant={variant}
          git={git}
          open={open}
          onToggle={toggle}
          work={work}
          onWork={() => setWork((w) => !w)}
          panels={{
            right: rightOpen,
            bottom: bottomOpen,
            onRight: () => setRightOpen((o) => !o),
            onBottom: () => setBottomOpen((o) => !o),
          }}
        />
        <div className="project-layout">
          <Sidebar />
          <div className="workspace-column">
            <div className="workspace-panes">
              {(variant === "c" || variant === "d" || open.chat) && (
                <section className="workspace-pane" data-pane="chat" aria-label="Chat" style={{ order: 0, flexGrow: 1.25 }}>
                  <Chat onChanges={() => (variant === "d" ? show("changes") : variant === "c" ? pick("changes") : toggle("changes"))} />
                </section>
              )}
              {variant === "d" && rightOpen && (
                <Panel
                  where="right"
                  panel={right}
                  git={git}
                  onClose={() => setRightOpen(false)}
                  onMove={() => {
                    moveFrom(right, bottom, () => setBottomOpen(true));
                    if (right.tabs.length <= 1) setRightOpen(false);
                  }}
                />
              )}
              {variant !== "c" &&
                variant !== "d" &&
                PANES.filter((p) => open[p]).map((p, i) => (
                  <Pane key={p} id={p} order={i + 1} dirty={dirty} onClose={() => toggle(p)} />
                ))}
              {variant === "c" && work && (
                <section className="workspace-pane sf-pane sf-work" data-pane={tab} aria-label="Work" style={{ order: 1, flexGrow: 1 }}>
                  <div className="pane-header sf-tabs-head">
                    <div className="sf-tabs" role="tablist">
                      {TABS.map((id) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={tab === id}
                          className={`sf-tab ${tab === id ? "active" : ""}`}
                          title={`${surface(id).label} · ${surface(id).key}`}
                          onClick={() => pick(id)}
                        >
                          {surface(id).icon}
                          <span>{surface(id).label}</span>
                          {id === "changes" && <Stat show={dirty} />}
                        </button>
                      ))}
                    </div>
                    <div className="pane-header-actions">
                      <button type="button" className="icon-button" aria-label="Hide the work pane" title="Hide · ⌘\" onClick={() => setWork(false)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <Body id={tab} dirty={dirty} />
                </section>
              )}
            </div>
            {variant === "a" && open.terminal && <Drawer onClose={() => toggle("terminal")} />}
            {variant === "b" && open.terminal && <Drawer onClose={() => toggle("terminal")} />}
            {variant === "d" && bottomOpen && (
              <Panel
                where="bottom"
                panel={bottom}
                git={git}
                onClose={() => setBottomOpen(false)}
                onMove={() => {
                  moveFrom(bottom, right, () => setRightOpen(true));
                  if (bottom.tabs.length <= 1) setBottomOpen(false);
                }}
              />
            )}
          </div>
          {variant === "b" && <Rail open={open} dirty={dirty} onToggle={toggle} />}
        </div>
      </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
