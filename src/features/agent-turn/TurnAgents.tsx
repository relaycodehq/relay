// The agents a finished turn sent off, in its heading while any still works:
// their agents' marks overlap, a spinner on each one working and a check on
// each one back, and a card on hover lists them and opens each one's run.
import { createContext, useContext, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import type { AgentActivity } from "../../../shared/projects";
import { plural } from "../../../shared/activity-labels";
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
export function useWorkingAgents(activity: AgentActivity[]) {
  const runs = useContext(TurnAgents)?.runs ?? [];
  const started = new Set(
    activity.filter((a) => a.kind === "agent").map((a) => a.id),
  );
  const mine = runs.filter((r) => started.has(r.id));
  return mine.some((r) => r.status === "running") ? mine : [];
}

/** "Ran 4 commands · 1 of 3 agents back": the rest of the turn, then its agents. */
export function workingAgentsLabel(rest: string, runs: SubagentRun[]) {
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

export function TurnAgentStack({ runs }: { runs: SubagentRun[] }) {
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
