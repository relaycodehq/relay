// The phone app's screens, redrawn for the web from the Kotlin app in
// android/: Home's list (features/home), the thread (features/thread) and its
// composer, at the app's dp sizes (scaled by --dp) and with its wording. A
// turn's heading and a row's state come from the same shared logic.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  ArrowUp,
  BatteryMedium,
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Ellipsis,
  FilePen,
  FileText,
  Globe,
  ImagePlus,
  Inbox,
  LayoutGrid,
  Mic,
  PanelLeft,
  Plus,
  Reply,
  Search,
  Bolt,
  Split,
  Terminal,
  Undo2,
  Volume2,
  Wifi,
  Wrench,
} from "lucide-react";
import type {
  AgentActivity,
  ChatMessage,
  ChatSummary,
} from "../../shared/projects";
import { agentName } from "../../shared/agents";
import {
  doneLabel,
  duration,
  liveLabel,
  summarizeActivity,
} from "../../shared/activity-labels";
import {
  batchHead,
  groupTrace,
  readTurn,
  turnHeading,
} from "../../shared/agent-trace";
import {
  chatActivitySections,
  elapsedLabel,
  shortAge,
} from "../../shared/chat-activity";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { chats, projectRoot, projects } from "./sample";
import "./phone.css";

const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** Android's status bar; `hole` is where this screen's camera sits. */
export function PhoneStatus({ hole }: { hole: "center" | "right" }) {
  const now = useNow(30_000);
  return (
    <div className="ph-status" data-hole={hole} aria-hidden="true">
      <span>{clock(now)}</span>
      <i />
      <span>
        <Wifi size={14} />
        <BatteryMedium size={17} />
      </span>
    </div>
  );
}

const projectName = (chat: ChatSummary) =>
  projects.find((p) => p.id === chat.projectId)?.name ?? "?";

/** ActivityCard's leading mark: needs you, working, unread or nothing new. */
function Glyph({ chat, unread }: { chat: ChatSummary; unread: boolean }) {
  if (chat.waiting) return <i className="ph-dot" data-kind="waiting" />;
  if (chat.running) return <i className="ph-spin" />;
  return <i className="ph-dot" data-kind={unread ? "unread" : undefined} />;
}

/** A thread on Home: its title, where it is and what it's doing, and how long. */
function Row({
  chat,
  on,
  unread,
  now,
  onOpen,
}: {
  chat: ChatSummary;
  on: boolean;
  unread: boolean;
  now: number;
  onOpen: () => void;
}) {
  const state = chat.waiting
    ? "needs input"
    : chat.running
      ? "working"
      : undefined;
  const meta = [projectName(chat), state, chat.branch]
    .filter(Boolean)
    .join(" · ");
  const bright = on || unread || chat.waiting;
  return (
    <button
      type="button"
      className="ph-row"
      data-on={on || undefined}
      data-dim={!bright || undefined}
      onClick={onOpen}
    >
      <span className="ph-glyph">
        <Glyph chat={chat} unread={unread} />
      </span>
      <span className="ph-row-text">
        <strong>{chat.title}</strong>
        <span>{meta}</span>
      </span>
      <span className="ph-row-end">
        <time data-kind={chat.waiting ? "waiting" : undefined}>
          {chat.running && chat.runningSince
            ? elapsedLabel(chat.runningSince, now)
            : shortAge(chat.updated, now)}
        </time>
        {chat.provider ? <ProviderIcon provider={chat.provider} /> : null}
      </span>
    </button>
  );
}

function SectionHeader({
  label,
  count,
  folded,
}: {
  label: string;
  count: number;
  folded?: boolean;
}) {
  return (
    <div className="ph-section">
      <span>{label}</span>
      <i>{count}</i>
      {folded ? <ChevronRight size={13} /> : null}
    </div>
  );
}

/** Home: the computer, search, threads grouped as you'd triage them, and the tabs. On a fold it's the list beside the thread. */
export function PhoneSidebar({
  selected,
  unread,
  onOpen,
}: {
  selected: string;
  /** Threads with news the phone hasn't shown yet. */
  unread: ReadonlySet<string>;
  onOpen: (chat: ChatSummary) => void;
}) {
  const now = useNow(1000);
  const sections = chatActivitySections(chats, now);
  const groups: [string, ChatSummary[]][] = [
    ["Needs you", sections.active.filter((c) => c.waiting)],
    ["Running", sections.active.filter((c) => c.running && !c.waiting)],
    ["Recent", sections.active.filter((c) => !c.running && !c.waiting)],
  ];
  return (
    <aside className="ph-sidebar">
      <header className="ph-home-head">
        <strong>
          studio-mac
          <ChevronDown size={16} />
        </strong>
        <Plus size={22} />
      </header>
      <div className="ph-search">
        <Search size={18} />
        Search
      </div>
      <div className="ph-rows">
        {groups.map(([label, group]) =>
          group.length ? (
            <Fragment key={label}>
              <SectionHeader label={label} count={group.length} />
              {group.map((chat) => (
                <Row
                  key={chat.id}
                  chat={chat}
                  on={chat.id === selected}
                  unread={unread.has(chat.id)}
                  now={now}
                  onOpen={() => onOpen(chat)}
                />
              ))}
            </Fragment>
          ) : null,
        )}
        <SectionHeader label="Snoozed" count={2} folded />
        <SectionHeader label="Settled" count={14} folded />
      </div>
      <nav className="ph-tabs">
        <span data-on>
          <Inbox size={20} />
          Threads
        </span>
        <span>
          <LayoutGrid size={20} />
          Projects
        </span>
        <span>
          <Bolt size={20} />
          Settings
        </span>
      </nav>
    </aside>
  );
}

/** Bold and inline code are all the sample answers use. */
function Markdown({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className="ph-md" data-small={small || undefined}>
      {text.split("\n\n").map((block, i) => (
        <p key={i}>
          {block
            .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
            .map((part, j) =>
              part.startsWith("**") ? (
                <b key={j}>{part.slice(2, -2)}</b>
              ) : part.startsWith("`") ? (
                <code key={j}>{part.slice(1, -1)}</code>
              ) : (
                <Fragment key={j}>{part}</Fragment>
              ),
            )}
        </p>
      ))}
    </div>
  );
}

const display = (text: string) => text.split(`${projectRoot}/`).join("");

function Step({
  icon: Icon,
  running,
  mono,
  folds,
  children,
}: {
  icon: typeof Terminal;
  running?: boolean;
  mono?: boolean;
  folds?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ph-step">
      <Icon size={14} />
      <span
        className={running ? "live-shine" : undefined}
        data-mono={mono || undefined}
      >
        {children}
      </span>
      {folds ? <ChevronRight size={13} /> : null}
    </div>
  );
}

// features/thread/AgentRun.kt
function AgentRun({ message }: { message: ChatMessage }) {
  useNow(1000);
  const turn = readTurn(message);
  const { live, entries, shown } = turn;
  if (!live && !entries.length) return null;
  const heading = turnHeading(message, live, turn);
  const HeaderIcon =
    heading.kind === "working"
      ? Clock3
      : heading.kind === "call"
        ? icons[heading.activity.kind]
        : heading.kind === "done" && heading.last
          ? icons[heading.last.kind]
          : Brain;
  return (
    <div className="ph-run">
      <div className="ph-step ph-run-head">
        <HeaderIcon size={14} />
        <span className={heading.kind === "call" ? "live-shine" : undefined}>
          {heading.kind === "working"
            ? "Working for"
            : heading.kind === "done"
              ? heading.text
              : heading.kind === "call"
                ? display(liveLabel(heading.activity))
                : "Thinking"}
        </span>
        <time>
          {live
            ? duration(Date.now() - message.created)
            : message.ended
              ? duration(message.ended - message.created)
              : null}
        </time>
        <ChevronRight size={13} data-turned={live || undefined} />
      </div>
      {live ? (
        <div className="ph-trace">
          {groupTrace(shown).map((part, index, parts) => {
            if (part.kind === "commentary")
              return <Markdown key={part.id} text={part.text} small />;
            if (index === parts.length - 1) {
              const { head } = batchHead(part.activity);
              const running = head.status === "running";
              return (
                <Step key={part.id} icon={icons[head.kind]} running={running}>
                  {display(running ? liveLabel(head) : doneLabel(head))}
                </Step>
              );
            }
            const only =
              part.activity.length === 1 ? part.activity[0]! : undefined;
            const kinds = new Set(part.activity.map((a) => a.kind));
            return (
              <Step
                key={part.id}
                icon={kinds.size === 1 ? icons[part.activity[0]!.kind] : Wrench}
                mono={only?.kind === "command"}
                folds
              >
                {only ? display(only.label) : summarizeActivity(part.activity)}
              </Step>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// features/thread/MessageView.kt
function Turn({ message: m }: { message: ChatMessage }) {
  const user = m.role === "user";
  const add = m.changes?.reduce((n, f) => n + f.additions, 0) ?? 0;
  const del = m.changes?.reduce((n, f) => n + f.deletions, 0) ?? 0;
  if (user)
    return (
      <div className="ph-turn" data-user>
        <div className="ph-bubble">{m.body}</div>
        <time>{clock(m.created)}</time>
      </div>
    );
  return (
    <div className="ph-turn">
      <div className="ph-agent">
        <ProviderIcon provider={m.provider} />
        {agentName(m.provider)}
      </div>
      <AgentRun message={m} />
      {m.body.trim() ? <Markdown text={m.body} /> : null}
      {m.changes?.length && m.status !== "streaming" ? (
        <div className="ph-files">
          <div>
            <strong>
              {m.changes.length === 1
                ? "1 file changed"
                : `${m.changes.length} files changed`}
            </strong>
            <Counts add={add} del={del} />
            <span className="ph-rewind">
              <Undo2 size={14} />
              Roll back
            </span>
          </div>
          {m.changes.map((f) => {
            const slash = f.path.lastIndexOf("/");
            return (
              <div key={f.path}>
                <span className="ph-path">
                  {f.path.slice(slash + 1)}
                  {slash > 0 ? <i>{f.path.slice(0, slash)}</i> : null}
                </span>
                <Counts add={f.additions} del={f.deletions} />
              </div>
            );
          })}
        </div>
      ) : null}
      {m.status !== "streaming" ? (
        <div className="ph-actions">
          <time>{clock(m.ended ?? m.created)}</time>
          <Copy size={18} />
          <Volume2 size={18} />
          <Split size={18} />
          <Reply size={18} />
          <Ellipsis size={18} />
        </div>
      ) : null}
    </div>
  );
}

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="ph-counts">
      <b>+{add}</b>
      <i>−{del}</i>
    </span>
  );
}

/** The thread screen: its top bar, the messages and the composer. */
export function PhoneThread({
  chat,
  messages,
  model,
  pane,
}: {
  chat: ChatSummary;
  messages: ChatMessage[];
  /** The thread's model line, e.g. "Opus 5.5 · High". */
  model: string;
  /** Beside the list on a fold: the sidebar's toggle where the back arrow was. */
  pane?: boolean;
}) {
  const provider = messages.at(-1)?.provider ?? "claude";
  return (
    <section className="ph-thread">
      <header>
        {pane ? <PanelLeft size={20} /> : <ChevronLeft size={24} />}
        <span>
          <strong>{chat.title}</strong>
          <small>{model} · 31% context</small>
        </span>
        <Ellipsis size={22} />
      </header>
      <div className="ph-list">
        <div>
          {messages.map((m) => (
            <Turn key={m.id} message={m} />
          ))}
        </div>
      </div>
      <PhoneComposer
        input={`Message ${agentName(provider)}`}
        stop={chat.running}
      />
    </section>
  );
}

/** The message box with its tool row, and Android's gesture bar under it. */
export function PhoneComposer({
  input,
  stop,
  press,
}: {
  input: ReactNode;
  stop?: boolean;
  press?: boolean;
}) {
  return (
    <footer className="ph-dock">
      <div className="ph-box">
        <span className="ph-input">{input}</span>
        <div className="ph-tools">
          <ImagePlus size={20} />
          <i />
          <span className="ph-slash">/</span>
          <Mic size={20} />
          <span
            className="ph-send"
            data-stop={stop || undefined}
            data-press={press || undefined}
          >
            {stop ? <i /> : <ArrowUp size={18} strokeWidth={2.5} />}
          </span>
        </div>
      </div>
      <i className="ph-grip" />
    </footer>
  );
}
