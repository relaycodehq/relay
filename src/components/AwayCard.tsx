// Activity cards of threads handed off to another computer: its state laid
// over the card, the computer on the meta line, and a peek on hover.
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { PreviewCard } from "@base-ui/react/preview-card";
import { MonitorOff, MonitorUp } from "lucide-react";
import type { HandoffView } from "../../shared/handoff";
import type { ChatSummary } from "../../shared/projects";
import { api } from "../lib/api";
import { canPeek, RemotePeek } from "./RemotePeek";

/** Every away thread's view, asked every few seconds while there is one. */
export function useAwayViews(chats: ChatSummary[]) {
  const query = useQuery({
    queryKey: ["handoff-views"],
    queryFn: () => api.handoffViews(),
    enabled: chats.some((c) => c.sentTo),
    refetchInterval: 3000,
  });
  return query.data ?? {};
}

/**
 * The card as if the other computer's turn ran here: working, waiting on
 * you, and moving up and lighting up as it writes.
 */
export function withAway(chat: ChatSummary, view?: HandoffView): ChatSummary {
  const remote =
    view?.online && view.sentTo.state === "away" ? view.remote : undefined;
  if (!remote) return chat;
  return {
    ...chat,
    updated: Math.max(chat.updated, remote.updated),
    ...(remote.running
      ? {
          running: true,
          waiting: remote.waiting,
          ...(remote.runningSince ? { runningSince: remote.runningSince } : {}),
          ...(remote.provider ? { runningAgents: [remote.provider] } : {}),
        }
      : {}),
  };
}

/** The turn there stopped with an error. */
export const awayStopped = (view?: HandoffView) =>
  !!view?.online && !view.remote?.running && !!view.remote?.failed;

export function AwayWhere({ view }: { view?: HandoffView }) {
  if (!view) return null;
  const { computer } = view.sentTo;
  return view.online ? (
    <span className="sb-card-where" title={`On ${computer}`}>
      <MonitorUp size={11} />
      {computer}
    </span>
  ) : (
    <span
      className="sb-card-where offline"
      title={`Can't reach ${computer} right now`}
    >
      <MonitorOff size={11} />
      {computer}
    </span>
  );
}

/** Hovering the card shows what the other computer is doing, beside the sidebar. */
export function AwayPeek({
  view,
  children,
}: {
  view?: HandoffView;
  children: ReactElement;
}) {
  if (!view || !canPeek(view)) return children;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger render={children} delay={400} closeDelay={150} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
        >
          <PreviewCard.Popup
            className="subagents-card remote-peek-card"
            aria-label={`What ${view.sentTo.computer} is doing`}
          >
            <RemotePeek view={view} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
