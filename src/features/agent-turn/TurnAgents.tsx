// The agents a finished turn sent off, in its heading while any still works,
// as marks with a card that opens each one's run.
import { createContext, useContext, type ReactNode } from "react";
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
import { AgentMarks, AgentMarksRow, type MarkState } from "./AgentMarks";

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
      <span className="agent-marks-lead">{agents}</span>
    </>
  );
}

const markState = (run: SubagentRun): MarkState | undefined =>
  run.status === "running"
    ? "working"
    : run.status === "completed"
      ? "done"
      : undefined;

function standing(run: SubagentRun, now: number): ReactNode {
  const time = took((run.ended ?? now) - run.started);
  switch (run.status) {
    case "running":
      return `working ${time}`;
    case "completed":
      return (
        <>
          <span className="agent-marks-done">back</span> after {time}
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
  const back = runs.filter((r) => r.status !== "running").length;
  return (
    <AgentMarks
      marks={runs.map((run) => ({
        id: run.id,
        provider: run.provider ?? "claude",
        state: markState(run),
      }))}
      label={`${plural(runs.length, "agent")}: ${back} back`}
      cardLabel="Agents"
      card={(close) => <AgentsCard runs={runs} close={close} />}
    />
  );
}

function AgentsCard({
  runs,
  close,
}: {
  runs: SubagentRun[];
  close: () => void;
}) {
  const onOpen = useContext(TurnAgents)!.onOpen;
  const now = useNow(1000);
  const back = runs.filter((r) => r.status !== "running").length;
  return (
    <>
      <div className="agent-marks-head">
        <b>Agents</b>
        <span>
          {back} of {runs.length} back
        </span>
      </div>
      {runs.map((run) => (
        <AgentMarksRow
          key={run.id}
          provider={run.provider ?? "claude"}
          state={markState(run)}
          name={run.description}
          meta={[
            agentKind(run) !== "Agent" && run.type,
            run.model && modelName(run.model),
            run.effort && effortName(run.effort),
            plural(run.calls, "call"),
          ]
            .filter(Boolean)
            .join(" · ")}
          aside={standing(run, now)}
          onClick={() => {
            close();
            onOpen(run.id);
          }}
        />
      ))}
    </>
  );
}
