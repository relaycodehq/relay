import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { liveAway } from "../../../shared/handoff";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { usePoll } from "../../lib/poll";

/** A thread that runs on another computer and is followed live from here. */
export interface LiveAway {
  computer: string;
  online: boolean;
  /** A thread of a project that lives there: it only ever runs there. */
  home: boolean;
  /** A message waits here to go across. */
  waiting: boolean;
  busy: boolean;
  /** Stops the work there and carries on here. */
  bringBack: () => void;
  /** Carries on here with the conversation; what changed in the code stays there. */
  runHere: () => void;
}

/** The open thread, if it runs on another computer and is followed live from here. */
export function useLiveAway(
  chat: ChatSummary | undefined,
  onError: (error: unknown) => void,
): LiveAway | undefined {
  const poll = usePoll();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const away = chat && liveAway(chat) ? chat : undefined;
  const view = useQuery({
    queryKey: ["handoff-view", away?.id],
    queryFn: () => api.handoffView(away!.id),
    enabled: !!away,
    refetchInterval: poll(3000),
  });
  // The thread view fetches it; this only reads along.
  const thread = useQuery({
    queryKey: chatKey(away?.id),
    queryFn: () => fetchChat(qc, away!.id),
    enabled: false,
  });
  if (!away) return undefined;
  const act = (job: () => Promise<void>) => {
    setBusy(true);
    job()
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
        void qc.invalidateQueries({ queryKey: ["project-chat", away.id] });
      });
  };
  return {
    computer: away.sentTo!.computer,
    online: view.data?.online ?? true,
    home: !!away.sentTo!.home,
    waiting: !!thread.data?.outbox?.length,
    busy,
    bringBack: () => act(() => api.bringBackThread(away.id)),
    runHere: () => act(() => api.runThreadHere(away.id)),
  };
}

/** Under the computer's name in the Running card: how the thread is doing there. */
export function LiveAwayStatus({ away }: { away: LiveAway }) {
  if (!away.online) return <OfflineStatus away={away} />;
  // A thread of a project that lives there has no other place to be.
  if (away.home) return null;
  return (
    <>
      <span>Handed off from here</span>
      <button
        type="button"
        disabled={away.busy}
        title={`Stop the work on ${away.computer} and carry on here`}
        onClick={away.bringBack}
      >
        Bring back
      </button>
    </>
  );
}

function OfflineStatus({ away }: { away: LiveAway }) {
  if (away.waiting) return <span>Offline · sends when it's back</span>;
  if (away.home) return <span>Offline · reconnecting</span>;
  return (
    <>
      <span>Offline</span>
      <button
        type="button"
        disabled={away.busy}
        title={`Carry on here with the conversation; what ${away.computer} changed in the code stays there`}
        onClick={away.runHere}
      >
        Run here instead
      </button>
    </>
  );
}
