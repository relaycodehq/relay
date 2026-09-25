// The Relay window the teaser films: the app's own markup, styles and
// components (AgentTurn, RichText, ChangedFilesCard, WorkingDiff, ProviderIcon,
// RelayMark), driven by a WindowState instead of the desktop bridge.
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Files,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  GitPullRequest,
  LockKeyhole,
  MessageSquare,
  PanelBottom,
  Plus,
  ScanSearch,
  Search,
  Settings2,
  SquareTerminal,
  Telescope,
  Wrench,
  X,
} from "lucide-react";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import { ComposerModeControls } from "../src/components/ComposerModeControls";
import { AgentTurn } from "../src/components/AgentTurn";
import { ChangedFilesCard } from "../src/components/ChangedFilesCard";
import { WorkingDiff } from "../src/components/WorkingDiff";
import { RelayMark } from "../src/components/RelayMark";
import { FileEntryIcon, RichText, Spinner } from "../src/components/ui";
import type { AgentProvider } from "../shared/agents";
import {
  buildTurn,
  cards,
  changedFiles,
  findings,
  projectRoot,
  prompt,
  reviewScripts,
  shortcutsPair,
  terminalLines,
  turnAt,
  type CardData,
} from "./teaser-data";
import { EPOCH } from "./teaser-time";

export interface WindowState {
  t: number;
  view: "home" | "thread" | "review";
  draft: string;
  caret: boolean;
  /** 0..1 while the send button is pressed. */
  press: number;
  model: { provider: AgentProvider; name: string };
  /** How long the build turn has been running; null before it's sent. */
  turn: number | null;
  /** 0..1: the Changes pane sliding open beside the chat. */
  changes: number;
  /** 0..1 terminal drawer height, and how long its command has run. */
  terminal: number;
  terminalRun: number;
  /** Holding ⌘ shows the Activity slot numbers. */
  cmdHeld: boolean;
  /** Cards change state as the other threads move along. */
  splitWaiting: boolean;
  webDone: boolean;
  /** Deep review: ms since the reviewers started; the report shows after. */
  review: number;
  reportShown: number;
  /** A tiny scroll offset for the thread, px. */
  scroll: number;
}

const fmtTime = (at: number) =>
  new Date(EPOCH + at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

function elapsedLabel(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function AppWindow({
  state,
  style,
  accent,
  className = "",
}: {
  state: WindowState;
  style?: CSSProperties;
  /** The mark follows the window's own theme, not the document's. */
  accent?: string;
  className?: string;
}) {
  const threadTitle =
    state.view === "review"
      ? "Deep review · Uncommitted changes"
      : state.view === "thread"
        ? "Jump between threads with ⌘1–9"
        : null;
  const stat =
    state.turn !== null && state.turn > 3700 ? { add: 73, del: 5 } : null;
  return (
    <div className={`tz-window ${className}`} style={style}>
      <div className="app project-app platform-darwin">
        <header className="titlebar project-titlebar">
          <div className="project-titlebar-brand">
            <span className="traffic-space tz-traffic">
              <i />
              <i />
              <i />
            </span>
            <span className="relay-brand-toggle">
              <span className="relay-brand-mark">
                <RelayMark accent={accent} />
              </span>
              <strong>Relay</strong>
            </span>
          </div>
          <div className="project-window-title">
            <FolderGit2 size={14} />
            <span>relay</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{threadTitle ?? "New thread"}</strong>
          </div>
          <span className="spacer" />
          <div className="thread-header-actions">
            <div className="pane-toggles" role="group">
              <button type="button" className="pane-toggle active">
                <MessageSquare size={14} />
                <span>Chat</span>
              </button>
              <button
                type="button"
                className={`pane-toggle ${state.changes > 0 ? "active" : ""}`}
              >
                <GitCompareArrows size={14} />
                <span>Changes</span>
                {stat && (
                  <span className="pane-toggle-stat">
                    <span className="pane-toggle-add">+{stat.add}</span>
                    <span className="pane-toggle-del">−{stat.del}</span>
                  </span>
                )}
              </button>
              <button type="button" className="pane-toggle">
                <Files size={14} />
                <span>Files</span>
              </button>
            </div>
            <div className="pane-toggles">
              <button
                type="button"
                className={`pane-toggle ${state.terminal > 0 ? "active" : ""}`}
              >
                <PanelBottom size={14} />
              </button>
            </div>
          </div>
        </header>
        <div className="project-layout">
          <aside className="projects-sidebar">
            <Sidebar state={state} />
          </aside>
          <div className="workspace-column">
            <div className="workspace-panes">
              <section
                className="workspace-pane"
                data-pane="chat"
                style={{ flexGrow: 1 }}
              >
                {state.view === "home" ? (
                  <Home state={state} />
                ) : state.view === "thread" ? (
                  <BuildThread state={state} />
                ) : (
                  <ReviewThread state={state} />
                )}
              </section>
              {state.changes > 0 && state.view === "thread" && (
                <section
                  className="workspace-pane tz-changes"
                  style={{
                    flexGrow: 2.1 * state.changes,
                    minWidth: 0,
                    opacity: Math.min(1, state.changes * 2),
                  }}
                >
                  <div className="pane-splitter" />
                  <ChangesPane />
                </section>
              )}
            </div>
            {state.terminal > 0 && (
              <Terminal height={236 * state.terminal} run={state.terminalRun} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ state }: { state: WindowState }) {
  const own: CardData | null =
    state.view === "thread" && state.turn !== null
      ? {
          id: "own",
          project: "relay",
          title: "Jump between threads with ⌘1–9",
          branch: "main",
          provider: "claude",
          state:
            state.turn < buildTurn.answerAt + buildTurn.writeFor
              ? { kind: "running", since: state.t - state.turn }
              : { kind: "idle", age: "now" },
        }
      : state.view === "review"
        ? {
            id: "own",
            project: "relay",
            title: "Deep review · Uncommitted changes",
            branch: "main",
            provider: "claude",
            state: { kind: "running", since: state.t - state.review },
          }
        : null;
  const list = cards.map((c): CardData => {
    if (c.id === "split" && state.splitWaiting)
      return { ...c, state: { kind: "waiting" } };
    if (c.id === "web" && state.webDone)
      return { ...c, state: { kind: "unread", age: "now" } };
    return c;
  });
  const shown = own ? [own, ...list] : list;
  const open = shown.filter((c) => c.state.kind !== "idle").length;
  return (
    <div className="sb">
      <div className="sb-top">
        <div className="sb-search">
          <Search size={13} />
          <input placeholder="Search" readOnly tabIndex={-1} />
        </div>
        <button className="sb-top-button" tabIndex={-1}>
          <Plus size={16} />
        </button>
        <button className="sb-top-button sb-bell active" tabIndex={-1}>
          <Bell size={15} />
          {state.splitWaiting && <span className="sb-bell-count">1</span>}
        </button>
      </div>
      <div className="sb-scroll sb-activity">
        <div className="sb-view-heading">
          <h2>Activity</h2>
          <small>{open} open</small>
        </div>
        <div className={`sb-cards ${state.cmdHeld ? "shortcuts" : ""}`}>
          {shown.map((c, i) => (
            <Card
              key={c.id}
              card={c}
              t={state.t}
              selected={c.id === "own"}
              shortcut={state.cmdHeld ? i + 1 : undefined}
            />
          ))}
        </div>
        <section className="sb-shelf">
          <button className="sb-shelf-toggle" tabIndex={-1}>
            <span>Settled</span>
            <small>14</small>
            <ChevronRight size={13} />
          </button>
        </section>
      </div>
      <div className="sb-footer">
        <span className="sb-account">
          <span className="sb-avatar">YO</span>
          <span>you</span>
        </span>
        <span className="spacer" />
        <button className="icon-button" tabIndex={-1}>
          <Settings2 size={15} />
        </button>
      </div>
    </div>
  );
}

function Card({
  card: c,
  t,
  selected,
  shortcut,
}: {
  card: CardData;
  t: number;
  selected: boolean;
  shortcut?: number;
}) {
  const unread = c.state.kind === "unread";
  const waiting = c.state.kind === "waiting";
  return (
    <div
      className={[
        "sb-card",
        selected && "selected",
        unread && "unread",
        !selected && !unread && !waiting && "dim",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="sb-card-top">
        <span
          className="sb-project-badge"
          style={{ "--hue": projectHue(c.project) } as CSSProperties}
        >
          {c.project.slice(0, 1).toUpperCase()}
        </span>
        <span className="sb-card-name">
          <span className="sb-card-project">{c.project}</span>
          {shortcut && shortcut < 10 && (
            <kbd className="sb-card-shortcut">
              <span>⌘</span>
              {shortcut}
            </kbd>
          )}
        </span>
        {c.state.kind === "waiting" ? (
          <span className="sb-card-state waiting">
            <i />
            Needs input
          </span>
        ) : c.state.kind === "running" ? (
          <span className="sb-card-state running">
            <Spinner size={11} steady />
            Working
            <span className="sb-elapsed">
              {elapsedLabel(t - c.state.since)}
            </span>
          </span>
        ) : (
          <time className={`sb-card-state ${unread ? "unread" : ""}`}>
            {unread && <i />}
            {c.state.age}
          </time>
        )}
      </div>
      <div className="sb-card-title">{c.title}</div>
      <div className="sb-card-meta">
        {c.pr && (
          <span className="sb-card-scope">
            <GitPullRequest size={11} />#{c.pr}
          </span>
        )}
        <span className="sb-card-branch">{c.branch}</span>
        <span className="sb-card-provider">
          <ProviderIcon provider={c.provider} />
        </span>
      </div>
    </div>
  );
}

function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

const noop = () => {};

function Composer({
  state,
  placeholder,
  text,
}: {
  state: WindowState;
  placeholder: string;
  text: string;
}) {
  const running =
    state.turn !== null && state.turn < buildTurn.answerAt + buildTurn.writeFor;
  return (
    <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
      <div className="composer-prompt-input tz-prompt">
        {text ? (
          <span>{text}</span>
        ) : (
          <span className="tz-placeholder">{placeholder}</span>
        )}
        {state.caret && <i className="tz-caret" />}
      </div>
      <div className="composer-tools">
        <button
          type="button"
          className="composer-control composer-model-trigger"
        >
          <ProviderIcon provider={state.model.provider} />
          <span key={state.model.name} className="tz-model-name">
            {state.model.name}
          </span>
          <ChevronDown size={12} />
        </button>
        <span className="composer-divider" />
        <button type="button" className="composer-control">
          <span>High</span>
          <ChevronDown size={12} />
        </button>
        <ComposerModeControls
          runtimeMode="full-access"
          interactionMode="default"
          onRuntimeMode={noop}
          onInteractionMode={noop}
        />
        <span className="spacer" />
        {running && (
          <button type="button" className="composer-stop">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          </button>
        )}
        {!running && (
          <button
            type="button"
            className="primary send-message"
            disabled={!text}
            style={{ transform: `scale(${1 - 0.12 * state.press})` }}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </form>
  );
}

function Home({ state }: { state: WindowState }) {
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
            <span className="spacer" />
            <button className="composer-branch-trigger">
              <GitBranch size={13} />
              <span>main</span>
              <ChevronDown size={12} />
            </button>
          </div>
          <Composer
            state={state}
            text={state.draft}
            placeholder="Ask about the code, plan a change, or build something…"
          />
        </div>
      </div>
    </section>
  );
}

function Thread({
  children,
  scroll = 0,
  composer,
}: {
  children: ReactNode;
  scroll?: number;
  composer: ReactNode;
}) {
  return (
    <section className="project-chat">
      <div className="thread-subheader">
        <span className="thread-privacy">
          <LockKeyhole size={13} /> Private thread
        </span>
      </div>
      <div className="project-messages tz-messages">
        <div
          className="thread-message-column tz-column"
          style={{ transform: `translateY(${-scroll}px)` }}
        >
          {children}
        </div>
      </div>
      <div className="thread-bottom-composer">
        <div className="thread-compose-wrap">{composer}</div>
      </div>
    </section>
  );
}

function BuildThread({ state }: { state: WindowState }) {
  const elapsed = state.turn ?? 0;
  const message = turnAt(
    "build",
    "claude",
    buildTurn,
    state.t - elapsed,
    elapsed,
  );
  return (
    <Thread
      scroll={state.scroll}
      composer={
        <Composer
          state={{ ...state, caret: false }}
          text=""
          placeholder="Steer Claude, or /btw to ask on the side…"
        />
      }
    >
      <article className="project-message user tz-rise">
        <header>
          <strong>You</strong>
          <time>{fmtTime(0)}</time>
        </header>
        <div className="markdown">
          <p>{prompt}</p>
        </div>
      </article>
      <article className="project-message assistant">
        <header>
          <strong>
            <ProviderIcon provider="claude" />
            Claude
          </strong>
        </header>
        <AgentTurn
          message={message}
          projectRoot={projectRoot}
          onOpenFile={noop}
          onChanges={noop}
        />
        {message.body && (
          <RichText
            text={message.body}
            projectRoot={projectRoot}
            onOpenFile={noop}
          />
        )}
        {message.status === "complete" && (
          <div className="tz-rise">
            <ChangedFilesCard files={changedFiles} onOpen={noop} />
          </div>
        )}
      </article>
    </Thread>
  );
}

function ChangesPane() {
  return (
    <>
      <header className="pane-header">
        <div className="pane-header-title">
          <GitCompareArrows size={14} />
          <span>Changes</span>
          <small className="pane-header-detail">main · 3 files</small>
        </div>
        <span className="spacer" />
      </header>
      <section className="local-changes">
        <div className="working-content">
          <aside className="working-sidebar tz-working-sidebar">
            <div className="working-file-list">
              <section>
                <header>
                  <button className="change-section-toggle" aria-expanded>
                    <ChevronRight size={13} />
                  </button>
                  <input type="checkbox" readOnly checked={false} />
                  <strong>Changes</strong>
                  <span>3 files</span>
                </header>
                {changedFiles.map((f, i) => {
                  const slash = f.path.lastIndexOf("/");
                  return (
                    <div
                      key={f.path}
                      className={`working-file ${i === 0 ? "selected" : ""}`}
                    >
                      <input type="checkbox" readOnly checked={false} />
                      <button className="change-select">
                        <FileEntryIcon path={f.path} directory={false} />
                        <span
                          className={`change-name ${f.deletions === 0 ? "added" : "modified"}`}
                        >
                          {f.path.slice(slash + 1)}
                        </span>
                        <span className="change-dir">
                          {f.path.slice(0, slash)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </section>
            </div>
          </aside>
          <div className="working-main tz-working-main">
            <WorkingDiff pair={shortcutsPair} split />
          </div>
        </div>
      </section>
    </>
  );
}

function Terminal({ height, run }: { height: number; run: number }) {
  const shown = terminalLines.filter((l) => l.at <= run);
  return (
    <section
      className="terminal-drawer tz-terminal"
      style={{ height, minHeight: 0 }}
    >
      <header className="terminal-drawer-header">
        <SquareTerminal size={14} />
        <span className="terminal-drawer-title">Terminal</span>
        <span className="terminal-drawer-cwd">relay</span>
        <span className="spacer" />
        <button className="icon-button" tabIndex={-1}>
          <X size={14} />
        </button>
      </header>
      <div className="terminal-drawer-body tz-terminal-body">
        {shown.map((l, i) => (
          <div key={i} className={`tz-line ${l.tone ?? ""}`}>
            {l.text || " "}
            {i === shown.length - 1 && <i className="tz-term-caret" />}
          </div>
        ))}
      </div>
    </section>
  );
}

const reviewers: { provider: AgentProvider; name: string }[] = [
  { provider: "claude", name: "Opus 5.5" },
  { provider: "codex", name: "GPT-5.6-Sol" },
];

function AgentChip({
  provider,
  name,
}: {
  provider: AgentProvider;
  name: string;
}) {
  return (
    <span className="dr-agent-chip">
      <ProviderIcon provider={provider} />
      {name}
      <span className="muted">High</span>
    </span>
  );
}

function ReviewThread({ state }: { state: WindowState }) {
  const done = reviewers.filter(
    (_, i) =>
      state.review >= reviewScripts[i].answerAt + reviewScripts[i].writeFor,
  ).length;
  const report = state.reportShown;
  return (
    <Thread
      scroll={state.scroll}
      composer={
        <Composer
          state={{ ...state, caret: false, turn: null }}
          text=""
          placeholder="Ask the lead about a finding, or tell it what to fix…"
        />
      }
    >
      <article className="project-message user">
        <header>
          <strong>You</strong>
          <time>{fmtTime(0)}</time>
        </header>
        <div className="dr-request">
          <div className="dr-request-title">
            <ScanSearch size={15} />
            <strong>Deep review</strong>
            <span>Uncommitted changes</span>
            <span className="diff-stat">
              <span className="diff-stat-add">+212</span>
              <span className="diff-stat-del">−48</span>
            </span>
          </div>
          <div className="dr-request-agents">
            {reviewers.map((r) => (
              <AgentChip key={r.name} {...r} />
            ))}
            <span className="dr-arrow">→</span>
            <AgentChip provider="claude" name="Opus 5.5" />
          </div>
        </div>
      </article>
      {report <= 0 ? (
        <section className="dr-council">
          <div className="dr-council-head">
            <Telescope size={14} />
            <strong>Council</strong>
            <span>
              {done === reviewers.length
                ? `All ${reviewers.length} done · 7 findings`
                : `${done} of ${reviewers.length} done`}
            </span>
          </div>
          <div className="dr-grid" data-count={2}>
            {reviewers.map((r, i) => {
              const script = reviewScripts[i];
              const message = turnAt(
                `review-${i}`,
                r.provider,
                script,
                state.t - state.review,
                state.review,
              );
              const finished = message.status === "complete";
              return (
                <section
                  key={r.name}
                  className="dr-pane"
                  data-done={finished || undefined}
                >
                  <header>
                    <ProviderIcon provider={r.provider} />
                    <strong>{r.name}</strong>
                    <span className="muted">High</span>
                    <span className="spacer" />
                    {finished && (
                      <span className="dr-pane-status done">
                        <CircleCheck size={13} /> {i === 0 ? 4 : 3} findings
                      </span>
                    )}
                  </header>
                  <div className="dr-pane-thread">
                    <div>
                      <article className="project-message user">
                        <header>
                          <strong>You</strong>
                          <span className="muted">via Deep review</span>
                        </header>
                        <div className="markdown">
                          <p>
                            <code>
                              {r.provider === "codex"
                                ? "/review"
                                : "/code-review high"}
                            </code>{" "}
                            Uncommitted changes
                          </p>
                        </div>
                      </article>
                      <article className="project-message assistant">
                        <header>
                          <strong>
                            <ProviderIcon provider={r.provider} />
                            {r.provider === "codex" ? "Codex" : "Claude"}
                          </strong>
                        </header>
                        <AgentTurn
                          message={message}
                          projectRoot={projectRoot}
                          onOpenFile={noop}
                          onChanges={noop}
                        />
                        {message.body && (
                          <RichText
                            text={message.body}
                            projectRoot={projectRoot}
                            onOpenFile={noop}
                          />
                        )}
                      </article>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      ) : (
        <Report shown={report} />
      )}
    </Thread>
  );
}

function Report({ shown }: { shown: number }) {
  const tag = { high: "P1", medium: "P2" } as const;
  return (
    <>
      <section className="dr-council collapsed">
        <button type="button" className="dr-council-toggle">
          <Telescope size={14} />
          <span>Council · 2 reviewers · 7 raw findings → 4 kept</span>
          <span className="dr-council-glyphs">
            <ProviderIcon provider="claude" />
            <ProviderIcon provider="codex" />
          </span>
          <ChevronRight size={13} />
        </button>
      </section>
      <article className="project-message assistant">
        <header>
          <strong>
            <ProviderIcon provider="claude" />
            Claude
          </strong>
          <time>{fmtTime(9 * 60_000)}</time>
        </header>
        <div className="dr-report">
          <div className="markdown">
            <p>
              I checked all <strong>7 findings</strong> from the 2 reviewers
              against the code. <strong>4 hold up</strong>, 2 of them high. The
              other 3 were duplicates or didn't hold up.
            </p>
          </div>
          <section className="dr-tray">
            <ol className="dr-tasks">
              {findings.map((f, i) => (
                <li
                  key={f.id}
                  className="dr-task"
                  data-status="open"
                  style={{
                    opacity: Math.min(1, Math.max(0, shown * 5 - i * 0.6)),
                    transform: `translateY(${Math.max(0, 1 - (shown * 5 - i * 0.6)) * 10}px)`,
                  }}
                >
                  <label className="dr-task-head">
                    <input
                      type="checkbox"
                      readOnly
                      checked={f.severity === "high"}
                    />
                    <span
                      className="dr-priority"
                      data-priority={tag[f.severity]}
                    >
                      {tag[f.severity]}
                    </span>
                    <span className="dr-task-title">{f.title}</span>
                    <span className="dr-found-by">
                      {f.by.map((p) => (
                        <ProviderIcon key={p} provider={p} />
                      ))}
                      {f.by.length}/2
                    </span>
                  </label>
                  <ul className="dr-task-files">
                    {f.files.map((file) => (
                      <li key={file.path}>
                        <span className="dr-task-file">
                          <FileEntryIcon path={file.path} directory={false} />
                          <span className="dr-task-file-name">
                            {file.path.split("/").pop()}
                          </span>
                          <span className="dr-task-file-line">
                            L{file.line}
                          </span>
                          <span className="dr-task-file-dir">
                            {file.path.split("/").slice(0, -1).join("/")}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <footer>
              <span className="spacer" />
              <button type="button">Fix selected (2)</button>
              <button type="button" className="primary">
                <Wrench size={14} />
                Fix all 4
              </button>
            </footer>
          </section>
        </div>
      </article>
    </>
  );
}
