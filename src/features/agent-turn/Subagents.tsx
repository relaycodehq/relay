// The subagents Claude has working, beside the Current checkout control: an
// icon with how many are back, and a card previewing each. The latest fan-out
// stays, quiet once it's back, until the next starts; older ones fold away in
// the card. Each opens its own run in a side thread.
import { useState } from "react";
import { useNow } from "../../lib/useNow";
import { Popover } from "@base-ui/react/popover";
import {
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  CircleX,
  FilePen,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { AgentActivity } from "../../../shared/projects";
import { doneLabel, liveLabel, plural } from "../../../shared/activity-labels";
import {
  modelName,
  subagentNow,
  took,
  type SubagentRun,
} from "../../../shared/subagents";
import "./subagents.css";
import "../changes/branch-picker.css";

/** A call's icon by its kind. */
export const activityIcons = {
  command: Terminal,
  read: FileText,
  file: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  tool: Wrench,
} satisfies Record<AgentActivity["kind"], unknown>;

/**
 * Still, even while it works: the turn's running row is what moves, and a
 * card of spinners beside it would be several more. Its ticking time says
 * it's alive.
 */
export function SubagentStatus({ run }: { run: SubagentRun }) {
  return (
    <span className="subagent-status">
      {run.status === "running" ? (
        <span className="subagent-dot" aria-label="Working" />
      ) : run.status === "completed" ? (
        <Check size={13} className="subagent-done" aria-label="Done" />
      ) : run.status === "failed" ? (
        <CircleX size={13} aria-label="Failed" />
      ) : (
        <CircleStop size={13} aria-label="Stopped" />
      )}
    </span>
  );
}

export function SubagentsIndicator({
  batch,
  earlier,
  projectRoot,
  onOpen,
  onStop,
}: {
  /** The latest fan-out: every agent that overlapped another in it. */
  batch: SubagentRun[];
  /** The fan-outs before it, newest first. */
  earlier: SubagentRun[][];
  projectRoot: string;
  onOpen: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const working = batch.filter((r) => r.status === "running").length;
  const done = batch.length - working;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className={`composer-branch-trigger subagents-chip${working ? "" : " back"}`}
        aria-label={`${plural(batch.length, "subagent")}: ${done} done, ${working} working`}
      >
        <Bot size={14} />
        <span>
          {!working
            ? `${done} done`
            : batch.length === 1
              ? 1
              : `${done}/${batch.length}`}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup className="subagents-card" aria-label="Subagents">
            <Peek
              batch={batch}
              earlier={earlier}
              projectRoot={projectRoot}
              onOpen={(id) => {
                setOpen(false);
                onOpen(id);
              }}
              onStop={onStop}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The agents on the left; the one you point at previews on the right. */
function Peek({
  batch,
  earlier,
  projectRoot,
  onOpen,
  onStop,
}: {
  batch: SubagentRun[];
  earlier: SubagentRun[][];
  projectRoot: string;
  onOpen: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const now = useNow(1000);
  const [focus, setFocus] = useState<string>();
  // Stays pressed until the agent's status says it stopped.
  const [stopping, setStopping] = useState<string>();
  const [showEarlier, setShowEarlier] = useState(false);
  const working = batch.filter((r) => r.status === "running");
  const run =
    [...batch, ...earlier.flat()].find((r) => r.id === focus) ??
    working[0] ??
    batch[0]!;
  const root = projectRoot.replace(/\/+$/, "") + "/";
  const display = (text: string) => text.split(root).join("");
  const row = (r: SubagentRun) => (
    <button
      key={r.id}
      type="button"
      className="subagents-item"
      aria-current={r === run}
      onMouseEnter={() => setFocus(r.id)}
      onFocus={() => setFocus(r.id)}
      onClick={() => onOpen(r.id)}
    >
      <SubagentStatus run={r} />
      <span className="subagents-name">{r.description}</span>
      <span className="subagents-time">
        {took((r.ended ?? now) - r.started)}
      </span>
    </button>
  );
  return (
    <div className="subagents-peek">
      <div className="subagents-list">
        <div className="subagents-card-head">
          <b>Subagents</b>
          <span>
            {batch.length - working.length} of {batch.length} done
          </span>
        </div>
        {batch.map(row)}
        {earlier.length > 0 && (
          <button
            type="button"
            className="subagents-earlier"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier((v) => !v)}
          >
            <ChevronRight size={12} />
            Earlier
          </button>
        )}
        {showEarlier &&
          earlier.map((fanOut) => (
            <div key={fanOut[0]!.id} className="subagents-fan-out">
              <span className="subagents-fan-out-time">
                {new Date(fanOut[0]!.started).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {fanOut.map(row)}
            </div>
          ))}
      </div>
      <div className="subagents-detail">
        <div className="subagents-title">
          <b>{run.description}</b>
          <span>
            {[
              run.type !== "general-purpose" && run.type,
              run.model && modelName(run.model),
              plural(run.calls, "call"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {run.brief && <p className="subagents-brief">{run.brief}</p>}
        <p className="subagents-now">{subagentNow(run, display)}</p>
        <div className="subagents-calls">
          {run.recent.map((call) => {
            const Icon = activityIcons[call.kind];
            const live = call.status === "running";
            return (
              <span
                key={call.id}
                className={`subagents-call${live ? " live" : ""}`}
              >
                <Icon size={12} />
                <span className={call.kind === "command" ? "mono" : undefined}>
                  {display(live ? liveLabel(call) : doneLabel(call))}
                </span>
              </span>
            );
          })}
        </div>
        <div className="subagents-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => onOpen(run.id)}
          >
            Open its run
            <ChevronRight size={13} />
          </button>
          {run.status === "running" && (
            <button
              type="button"
              className="text-button"
              disabled={stopping === run.id}
              onClick={() => {
                setStopping(run.id);
                onStop(run.id).catch(() => setStopping(undefined));
              }}
            >
              {stopping === run.id ? "Stopping…" : "Stop agent"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
