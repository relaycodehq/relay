import type { AgentActivity } from "../../../shared/projects";
import { doneLabel, liveLabel } from "../../../shared/activity-labels";
import { activityIcons } from "../agent-turn/Subagents";

/** A turn's last calls, oldest first; while `live`, the running one stands out. */
export function PeekCalls({
  calls,
  live,
  className = "",
}: {
  calls: AgentActivity[];
  live: boolean;
  className?: string;
}) {
  return (
    <div className={`subagents-calls remote-peek-calls ${className}`}>
      {calls.map((call) => {
        const Icon = activityIcons[call.kind];
        const running = live && call.status === "running";
        return (
          <span
            key={call.id}
            className={`subagents-call${running ? " live" : ""}`}
          >
            <Icon size={12} />
            <span className={call.kind === "command" ? "mono" : undefined}>
              {running ? liveLabel(call) : doneLabel(call)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
