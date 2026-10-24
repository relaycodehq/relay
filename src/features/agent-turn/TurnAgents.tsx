// The agents a finished turn sent off, in its heading while any still works:
// their agents' marks overlap, a spinner on each one working and a check on
// each one back, and a card on hover lists them and opens each one's run.
import { createContext, useContext, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import type { AgentActivity, TraceDropped } from "../../../shared/projects";
import { plural, summarizeActivity } from "../../../shared/activity-labels";
import {
  agentKind,
  effortName,
  modelName,
  took,
  type SubagentRun,
} from "../../../shared/subagents";
import { useNow } from "../../lib/useNow";
import { Spinner } from "../../ui/ui";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import "./turn-agents.css";

export const TurnAgents = createContext<
  { runs: SubagentRun[]; onOpen: (id: string) => void } | undefined
>(undefined);

/** The turn's agents, in the order it started them, while any still works. */
function useWorkingAgents(activity: AgentActivity[]) {
  const runs = useContext(TurnAgents)?.runs ?? [];
  const started = new Set(
    activity.filter((a) => a.kind === "agent").map((a) => a.id),
  );
  const mine = runs.filter((r) => started.has(r.id));
  return mine.some((r) => r.status === "running") ? mine : [];
}

/**
 * A finished turn's heading icon and label, its agents in their place while
 * any still works. Only turns that started agents render this, so the runs
 * changing on each poll re-render them alone, not every turn in the thread.
 */
export function WorkingAgentsHeading({
  activity,
  dropped,
  icon,
  label,
}: {
  activity: AgentActivity[];
  dropped: TraceDropped | undefined;
  icon: ReactNode;
  label: ReactNode;
}) {
  const runs = useWorkingAgents(activity);
  if (!runs.length)
    return (
      <>
        {icon}
        {label}
      </>
    );
  const rest = summarizeActivity(
    activity.filter((a) => a.kind !== "agent"),
    dropped,
  );
  return (
    <>
      <TurnAgentStack runs={runs} />
      <span>{workingAgentsLabel(rest, runs)}</span>
    </>
  );
}

/** "Ran 4 commands · 1 of 3 agents back": the rest of the turn, then its agents. */
function workingAgentsLabel(rest: string, runs: SubagentRun[]) {
  const back = runs.filter((r) => r.status !== "running").length;
  const agents = back
    ? `${back} of ${runs.length} agents back`
    : `${plural(runs.length, "agent")} working`;
  return (
    <>
      {rest && `${rest} · `}
      <span className="turn-agents-lead">{agents}</span>
    </>
  );
}

function Mark({ run, style }: { run: SubagentRun; style?: object }) {
  return (
    <span className="turn-agent-mark" style={style}>
      <span className="turn-agent-disc">
        <ProviderIcon provider={run.provider ?? "claude"} />
      </span>
      {run.status === "running" ? (
        <span className="turn-agent-badge working">
          <Spinner size={9} steady />
        </span>
      ) : run.status === "completed" ? (
        <span className="turn-agent-badge">
          <Check size={9} strokeWidth={3.4} className="turn-agents-done" />
        </span>
      ) : null}
    </span>
  );
}

function standing(run: SubagentRun, now: number): ReactNode {
  const time = took((run.ended ?? now) - run.started);
  switch (run.status) {
    case "running":
      return `working ${time}`;
    case "completed":
      return (
        <>
          <span className="turn-agents-done">back</span> after {time}
        </>
      );
    case "failed":
      return `failed after ${time}`;
    case "stopped":
      return `stopped after ${time}`;
    case "idle":
      return time;
  }
}

function TurnAgentStack({ runs }: { runs: SubagentRun[] }) {
  const onOpen = useContext(TurnAgents)!.onOpen;
  const [open, setOpen] = useState(false);
  const now = useNow(1000);
  const back = runs.filter((r) => r.status !== "running").length;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className="turn-agents"
        aria-label={`${plural(runs.length, "agent")}: ${back} back`}
        // Inside the turn's heading, which folds open on a click.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {runs.map((run, i) => (
          <Mark key={run.id} run={run} style={{ zIndex: runs.length - i }} />
        ))}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            data-shortcut-passive
            className="turn-agents-card"
            aria-label="Agents"
          >
            <div className="turn-agents-head">
              <b>Agents</b>
              <span>
                {back} of {runs.length} back
              </span>
            </div>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className="turn-agents-item"
                onClick={() => {
                  setOpen(false);
                  onOpen(run.id);
                }}
              >
                <Mark run={run} />
                <span className="turn-agents-text">
                  <span className="turn-agents-name">{run.description}</span>
                  <span className="turn-agents-meta">
                    {[
                      agentKind(run) !== "Agent" && run.type,
                      run.model && modelName(run.model),
                      run.effort && effortName(run.effort),
                      plural(run.calls, "call"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="turn-agents-time">{standing(run, now)}</span>
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
