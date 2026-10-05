// The phone app's screens, redrawn for the web from mobile/src/ui: the same
// structure, sizes (in dp, scaled by --dp) and wording, and the same shared
// logic for a turn's heading and a card's state.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUp,
  BatteryMedium,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Ellipsis,
  FilePen,
  FileText,
  Globe,
  Bot,
  Brain,
  ImagePlus,
  PanelLeft,
  Plus,
  Reply,
  Search,
  Settings2,
  Split,
  Square,
  Terminal,
  Undo2,
  Wifi,
  Wrench,
} from "lucide-react";
import type { AgentActivity, ChatMessage, ChatSummary } from "../../shared/projects";
import { agentName } from "../../shared/agents";
import { doneLabel, duration, liveLabel, summarizeActivity } from "../../shared/activity-labels";
import { batchHead, groupTrace, readTurn, turnHeading } from "../../shared/agent-trace";
import { chatActivitySections, elapsedLabel, sentLabel, shortAge } from "../../shared/chat-activity";
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
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

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

// mobile/src/ui/ProjectIcon.tsx
function projectHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function Badge({ name }: { name: string }) {
  const hue = projectHue(name);
  return (
    <span className="ph-badge" style={{ background: `hsl(${hue}, 45%, 48%)`, color: `hsl(${hue}, 55%, 96%)` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CardState({ chat, unread, now }: { chat: ChatSummary; unread: boolean; now: number }) {
  if (chat.waiting)
    return (
      <span className="ph-state" data-kind="waiting">
        <i className="ph-dot" />
        Needs input
      </span>
    );
  if (chat.running)
    return (
      <span className="ph-state" data-kind="working">
        <i className="ph-spin" />
        Working{chat.runningSince ? ` ${elapsedLabel(chat.runningSince, now)}` : ""}
      </span>
    );
  return (
    <span className="ph-state" data-kind={unread ? "unread" : undefined}>
      {unread ? <i className="ph-dot" /> : null}
      {shortAge(chat.updated, now)}
    </span>
  );
}

/** The list beside the open thread from 600dp wide: mobile/src/ui/Sidebar.tsx. */
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
  const active = chatActivitySections(chats, now).active;
  return (
    <aside className="ph-sidebar">
      <header>
        <PanelLeft size={20} />
        <strong>
          studio-mac
          <ChevronDown size={15} />
        </strong>
        <Settings2 size={20} />
      </header>
      <div className="ph-search">
        <Search size={16} />
        Search
      </div>
      <div className="ph-tabs">
        <span data-on>Activity</span>
        <span>Projects</span>
      </div>
      <div className="ph-cards">
        <div className="ph-cards-head">
          <span>Activity</span>
          <span>{active.length} open</span>
        </div>
        {active.map((chat) => {
          const project = projects.find((p) => p.id === chat.projectId)?.name ?? "?";
          const on = chat.id === selected;
          const bright = on || unread.has(chat.id) || chat.waiting;
          return (
            <button
              key={chat.id}
              type="button"
              className="ph-card"
              data-on={on || undefined}
              data-dim={!bright || undefined}
              onClick={() => onOpen(chat)}
            >
              <span className="ph-card-top">
                <Badge name={project} />
                <span>{project}</span>
                <CardState chat={chat} unread={unread.has(chat.id)} now={now} />
              </span>
              <strong>{chat.title}</strong>
              <span className="ph-card-meta">
                <span>{chat.branch}</span>
                {chat.provider ? <ProviderIcon provider={chat.provider} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <span className="ph-fab">
        <Plus size={18} strokeWidth={2.5} />
        New thread
      </span>
    </aside>
  );
}

/** Bold and inline code are all the sample answers use. */
function Markdown({ text, small }: { text: string; small?: boolean }) {
  return (
    <div className="ph-md" data-small={small || undefined}>
      {text.split("\n\n").map((block, i) => (
        <p key={i}>
          {block.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, j) =>
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

function Step({ icon: Icon, running, mono, children }: { icon: typeof Terminal; running?: boolean; mono?: boolean; children: ReactNode }) {
  return (
    <div className="ph-step">
      <Icon size={14} />
      <span className={running ? "live-shine" : undefined} data-mono={mono || undefined}>
        {children}
      </span>
    </div>
  );
}

// mobile/src/ui/AgentRun.tsx
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
        : heading.kind === "done"
          ? heading.last
            ? icons[heading.last.kind]
            : Brain
          : Brain;
  return (
    <div className="ph-run">
      <div className="ph-run-head">
        <HeaderIcon size={14} />
        <span>
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
            if (part.kind === "commentary") return <Markdown key={part.id} text={part.text} small />;
            if (index === parts.length - 1) {
              const { head } = batchHead(part.activity);
              const running = head.status === "running";
              return (
                <Step key={part.id} icon={icons[head.kind]} running={running}>
                  {display(running ? liveLabel(head) : doneLabel(head))}
                </Step>
              );
            }
            const only = part.activity.length === 1 ? part.activity[0]! : undefined;
            const kinds = new Set(part.activity.map((a) => a.kind));
            return (
              <Step
                key={part.id}
                icon={kinds.size === 1 ? icons[part.activity[0]!.kind] : Wrench}
                mono={only?.kind === "command"}
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

// mobile/src/ui/MessageView.tsx
function Turn({ message: m }: { message: ChatMessage }) {
  const user = m.role === "user";
  const add = m.changes?.reduce((n, f) => n + f.additions, 0) ?? 0;
  const del = m.changes?.reduce((n, f) => n + f.deletions, 0) ?? 0;
  return (
    <div className="ph-turn">
      <div className="ph-turn-head">
        {user ? null : <ProviderIcon provider={m.provider} />}
        <strong>{user ? "You" : agentName(m.provider)}</strong>
        {user ? <span>{clock(m.created)}</span> : null}
      </div>
      {user ? <div className="ph-bubble">{m.body}</div> : <AgentRun message={m} />}
      {!user && m.body.trim() ? <Markdown text={m.body} /> : null}
      {!user && m.changes?.length && m.status !== "streaming" ? (
        <div className="ph-files">
          <div>
            <strong>{m.changes.length === 1 ? "1 file changed" : `${m.changes.length} files changed`}</strong>
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
      {!user && m.status !== "streaming" ? (
        <div className="ph-actions">
          <span>{sentLabel(m.ended ?? m.created, new Date())}</span>
          <Copy size={16} />
          <Split size={16} />
          <Reply size={16} />
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

/** The thread screen: the stack's header, the messages and the composer. */
export function PhoneThread({
  chat,
  messages,
  model,
  pane,
}: {
  chat: ChatSummary;
  messages: ChatMessage[];
  /** The composer's model label, e.g. "Opus 5.5 · High". */
  model: string;
  /** Beside the list, where the first screen has nothing to go back to. */
  pane?: boolean;
}) {
  const provider = messages.at(-1)?.provider ?? "claude";
  return (
    <section className="ph-thread">
      <header>
        {pane ? null : <ArrowLeft size={24} />}
        <strong>{chat.title}</strong>
        <Ellipsis size={22} />
      </header>
      <div className="ph-list">
        <div>
          {messages.map((m) => (
            <Turn key={m.id} message={m} />
          ))}
        </div>
      </div>
      <footer className="ph-dock">
        <div className="ph-box">
          <span className="ph-input">Message {agentName(provider)}</span>
          <div className="ph-tools">
            <span>
              <ImagePlus size={17} />
            </span>
            <span>
              <ProviderIcon provider={provider} />
              {model}
              <ChevronDown size={12} />
            </span>
            <span>Full access</span>
            <span>Plan</span>
            <i />
            <span className="ph-slash">/</span>
            {chat.running ? (
              <span className="ph-send" data-on>
                <Square size={13} fill="currentColor" />
              </span>
            ) : (
              <span className="ph-send">
                <ArrowUp size={18} strokeWidth={2.5} />
              </span>
            )}
          </div>
        </div>
        <i className="ph-grip" />
      </footer>
    </section>
  );
}
