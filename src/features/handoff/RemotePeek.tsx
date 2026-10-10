// What a thread on another computer is up to: its last calls, and what its
// agent last said or asks. Its strip and its activity card show it on hover.
// Still, like the subagents card; the strip's own line is what changes.
import { inputBlocksThread } from "../../../shared/thread-state";
import type { HandoffView } from "../../../shared/handoff";
import type { AgentActivity } from "../../../shared/projects";
import { doneLabel, liveLabel, plural } from "../../../shared/activity-labels";
import { agentName } from "../../../shared/agents";
import { modelName, took } from "../../../shared/subagents";
import { useNow } from "../../lib/useNow";
import { activityIcons } from "../agent-turn/Subagents";
import "./handoff.css";

/** The call its agent is on, while it works. */
export function remoteCall(view: HandoffView): AgentActivity | undefined {
  const remote = view.online ? view.remote : undefined;
  if (!remote?.running || inputBlocksThread(remote)) return;
  return [...(remote.recent ?? [])]
    .reverse()
    .find((c) => c.status === "running");
}

/** Whether there's anything to peek at: the thread is there, and was heard from. */
export const canPeek = (view: HandoffView | undefined) =>
  !!view?.remote && view.sentTo.state === "away" && !view.sentTo.error;

function heading(view: HandoffView) {
  const { remote, online } = view;
  const where = view.sentTo.computer;
  if (!online) return `On ${where}`;
  if (remote && inputBlocksThread(remote)) return `Waiting for you on ${where}`;
  if (remote?.running) return `Working on ${where}`;
  if (remote?.failed) return `Stopped on ${where}`;
  return `${where} finished`;
}

export function RemotePeek({ view }: { view: HandoffView }) {
  const now = useNow(1000);
  const remote = view.remote!;
  const where = view.sentTo.computer;
  const live = view.online && remote.running && !inputBlocksThread(remote);
  // A Relay from before the peek says whether it works, and nothing more.
  if (remote.calls === undefined)
    return (
      <div className="remote-peek">
        <b className="remote-peek-title">{heading(view)}</b>
        <p className="remote-peek-note">
          {where} runs an older Relay that only says whether it's working.
          Update it from Settings → Computers to see what it's doing.
        </p>
      </div>
    );
  const meta = [
    remote.provider && agentName(remote.provider),
    remote.model && modelName(remote.model),
    plural(remote.calls, "call"),
    view.online &&
      remote.running &&
      remote.runningSince &&
      took(now - remote.runningSince),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="remote-peek">
      <div className="subagents-title">
        <b>{heading(view)}</b>
        <span>{meta}</span>
      </div>
      {!view.online ? (
        <p className="remote-peek-note">
          Can't reach {where} right now. This is where it was{" "}
          {took(now - remote.updated)} ago.
        </p>
      ) : inputBlocksThread(remote) ? (
        <p className="remote-peek-quote">
          {remote.question ?? "Its agent is waiting for an answer there."}
        </p>
      ) : remote.running ? (
        remote.says && <p className="subagents-now">{remote.says}</p>
      ) : remote.failed ? (
        <p className="remote-peek-quote failed">
          {remote.failed.split("\n")[0]}
        </p>
      ) : (
        remote.latest && <p className="remote-peek-quote">{remote.latest}</p>
      )}
      <PeekCalls calls={remote.recent ?? []} live={!!live} />
    </div>
  );
}

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
