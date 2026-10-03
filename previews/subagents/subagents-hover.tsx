// The subagents indicator beside the Project folder control, and five ways
// its hover card could read.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { AgentActivity } from "../../shared/projects";
import { doneLabel, liveLabel, plural } from "../../shared/activity-labels";
import { clock, projectRoot, type AgentState } from "./subagents-data";

export type Variant = "list" | "tail" | "peek" | "timeline" | "glance";
export type CountStyle = "fraction" | "running" | "ticks";

export const variants: { value: Variant; label: string; note: string }[] = [
  {
    value: "list",
    label: "1 List",
    note: "One line per agent: what it's on now, or what it found. Click a row to follow it.",
  },
  {
    value: "tail",
    label: "2 Live tail",
    note: "Each agent's last three calls, so you see which files it's in right now.",
  },
  {
    value: "peek",
    label: "3 Peek",
    note: "Point at an agent on the left; its brief and latest calls show on the right.",
  },
  {
    value: "timeline",
    label: "4 Timeline",
    note: "When each agent started and how long it's been going, on one clock.",
  },
  {
    value: "glance",
    label: "5 Glance",
    note: "A plain tooltip to read. Clicking the icon opens the runs.",
  },
];

const icons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

const display = (text: string) => text.split(`${projectRoot}/`).join("");
const plain = (markdown: string) => markdown.replace(/`/g, "");
const firstSentence = (text: string) =>
  plain(text).split(/(?<=\.)\s/)[0] ?? text;

export const took = (seconds: number) => {
  const s = Math.floor(seconds);
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

const running = (batch: AgentState[]) =>
  batch.filter((a) => a.status === "running");

/**
 * Still, even while working: the turn's own running row is what moves, and a
 * card of four spinners beside it would be four more. The ticking time says
 * it's alive.
 */
export function StatusIcon({ a, size = 13 }: { a: AgentState; size?: number }) {
  if (a.status === "running")
    return <span className="agents-dot" aria-label="Working" />;
  if (a.status === "stopped")
    return (
      <CircleStop size={size} className="agents-stopped" aria-label="Stopped" />
    );
  return <Check size={size} className="agents-done" aria-label="Done" />;
}

/** What an agent is on now, from its ~30s summary; what it found once it's back. */
function nowLine(a: AgentState) {
  if (a.status === "stopped") return "Stopped from Relay";
  if (a.status !== "running") return firstSentence(a.script.report);
  const current = [...a.calls].reverse().find((c) => c.status === "running");
  return a.summary ?? (current ? display(liveLabel(current)) : "Starting…");
}

/** Named types only; every agent that isn't one is general-purpose. */
function Type({ a }: { a: AgentState }) {
  if (a.script.type === "general-purpose") return null;
  return <span className="agents-type">{a.script.type}</span>;
}

function CallLine({ call }: { call: AgentActivity }) {
  const Icon = icons[call.kind];
  const live = call.status === "running";
  return (
    <span className={`agents-call${live ? " live" : ""}`}>
      <Icon size={12} />
      <span className={call.kind === "command" ? "mono" : undefined}>
        {display(live ? liveLabel(call) : doneLabel(call))}
      </span>
    </span>
  );
}

function Count({ batch, style }: { batch: AgentState[]; style: CountStyle }) {
  const busy = running(batch).length;
  if (style === "ticks" && batch.length <= 6) {
    // Finished ones fill from the left, like a progress bar.
    const order = [...batch].sort(
      (a, b) => Number(a.status === "running") - Number(b.status === "running"),
    );
    return (
      <span className="agents-ticks" aria-hidden>
        {order.map((a) => (
          <i
            key={a.script.id}
            className={a.status === "running" ? undefined : "done"}
          />
        ))}
      </span>
    );
  }
  if (style === "running") return <span className="agents-count">{busy}</span>;
  return (
    <span className="agents-count">
      {batch.length === 1 ? 1 : `${batch.length - busy}/${batch.length}`}
    </span>
  );
}

/** Shows only while an agent runs; the count covers every agent since the first started. */
export function AgentsIndicator({
  batch,
  count,
  variant,
  now,
  onOpen,
}: {
  batch: AgentState[];
  count: CountStyle;
  variant: Variant;
  now: number;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!batch.length) return null;
  const busy = running(batch);
  const label = `${plural(batch.length, "subagent")}: ${batch.length - busy.length} done, ${busy.length} working`;
  const face = (
    <>
      <Bot size={14} />
      <Count batch={batch} style={count} />
    </>
  );
  const choose = (id: string) => {
    setOpen(false);
    onOpen(id);
  };
  if (variant === "glance")
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          delay={200}
          className="composer-branch-trigger agents-chip"
          aria-label={label}
          onClick={() => onOpen((busy[0] ?? batch[0]!).script.id)}
        >
          {face}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={8} collisionPadding={12}>
            <Tooltip.Popup className="agents-popup" data-variant="glance">
              <GlanceCard batch={batch} />
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className="composer-branch-trigger agents-chip"
        aria-label={label}
      >
        {face}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup
            className="agents-popup"
            data-variant={variant}
            aria-label="Subagents"
          >
            {variant === "list" ? (
              <ListCard batch={batch} onOpen={choose} />
            ) : variant === "tail" ? (
              <TailCard batch={batch} onOpen={choose} />
            ) : variant === "peek" ? (
              <PeekCard batch={batch} onOpen={choose} />
            ) : (
              <TimelineCard batch={batch} now={now} onOpen={choose} />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CardHead({ batch }: { batch: AgentState[] }) {
  const done = batch.length - running(batch).length;
  return (
    <div className="agents-card-head">
      <b>Subagents</b>
      <span>
        {done} of {batch.length} done
      </span>
    </div>
  );
}

/** 1: a row per agent, its summary line under the name. */
function ListCard({
  batch,
  onOpen,
}: {
  batch: AgentState[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <CardHead batch={batch} />
      {batch.map((a) => (
        <button
          key={a.script.id}
          type="button"
          className={`agents-row ${a.status}`}
          onClick={() => onOpen(a.script.id)}
        >
          <span className="agents-status">
            <StatusIcon a={a} />
          </span>
          <span className="agents-row-text">
            <span className="agents-row-title">
              <span className="agents-name">{a.script.description}</span>
              <Type a={a} />
            </span>
            <span className="agents-row-line">{nowLine(a)}</span>
          </span>
          <span className="agents-time">{took(a.elapsed)}</span>
          <ChevronRight size={13} className="agents-go" />
        </button>
      ))}
    </>
  );
}

/** 2: each agent's last three calls; three lines are kept so rows don't jump. */
function TailCard({
  batch,
  onOpen,
}: {
  batch: AgentState[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <CardHead batch={batch} />
      {batch.map((a) => {
        const tail = a.calls.slice(-3);
        return (
          <button
            key={a.script.id}
            type="button"
            className={`agents-tail-row ${a.status}`}
            onClick={() => onOpen(a.script.id)}
          >
            <span className="agents-tail-head">
              <span className="agents-status">
                <StatusIcon a={a} />
              </span>
              <span className="agents-name">{a.script.description}</span>
              <Type a={a} />
              <span className="agents-time">{took(a.elapsed)}</span>
            </span>
            {a.status === "running" ? (
              <span className="agents-tail-lines">
                {tail.map((c) => (
                  <CallLine key={c.id} call={c} />
                ))}
              </span>
            ) : (
              <span className="agents-tail-lines agents-tail-report">
                {a.status === "stopped"
                  ? "Stopped from Relay."
                  : plain(a.script.report)}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** 3: the list on the left previews the agent you point at on the right. */
function PeekCard({
  batch,
  onOpen,
}: {
  batch: AgentState[];
  onOpen: (id: string) => void;
}) {
  const [focus, setFocus] = useState<string>();
  const a =
    batch.find((x) => x.script.id === focus) ?? running(batch)[0] ?? batch[0]!;
  return (
    <div className="agents-peek-body">
      <div className="agents-peek-list">
        <CardHead batch={batch} />
        {batch.map((x) => (
          <button
            key={x.script.id}
            type="button"
            className="agents-peek-item"
            aria-current={x === a}
            onMouseEnter={() => setFocus(x.script.id)}
            onFocus={() => setFocus(x.script.id)}
            onClick={() => onOpen(x.script.id)}
          >
            <span className="agents-status">
              <StatusIcon a={x} />
            </span>
            <span className="agents-name">{x.script.description}</span>
            <span className="agents-time">{took(x.elapsed)}</span>
          </button>
        ))}
      </div>
      <div className="agents-peek-detail">
        <div className="agents-peek-title">
          <b>{a.script.description}</b>
          <span>
            {a.script.type} · {a.script.model} ·{" "}
            {plural(a.calls.length, "call")}
          </span>
        </div>
        <p className="agents-peek-brief">{a.script.brief}</p>
        <p className="agents-peek-now">{nowLine(a)}</p>
        <div className="agents-peek-calls">
          {a.calls.slice(-5).map((c) => (
            <CallLine key={c.id} call={c} />
          ))}
        </div>
        <button
          type="button"
          className="text-button agents-peek-open"
          onClick={() => onOpen(a.script.id)}
        >
          Open its run
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

/** 4: bars on one clock; the running ones reach the right edge, which is now. */
function TimelineCard({
  batch,
  now,
  onOpen,
}: {
  batch: AgentState[];
  now: number;
  onOpen: (id: string) => void;
}) {
  const from = Math.min(...batch.map((a) => a.script.start));
  const span = Math.max(60, now - from);
  const at = (t: number) => ((t - from) / span) * 100;
  const step = span > 150 ? 60 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= span - step / 3; s += step) ticks.push(s);
  return (
    <>
      <CardHead batch={batch} />
      <div className="agents-lanes">
        {batch.map((a) => {
          const start = at(a.script.start);
          const end = at(a.ended ?? now);
          return (
            <button
              key={a.script.id}
              type="button"
              className={`agents-lane ${a.status}`}
              title={nowLine(a)}
              onClick={() => onOpen(a.script.id)}
            >
              <span className="agents-status">
                <StatusIcon a={a} />
              </span>
              <span className="agents-name">{a.script.description}</span>
              <span className="agents-lane-track">
                <span
                  className="agents-lane-bar"
                  style={{
                    left: `${start}%`,
                    width: `${Math.max(end - start, 1)}%`,
                  }}
                />
              </span>
              <span className="agents-time">{took(a.elapsed)}</span>
            </button>
          );
        })}
        <div className="agents-axis" aria-hidden>
          <span className="agents-axis-track">
            {ticks.map((s) => (
              <span key={s} style={{ left: `${(s / span) * 100}%` }}>
                {clock(s)}
              </span>
            ))}
            <span className="agents-axis-now">now</span>
          </span>
        </div>
      </div>
    </>
  );
}

/** 5: text only; the tooltip can't hold buttons, so the icon itself opens the runs. */
function GlanceCard({ batch }: { batch: AgentState[] }) {
  return (
    <>
      {batch.map((a) => (
        <span key={a.script.id} className="agents-glance-line">
          <span className="agents-status">
            <StatusIcon a={a} size={12} />
          </span>
          <span className="agents-name">{a.script.description}</span>
          <span className="agents-glance-now">
            {a.status === "running"
              ? (a.summary ?? "Starting…")
              : took(a.elapsed)}
          </span>
        </span>
      ))}
      <span className="agents-glance-hint">Click to open their runs</span>
    </>
  );
}
