// A thread's live state in the sidebar: the mark at the end of a row, and
// the state and agents on an Activity card.
import { CalendarClock, CircleAlert } from "lucide-react";
import { agentName } from "../../../shared/agents";
import {
  elapsedLabel,
  shortAge,
  wakeLabel,
} from "../../../shared/chat-activity";
import type { ChatPending, ChatSummary } from "../../../shared/projects";
import { agentsSince } from "../../../shared/waiting";
import { inputBlocksThread } from "../../../shared/thread-state";
import { useNow } from "../../lib/useNow";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { Spinner } from "../../ui/ui";

/** Every agent used in the thread, most recently used first. */
export function CardAgents({ chat }: { chat: ChatSummary }) {
  const agents = [
    ...new Set([
      ...(chat.providers ?? (chat.provider ? [chat.provider] : [])),
      ...(chat.runningAgents ?? []),
    ]),
  ];
  if (!agents.length) return null;
  return (
    <span className="sb-card-provider" title={agents.map(agentName).join(", ")}>
      {agents.map((p) => (
        <ProviderIcon key={p} provider={p} />
      ))}
    </span>
  );
}

export function StatusMark({
  chat,
  unread,
  now,
}: {
  chat: ChatSummary;
  unread: boolean;
  now: number;
}) {
  if (inputBlocksThread(chat))
    return (
      <span className="sb-status waiting" title="Needs your input">
        <i />
      </span>
    );
  if (chat.running || agentsSince(chat.pending))
    return (
      <span
        className="sb-status running"
        title={
          chat.running
            ? chat.goal?.status === "active"
              ? `Working on its goal: ${chat.goal.objective}`
              : chat.waiting
                ? "Working · needs your input"
                : "Working"
            : pendingTitle(chat.pending!)
        }
      >
        <Spinner size={11} steady />
      </span>
    );
  if (unread)
    return (
      <span className="sb-status unread" title="New activity">
        <i />
      </span>
    );
  if (chat.pending?.length)
    return (
      <span
        className="sb-status pending"
        title="Claude will continue on its own"
      >
        <i />
      </span>
    );
  if (chat.nextSend)
    return (
      <span className="sb-status scheduled" title={sendsTitle(chat.nextSend)}>
        <CalendarClock size={12} />
      </span>
    );
  return <time className="sb-age">{shortAge(chat.updated, now)}</time>;
}

const sendsTitle = (at: number) =>
  `Sends a scheduled message ${wakeLabel(at, new Date())}`;

const pendingTitle = (pending: ChatPending[]) =>
  `Claude will continue on its own after:\n${pending
    .map((p) => (p.kind === "task" ? p.description : p.prompt || "a wake-up"))
    .join("\n")}`;

/** Right side of a card's top row: live state, else the age. */
export function CardState({
  chat,
  unread,
  now,
  stopped,
}: {
  chat: ChatSummary;
  unread: boolean;
  now: number;
  /** Its turn on another computer ended in an error. */
  stopped?: boolean;
}) {
  if (inputBlocksThread(chat))
    return (
      <span className="sb-card-state waiting">
        <i />
        Needs input
      </span>
    );
  const since = chat.running ? chat.runningSince : agentsSince(chat.pending);
  // A native /goal keeps the agent going across turns until it's met.
  const goal = chat.running && chat.goal?.status === "active";
  if (chat.running || since)
    return (
      <span
        className="sb-card-state running"
        title={
          goal
            ? `Goal: ${chat.goal!.objective}`
            : chat.running
              ? undefined
              : pendingTitle(chat.pending!)
        }
      >
        <Spinner size={11} steady />
        {goal ? "Goal" : "Working"}
        {chat.waiting && " · needs input"}
        {since && <Elapsed since={since} />}
      </span>
    );
  if (stopped)
    return (
      <span className="sb-card-state stopped">
        <CircleAlert size={12} />
        Stopped
      </span>
    );
  if (chat.snoozedUntil && chat.snoozedUntil <= now)
    return <span className="sb-card-state unread">Woke up</span>;
  if (chat.pending?.length)
    return (
      <span
        className={`sb-card-state pending ${unread ? "unread" : ""}`}
        title={pendingTitle(chat.pending)}
      >
        <i />
        Waiting
      </span>
    );
  if (chat.nextSend && !unread)
    return (
      <span
        className="sb-card-state scheduled"
        title={sendsTitle(chat.nextSend)}
      >
        <CalendarClock size={12} />
        Sends {wakeLabel(chat.nextSend, new Date(now))}
      </span>
    );
  return (
    <time className={`sb-card-state ${unread ? "unread" : ""}`}>
      {unread && <i />}
      {shortAge(chat.updated, now)}
    </time>
  );
}

/** Ticks on its own so only this label re-renders. */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  return <span className="sb-elapsed">{elapsedLabel(since, now)}</span>;
}
