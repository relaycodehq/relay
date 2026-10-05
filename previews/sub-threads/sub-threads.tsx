// Threads an agent starts through Relay's MCP tools, shown like subagents:
// the lead's card and turn carry an icon and a count, and hovering it opens
// a card previewing each started thread. Sample data.
// Open http://127.0.0.1:5177/previews/sub-threads/
import "../_shared/desktop-stub";
import { StrictMode, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  CornerLeftUp,
  MessagesSquare,
  Moon,
  Sun,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/agent-turn/subagents.css";
import "../_shared/chrome.css";
import "./sub-threads.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { Spinner } from "../../src/ui/ui";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { threads as sample, type Live, type SampleThread } from "./sub-threads-data";

initAppearance();
initWindowFocus();

const ageLabel = (min: number) =>
  min < 60 ? `${min}m` : `${Math.round(min / 60)}h`;

function Badge({ t }: { t: SampleThread }) {
  return (
    <span
      className="sb-project-badge"
      style={{ "--hue": t.hue } as CSSProperties}
      aria-hidden
    >
      {t.project[0]}
    </span>
  );
}

/** Like SubagentStatus: still, even while it works; amber when it asks. */
function StartedStatus({ live }: { live: Live }) {
  return (
    <span className="subagent-status">
      {live === "working" ? (
        <span className="subagent-dot" aria-label="Working" />
      ) : live === "waiting" ? (
        <span className="st-ask-dot" aria-label="Needs input" />
      ) : live === "stopped" ? (
        <CircleStop size={13} aria-label="Stopped" />
      ) : (
        <Check size={13} className="subagent-done" aria-label="Done" />
      )}
    </span>
  );
}

/** The started threads on the left; the one pointed at on the right. */
function Peek({
  kids,
  onOpen,
  onStop,
}: {
  kids: SampleThread[];
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const [focus, setFocus] = useState<string>();
  const first =
    kids.find((k) => k.live === "waiting") ??
    kids.find((k) => k.live === "working") ??
    kids[0];
  const t = kids.find((k) => k.id === focus) ?? first;
  const done = kids.filter((k) => k.live === "done" || k.live === "stopped").length;
  return (
    <div className="subagents-peek">
      <div className="subagents-list">
        <div className="subagents-card-head">
          <b>Started threads</b>
          <span>
            {done} of {kids.length} done
          </span>
        </div>
        {kids.map((k) => (
          <button
            key={k.id}
            type="button"
            className="subagents-item"
            aria-current={k === t}
            onMouseEnter={() => setFocus(k.id)}
            onFocus={() => setFocus(k.id)}
            onClick={() => onOpen(k.id)}
          >
            <StartedStatus live={k.live} />
            <span className="subagents-name">{k.title}</span>
            <span className="st-peek-agent">
              <ProviderIcon provider={k.provider} />
            </span>
          </button>
        ))}
      </div>
      <div className="subagents-detail">
        <div className="subagents-title">
          <b>{t.title}</b>
          <span>
            {t.model} · {t.branch} · {ageLabel(t.age)}
          </span>
        </div>
        <p className="subagents-brief">{t.task}</p>
        <p className={`subagents-now ${t.live === "waiting" ? "st-asks" : ""}`}>
          {t.live === "stopped" ? "Stopped" : t.now}
        </p>
        <div className="subagents-calls" />
        <div className="subagents-actions">
          <button type="button" className="text-button" onClick={() => onOpen(t.id)}>
            {t.live === "waiting" ? "Answer it" : "Open thread"}
            <ChevronRight size={13} />
          </button>
          {t.live === "working" && (
            <button type="button" className="text-button" onClick={() => onStop(t.id)}>
              Stop thread
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** An icon and how many are done; hover for the card. */
function StartedChip({
  kids,
  open,
  stop,
  side,
  className = "",
}: {
  kids: SampleThread[];
  open: (id: string) => void;
  stop: (id: string) => void;
  side: "right" | "top";
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const done = kids.filter((k) => k.live === "done" || k.live === "stopped").length;
  const asking = kids.some((k) => k.live === "waiting");
  return (
    <Popover.Root open={shown} onOpenChange={setShown}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className={`composer-branch-trigger subagents-chip st-chip ${className}`}
        aria-label={`${kids.length} started threads: ${done} done`}
        onClick={(e) => e.stopPropagation()}
      >
        <MessagesSquare size={13} />
        <span>
          {done}/{kids.length}
        </span>
        {asking && <span className="st-ask-dot" aria-label="One needs input" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align={side === "right" ? "start" : "end"}
          sideOffset={10}
          collisionPadding={12}
        >
          {/* Portals still bubble through React: keep clicks off the card. */}
          <Popover.Popup
            className="subagents-card"
            aria-label="Started threads"
            onClick={(e) => e.stopPropagation()}
          >
            <Peek
              kids={kids}
              onOpen={(id) => {
                setShown(false);
                open(id);
              }}
              onStop={stop}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CardState({ t, asking }: { t: SampleThread; asking: boolean }) {
  if (asking || t.live === "waiting")
    return (
      <span className="sb-card-state waiting">
        <i />
        Needs input
      </span>
    );
  if (t.live === "working")
    return (
      <span className="sb-card-state running">
        <Spinner size={11} steady />
        Working
      </span>
    );
  return (
    <time className={`sb-card-state ${t.live === "unread" ? "unread" : ""}`}>
      {t.live === "unread" && <i />}
      {ageLabel(t.age)}
    </time>
  );
}

interface Ctx {
  threads: SampleThread[];
  selected: string;
  open: (id: string) => void;
  stop: (id: string) => void;
}

const kidsOf = (ctx: Ctx, id: string) => ctx.threads.filter((t) => t.parent === id);

/** "4 threads · 1 working · 1 needs you" for a family. */
function familyLine(kids: SampleThread[]) {
  const working = kids.filter((k) => k.live === "working").length;
  const waiting = kids.filter((k) => k.live === "waiting").length;
  return [
    `${kids.length} threads`,
    working && `${working} working`,
    waiting && `${waiting} need${waiting === 1 ? "s" : ""} you`,
    !working && !waiting && "all done",
  ]
    .filter(Boolean)
    .join(" · ");
}

function Card({
  t,
  ctx,
  meta,
  asking = false,
  compact = false,
}: {
  t: SampleThread;
  ctx: Ctx;
  meta?: ReactNode;
  /** One of its started threads needs you. */
  asking?: boolean;
  /** A started thread: no project line, its state beside the branch. */
  compact?: boolean;
}) {
  const selected = ctx.selected === t.id;
  const dim = !selected && !asking && t.live !== "unread" && t.live !== "waiting";
  return (
    <div
      role="button"
      tabIndex={0}
      className={["sb-card", selected && "selected", dim && "dim"].filter(Boolean).join(" ")}
      onClick={() => ctx.open(t.id)}
      onKeyDown={(e) => e.key === "Enter" && ctx.open(t.id)}
    >
      {!compact && (
        <div className="sb-card-top">
          <Badge t={t} />
          <span className="sb-card-name">
            <span className="sb-card-project">{t.project}</span>
          </span>
          <CardState t={t} asking={asking} />
        </div>
      )}
      <div className="sb-card-title">{t.title}</div>
      <div className="sb-card-meta">
        {meta ?? <span className="sb-card-branch">{t.branch}</span>}
        {compact && <CardState t={t} asking={false} />}
        <span className="sb-card-provider">
          <ProviderIcon provider={t.provider} />
        </span>
      </div>
    </div>
  );
}

/** Activity: started threads as cards under their lead, on a guide line. */
function Activity({ ctx }: { ctx: Ctx }) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const tops = ctx.threads.filter((t) => !t.parent);
  return (
    <div className="sb-cards">
      {tops.map((t) => {
        const kids = kidsOf(ctx, t.id);
        const isFolded = folded.has(t.id);
        const toggle = () => {
          const next = new Set(folded);
          if (isFolded) next.delete(t.id);
          else next.add(t.id);
          setFolded(next);
        };
        return (
          <div key={t.id}>
            <Card
              t={t}
              ctx={ctx}
              asking={kids.some((k) => k.live === "waiting")}
              meta={
                kids.length ? (
                  <button
                    className="st-fold"
                    aria-expanded={!isFolded}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle();
                    }}
                  >
                    {isFolded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    {familyLine(kids)}
                  </button>
                ) : undefined
              }
            />
            {kids.length > 0 && !isFolded && (
              <div className="st-kids">
                {kids.map((k) => (
                  <Card key={k.id} t={k} ctx={ctx} compact />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The lead: the user's ask, one trace line for the tool call, its answer. */
function LeadView({ ctx }: { ctx: Ctx }) {
  const kids = kidsOf(ctx, "lead");
  return (
    <div className="st-thread">
      <div className="st-user">
        Take the first three from the competitor list and start a thread for
        each. Run the chat width one twice, Claude and Cursor, so I can
        compare.
      </div>
      <div className="st-trace">
        <MessagesSquare size={13} />
        <span>
          Started {kids.length} threads
          <span className="st-trace-muted"> · relay_thread_create</span>
        </span>
        <StartedChip kids={kids} open={ctx.open} stop={ctx.stop} side="top" className="st-trace-chip" />
      </div>
      <p className="st-answer">
        Started four threads. The chat width one runs twice, Claude and Cursor,
        so you can compare them. Branch name is done; bootstrap is asking
        whether setup runs before or after .env is copied.
      </p>
    </div>
  );
}

/** A started thread: who started it, the task it got, its own answer. */
function ChildView({ t, ctx }: { t: SampleThread; ctx: Ctx }) {
  const lead = ctx.threads.find((x) => x.id === t.parent)!;
  return (
    <div className="st-thread">
      <button className="st-crumb" onClick={() => ctx.open(lead.id)}>
        <CornerLeftUp size={12} />
        Started by <strong>{lead.title}</strong>
      </button>
      <div className="st-user st-user-agent">
        <small>
          <ProviderIcon provider={lead.provider} /> Claude in {lead.title}
        </small>
        {t.task}
      </div>
      {t.live === "working" ? (
        <p className="st-answer st-working">
          <Spinner size={12} steady /> {t.now}
        </p>
      ) : (
        <p className={`st-answer ${t.live === "waiting" ? "st-asks" : ""}`}>
          {t.live === "stopped" ? "Stopped by you." : t.now}
        </p>
      )}
    </div>
  );
}

function Main({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const current = ctx.threads.find((t) => t.id === ctx.selected)!;
  return (
    <main className="st-main">
      <header className="st-header">
        <Badge t={current} />
        <span className="st-header-title">{current.title}</span>
        {current.branch && <small>{current.branch}</small>}
      </header>
      <div className="st-scroll">{children}</div>
      <div className="st-composer">
        <span>
          {current.parent ? "Reply here to steer this thread yourself…" : "Message…"}
        </span>
        <ArrowUp size={14} />
      </div>
    </main>
  );
}

function App() {
  const [threads, setThreads] = useState(sample);
  const [selected, setSelected] = useState("lead");
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark" ||
      matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const ctx: Ctx = {
    threads,
    selected,
    open: setSelected,
    stop: (id) =>
      setThreads((all) => all.map((t) => (t.id === id ? { ...t, live: "stopped" } : t))),
  };
  const current = threads.find((t) => t.id === selected)!;

  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Started threads</strong>
        <span className="preview-tag">Sample data</span>
        <span style={{ flex: 1, minWidth: 240 }}>
          Started threads sit under their lead in Activity, on a guide line;
          fold them from the lead's card. In the lead's turn the tool call is
          one line: hover its count for each thread's task and latest line.
        </span>
        <button
          className="st-bar-button"
          onClick={() => {
            setThreads(sample);
            setSelected("lead");
          }}
        >
          Reset
        </button>
        <button
          className="st-bar-button"
          aria-label="Toggle theme"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
      <div className="st-stage">
        <aside className="st-sidebar">
          <div className="sb">
            <div className="sb-view-heading st-heading">
              <h2>Activity</h2>
            </div>
            <div className="sb-scroll">
              <Activity ctx={ctx} />
            </div>
          </div>
        </aside>
        <Main ctx={ctx}>
          {current.id === "lead" ? (
            <LeadView ctx={ctx} />
          ) : current.parent ? (
            <ChildView t={current} ctx={ctx} />
          ) : (
            <div className="st-thread">
              <p className="st-answer st-muted">
                An ordinary thread, here so the sidebar has neighbours.
              </p>
            </div>
          )}
        </Main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
