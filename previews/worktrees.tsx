// A Workspace menu next to the branch picker: a thread works in the current
// checkout or in a new worktree. Sample data, the app's own styles.
// Open http://127.0.0.1:5177/previews/worktrees.html
import "./desktop-stub";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowUp,
  Check,
  GitMerge,
  ArrowUpRight,
  ChevronDown,
  Eye,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Globe,
  LockKeyhole,
  Plus,
  RotateCw,
  ScanSearch,
  Search,
  Square,
  TriangleAlert,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/sidebar.css";
import "../src/components/running-tasks.css";
import "../src/components/waiting-strip.css";
import "./worktrees.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { Spinner } from "../src/components/ui";
import { ProviderIcon } from "../src/components/ComposerModelPicker";

initAppearance();
initWindowFocus();

type Workspace = "checkout" | "worktree";
type Outcome = "clean" | "conflict";
/** Ways the work lands without Relay's menu, faked from the preview bar. */
type Outside = "terminal" | "gitea";

interface Exchange {
  ask: string;
  answer: string;
}
interface Thread {
  id: string;
  title: string;
  workspace: Workspace;
  running: boolean;
  age: string;
  exchanges: Exchange[];
  /** Files the worktree changed that aren't in the checkout yet. */
  files?: number;
  conflict?: boolean;
  /** Rebased after a conflict, so the next apply goes through. */
  rebased?: boolean;
  branch?: string;
  pr?: number;
  /** The worktree's work reached the checkout, however it got there. */
  landed?: string;
  removed?: boolean;
}
interface Task {
  id: string;
  title: string;
  port?: number;
  thread?: string;
  age: string;
}

const initialThreads: Thread[] = [
  {
    id: "t-split",
    title: "Split project-chats.ts into modules",
    workspace: "worktree",
    running: false,
    age: "12m",
    files: 6,
    branch: "relay/split-project-chats",
    exchanges: [
      {
        ask: "project-chats.ts is 2k lines. Split it into a store, the turn runner and sharing, no behaviour change.",
        answer:
          "Split `electron/project-chats.ts` into `chat-store.ts`, `turns.ts` and `sharing.ts`. Typecheck and the chat tests pass.\n\nThe dev server on :5177 serves your checkout, not this worktree, so I started one on **:5178** to check the sidebar still loads.",
      },
    ],
  },
  {
    id: "t-updater",
    title: "Check the updater's restart states",
    workspace: "checkout",
    running: true,
    age: "now",
    exchanges: [
      {
        ask: "The updater test flakes on restart. Check it by the states it emits.",
        answer: "",
      },
    ],
  },
  {
    id: "t-fork",
    title: "Fork a thread at an agent's answer",
    workspace: "checkout",
    running: false,
    age: "2h",
    exchanges: [
      {
        ask: "Let me fork a thread from any agent answer.",
        answer: "Added **Fork from here** under each answer.",
      },
    ],
  },
  {
    id: "t-note",
    title: "Skip the prompt note when the scan is slow",
    workspace: "checkout",
    running: false,
    age: "1d",
    exchanges: [
      {
        ask: "The running-process note delays the first token. Skip it when the scan is slow.",
        answer: "The note now gives up after 400 ms.",
      },
    ],
  },
];

const initialTasks: Task[] = [
  { id: "vite", title: "Vite dev server", port: 5177, age: "3h 12m" },
  { id: "vitest", title: "Vitest watch", thread: "t-updater", age: "4m" },
  {
    id: "vite-split",
    title: "Vite dev server",
    port: 5178,
    thread: "t-split",
    age: "11m",
  },
];

const workspaces: Record<Workspace, { label: string; icon: typeof Folder }> = {
  checkout: { label: "Current checkout", icon: Folder },
  worktree: { label: "New worktree", icon: FolderGit2 },
};

function App() {
  const appearance = useAppearance();
  const [outcome, setOutcome] = useState<Outcome>("clean");
  const [outside, setOutside] = useState<{ kind: Outside; n: number }>();
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Worktrees</strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Merging goes</span>
          <Segmented<Outcome>
            label="Merging goes"
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: "clean", label: "Clean" },
              { value: "conflict", label: "Into a conflict" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Outside Relay</span>
          <button
            type="button"
            className="preview-action"
            onClick={() => setOutside({ kind: "terminal", n: Date.now() })}
          >
            Merge it from a terminal
          </button>
          <button
            type="button"
            className="preview-action"
            onClick={() => setOutside({ kind: "gitea", n: Date.now() })}
          >
            Merge the PR on Gitea
          </button>
        </div>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <Shell outcome={outcome} outside={outside} />
    </div>
  );
}

function Shell({
  outcome,
  outside,
}: {
  outcome: Outcome;
  outside?: { kind: Outside; n: number };
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [tasks, setTasks] = useState(initialTasks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("checkout");
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  const later = (ms: number, fn: () => void) =>
    timers.current.push(setTimeout(fn, ms));
  const patch = (id: string, fn: (t: Thread) => Partial<Thread>) =>
    setThreads((all) => all.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)));
  const thread = threads.find((t) => t.id === openId);
  const target =
    thread?.workspace === "worktree"
      ? thread
      : threads.find((t) => t.workspace === "worktree" && !t.landed);

  // What Relay would notice on its next look at git or Gitea.
  useEffect(() => {
    if (!outside || !target) return;
    if (outside.kind === "gitea" && !target.pr) {
      setToast("Create a PR from the Worktree menu first");
      return;
    }
    if (outside.kind === "terminal" && target.running) {
      setToast("Wait for Claude to finish");
      return;
    }
    setOpenId(target.id);
    patch(target.id, () => ({
      landed:
        outside.kind === "gitea"
          ? `Merged into main through PR #${target.pr}`
          : "Merged into main outside Relay",
      conflict: false,
    }));
  }, [outside?.n]);

  /** A fake agent turn: works for a moment, then answers. */
  const run = (id: string, ask: string, answer: string) => {
    patch(id, (t) => ({
      running: true,
      age: "now",
      conflict: false,
      exchanges: [...t.exchanges, { ask, answer: "" }],
    }));
    later(2200, () =>
      patch(id, (t) => ({
        running: false,
        files: t.workspace === "worktree" ? (t.files ?? 0) + 2 : undefined,
        branch:
          t.workspace === "worktree"
            ? (t.branch ?? `relay/${slugOf(t.title)}`)
            : undefined,
        landed: undefined,
        removed: false,
        exchanges: t.exchanges.map((x, i) =>
          i === t.exchanges.length - 1 ? { ...x, answer } : x,
        ),
      })),
    );
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    const answer = "Done.";
    if (thread) return run(thread.id, body, answer);
    const id = `t-${Date.now()}`;
    setThreads((all) => [
      {
        id,
        title: body.length > 44 ? `${body.slice(0, 44)}…` : body,
        workspace,
        running: false,
        age: "now",
        exchanges: [],
      },
      ...all,
    ]);
    setOpenId(id);
    run(id, body, answer);
  };

  const apply = (t: Thread) => {
    if (outcome === "conflict" && !t.rebased) {
      patch(t.id, () => ({ conflict: true }));
      return;
    }
    patch(t.id, () => ({
      landed: "Merged into main, uncommitted",
      conflict: false,
    }));
  };

  const createPr = (t: Thread) => {
    setToast(`Opens the PR form for ${t.branch}, as the PR button does today`);
    patch(t.id, () => ({ pr: 14 }));
  };

  const remove = (t: Thread) => {
    patch(t.id, () => ({ removed: true, files: 0 }));
    setTasks((all) => all.filter((task) => task.thread !== t.id));
  };

  return (
    <>
      <div className="wt-shell">
        <aside className="projects-sidebar" aria-label="Projects">
          <div className="sb">
            <div className="sb-top">
              <div className="sb-search">
                <Search size={13} />
                <input aria-label="Search threads" placeholder="Search" />
              </div>
            </div>
            <div className="wt-sb-scroll">
              <section className="sb-project current">
                <div className="sb-project-row">
                  <span className="sb-project-expand">
                    <FolderOpen size={14} />
                  </span>
                  <span className="sb-project-name">
                    <span>relay</span>
                  </span>
                  <div className="sb-row-actions wt-always">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="New thread in relay"
                      title="New thread"
                      onClick={() => {
                        setOpenId(null);
                        setWorkspace("checkout");
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="sb-thread-list">
                  {threads.map((t) => (
                    <div key={t.id} className="sb-thread-row">
                      <button
                        className={`sb-thread ${openId === t.id ? "selected" : ""}`}
                        title={t.title}
                        onClick={() => setOpenId(t.id)}
                      >
                        <span className="sb-thread-title">{t.title}</span>
                        {t.running ? (
                          <span className="sb-status running" title="Working">
                            <Spinner size={11} />
                          </span>
                        ) : (
                          <time className="sb-age">{t.age}</time>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </aside>
        <main className="wt-main">
          <div className="wt-titlebar">
            <FolderGit2 size={14} />
            <span className="muted">relay</span>
            <span className="muted">/</span>
            <strong>{thread?.title ?? "New thread"}</strong>
          </div>
          <div className="project-chat-pane wt-chat-pane">
            {thread ? (
              <ThreadView
                key={thread.id}
                thread={thread}
                draft={draft}
                onDraft={setDraft}
                onSend={send}
                onApply={() => apply(thread)}
                onCreatePr={() => createPr(thread)}
                onRemove={() => remove(thread)}
                onFix={() => {
                  patch(thread.id, () => ({ rebased: true }));
                  run(
                    thread.id,
                    "Your checkout changed under this worktree. Rebase onto it and fix the conflicts.",
                    "Rebased onto your checkout. `project-chats.ts` had your new fork code next to my split; I moved it into `turns.ts`. `main.ts` only needed both imports.",
                  );
                }}
                onDismiss={() => patch(thread.id, () => ({ conflict: false }))}
                onToast={setToast}
              />
            ) : (
              <NewThread
                workspace={workspace}
                onWorkspace={setWorkspace}
                draft={draft}
                onDraft={setDraft}
                onSend={send}
              />
            )}
            <Running
              tasks={tasks}
              threads={threads}
              onOpen={(id) => setOpenId(id)}
            />
          </div>
        </main>
      </div>
      {toast && (
        <div className="toast wt-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

function NewThread({
  workspace,
  onWorkspace,
  draft,
  onDraft,
  onSend,
}: {
  workspace: Workspace;
  onWorkspace: (w: Workspace) => void;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="project-chat empty-thread">
      <div className="thread-subheader">
        <span className="thread-privacy">
          <LockKeyhole size={13} /> Private thread
        </span>
      </div>
      <div className="thread-start">
        <div className="thread-introduction">
          <h1>What should we work on in relay?</h1>
          <p>Understand the code, work on an idea, or review your changes.</p>
        </div>
        <div className="thread-compose-wrap">
          <div className="thread-context-controls">
            <button className="thread-context-button selected">
              <FolderGit2 size={14} /> Repository
            </button>
            <button className="thread-context-button">
              <GitPullRequest size={14} /> Review a PR <ChevronDown size={12} />
            </button>
            <button className="thread-context-button">
              <ScanSearch size={14} /> Deep review
            </button>
            <WorkspacePicker value={workspace} onChange={onWorkspace} />
            <BranchButton />
          </div>
          <Composer draft={draft} onDraft={onDraft} onSend={onSend} />
        </div>
      </div>
    </section>
  );
}

/** Before the first message: where the thread will work. */
function WorkspacePicker({
  value,
  onChange,
}: {
  value: Workspace;
  onChange: (w: Workspace) => void;
}) {
  const Icon = workspaces[value].icon;
  return (
    <Menu.Root>
      <Menu.Trigger className="composer-branch-trigger wt-workspace-trigger">
        <Icon size={13} />
        <span>{workspaces[value].label}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="sb-menu-positioner"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="sb-menu">
            <div className="sb-menu-heading">Workspace</div>
            {(Object.keys(workspaces) as Workspace[]).map((w) => {
              const ItemIcon = workspaces[w].icon;
              return (
                <Menu.Item
                  key={w}
                  className="sb-menu-item"
                  onClick={() => onChange(w)}
                >
                  <span className="sb-menu-label">
                    <ItemIcon size={14} />
                    {workspaces[w].label}
                  </span>
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** After the first message the place is fixed; a worktree's menu is how it lands. */
function WorktreeMenu({
  thread,
  onApply,
  onCreatePr,
  onRemove,
  onToast,
}: {
  thread: Thread;
  onApply: () => void;
  onCreatePr: () => void;
  onRemove: () => void;
  onToast: (text: string) => void;
}) {
  if (thread.workspace === "checkout")
    return (
      <span className="composer-branch-trigger wt-workspace-trigger wt-static">
        <Folder size={13} />
        <span>Current checkout</span>
      </span>
    );
  if (thread.removed)
    return (
      <span
        className="composer-branch-trigger wt-workspace-trigger wt-static"
        title="The next message makes it again from its branch"
      >
        <FolderGit2 size={13} />
        <span>Worktree removed</span>
      </span>
    );
  const files = thread.files ?? 0;
  const busy = thread.running;
  return (
    <Menu.Root>
      <Menu.Trigger className="composer-branch-trigger wt-workspace-trigger">
        <FolderGit2 size={13} />
        <span>Worktree</span>
        {thread.landed ? (
          <Check size={12} className="wt-landed-mark" aria-label="Merged" />
        ) : (
          files > 0 && !busy && <i className="wt-dot" aria-hidden />
        )}
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="sb-menu-positioner"
          side="top"
          align="start"
          sideOffset={6}
        >
          <Menu.Popup className="sb-menu wt-menu">
            <div className="sb-menu-heading wt-menu-heading">
              <span>{thread.branch}</span>
              {thread.landed ? (
                <small>merged</small>
              ) : thread.pr ? (
                <small>PR #{thread.pr} open</small>
              ) : (
                files > 0 && <small>{files} files changed</small>
              )}
            </div>
            {!thread.landed && (
              <>
                <Menu.Item
                  className="sb-menu-item"
                  disabled={busy || !files}
                  onClick={onApply}
                >
                  <span className="sb-menu-label">
                    <GitMerge size={14} /> Merge into current checkout
                  </span>
                </Menu.Item>
                {thread.pr ? (
                  <Menu.Item
                    className="sb-menu-item"
                    onClick={() => onToast(`Opens PR #${thread.pr} in the review`)}
                  >
                    <span className="sb-menu-label">
                      <GitPullRequest size={14} /> View PR #{thread.pr}
                    </span>
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    className="sb-menu-item"
                    disabled={busy || !files}
                    onClick={onCreatePr}
                  >
                    <span className="sb-menu-label">
                      <GitPullRequest size={14} /> Create PR
                    </span>
                  </Menu.Item>
                )}
                <Menu.Separator className="sb-menu-separator" />
              </>
            )}
            <Menu.Item
              className="sb-menu-item"
              onClick={() => onToast("Opens the worktree's diff in Changes")}
            >
              <span className="sb-menu-label">Show changes</span>
            </Menu.Item>
            <Menu.Item
              className="sb-menu-item"
              onClick={() => onToast("Opens the worktree folder in Finder")}
            >
              <span className="sb-menu-label">Open in Finder</span>
            </Menu.Item>
            <Menu.Separator className="sb-menu-separator" />
            <Menu.Item
              className="sb-menu-item"
              disabled={busy}
              onClick={() => {
                if (thread.landed) onRemove();
                else
                  onToast(
                    "Asks first: the worktree has changes that aren't merged",
                  );
              }}
            >
              <span className="sb-menu-label">Remove worktree</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function BranchButton() {
  return (
    <button
      type="button"
      className="composer-branch-trigger wt-branch-trigger"
      title="The branch picker, as today"
    >
      <GitBranch size={13} />
      <span>main</span>
      <ChevronDown size={12} />
    </button>
  );
}

function ThreadView({
  thread,
  draft,
  onDraft,
  onSend,
  onApply,
  onCreatePr,
  onRemove,
  onFix,
  onDismiss,
  onToast,
}: {
  thread: Thread;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  onApply: () => void;
  onCreatePr: () => void;
  onRemove: () => void;
  onFix: () => void;
  onDismiss: () => void;
  onToast: (text: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [thread.exchanges.length, thread.running]);
  return (
    <section className="project-chat">
      <div className="thread-subheader">
        <span className="thread-privacy">
          <LockKeyhole size={13} /> Private thread
        </span>
      </div>
      <div className="project-messages" ref={scroll}>
        <div className="thread-message-column">
          {thread.exchanges.map((x, i) => (
            <div key={i}>
              <article className="project-message user">
                <header>
                  <strong>You</strong>
                </header>
                <div className="markdown">
                  <p>{x.ask}</p>
                </div>
              </article>
              <article className="project-message assistant">
                <header>
                  <strong>
                    <ProviderIcon provider="claude" /> Claude
                  </strong>
                </header>
                {i === thread.exchanges.length - 1 && thread.running ? (
                  <p className="wt-working">
                    <Spinner size={12} /> Working…
                  </p>
                ) : (
                  <div className="markdown">
                    {x.answer.split("\n\n").map((p, j) => (
                      <p key={j}>{renderInline(p)}</p>
                    ))}
                  </div>
                )}
              </article>
            </div>
          ))}
          {thread.landed && (
            <p className="wt-landed-line">
              <Check size={12} /> {thread.landed}
              {thread.removed ? " · worktree removed" : ""}
            </p>
          )}
        </div>
      </div>
      <div className="thread-bottom-composer">
        <div className="thread-compose-wrap">
          <div className="thread-context-controls">
            <WorktreeMenu
              thread={thread}
              onApply={onApply}
              onCreatePr={onCreatePr}
              onRemove={onRemove}
              onToast={onToast}
            />
            <BranchButton />
          </div>
          {thread.conflict && (
            <div className="waiting-strip stopped" role="status">
              <div className="waiting-strip-head">
                <TriangleAlert size={15} />
                <span className="waiting-strip-text">
                  <b>Couldn’t merge</b>
                  <span>
                    {" "}
                    · project-chats.ts and main.ts changed in your checkout
                  </span>
                </span>
                <button type="button" onClick={onDismiss}>
                  Dismiss
                </button>
                <button type="button" className="primary-action" onClick={onFix}>
                  Ask Claude to fix
                </button>
              </div>
            </div>
          )}
          <Composer
            draft={draft}
            onDraft={onDraft}
            onSend={onSend}
            disabled={thread.running}
          />
        </div>
      </div>
    </section>
  );
}

function Composer({
  draft,
  onDraft,
  onSend,
  disabled,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  return (
    <form
      className="project-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSend();
      }}
    >
      <textarea
        className="composer-prompt-input wt-textarea"
        aria-label="Message"
        placeholder="Ask about the code, plan a change, or build something…"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!disabled) onSend();
          }
        }}
      />
      <div className="composer-tools">
        <span className="wt-model">
          <ProviderIcon provider="claude" /> Opus 5.5
        </span>
        <span className="spacer" />
        <button
          type="submit"
          className="send-message"
          aria-label="Send"
          disabled={disabled || !draft.trim()}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </form>
  );
}

/** The Running corner as today; a worktree's processes just say so. */
function Running({
  tasks,
  threads,
  onOpen,
}: {
  tasks: Task[];
  threads: Thread[];
  onOpen: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (!tasks.length) return null;
  return (
    <aside
      className={`running-tasks ${collapsed ? "collapsed" : ""}`}
      aria-label="Running processes"
    >
      <button
        type="button"
        className="running-tasks-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="running-tasks-heading">Running</span>
        <span className="running-tasks-count">{tasks.length}</span>
        <span className="spacer" />
        <ChevronDown size={14} className="running-tasks-chevron" />
      </button>
      {!collapsed && (
        <ul className="running-tasks-list">
          {tasks.map((task) => {
            const Icon = task.port ? Globe : Eye;
            const chat = threads.find((c) => c.id === task.thread);
            const inWorktree = chat?.workspace === "worktree";
            return (
              <li
                key={task.id}
                title={inWorktree ? `In the worktree for ${chat.title}` : undefined}
              >
                <Icon size={15} className="running-task-icon" aria-hidden />
                <button
                  type="button"
                  className="running-task-title"
                  onClick={() => chat && onOpen(chat.id)}
                >
                  <span>{task.title}</span>
                  {task.port && <ArrowUpRight size={13} aria-hidden />}
                </button>
                {inWorktree && <small className="wt-task-where">worktree</small>}
                <span className="running-task-end">
                  <span className="running-task-time">{task.age}</span>
                  <span className="running-task-buttons">
                    <button type="button" aria-label={`Restart ${task.title}`}>
                      <RotateCw size={12} />
                    </button>
                    <button
                      type="button"
                      className="running-task-stop"
                      aria-label={`Stop ${task.title}`}
                    >
                      <Square size={9} fill="currentColor" />
                    </button>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

/** Just enough markdown for the sample answers: `code` and **bold**. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : part.startsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
