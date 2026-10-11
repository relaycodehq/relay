import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorOff, MonitorUp } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { api } from "../../lib/api";
import { AbandonDialog } from "./AbandonDialog";
import "./handoff.css";

/**
 * A thread followed live from another computer: it reads and answers as if
 * it ran here, so all that tells it apart is this quiet line.
 */
export function LiveAwayLine({
  chat,
  onError,
}: {
  chat: ChatSummary;
  onError: (error: unknown) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const view = useQuery({
    queryKey: ["handoff-view", chat.id],
    queryFn: () => api.handoffView(chat.id),
    refetchInterval: 3000,
  });
  const computer = chat.sentTo!.computer;
  const online = view.data?.online ?? true;
  const bringBack = () => {
    setBusy(true);
    api
      .bringBackThread(chat.id)
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
        void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
      });
  };
  return (
    <>
      <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
        {online ? <MonitorUp size={12} /> : <MonitorOff size={12} />}
        <span>
          {online
            ? `Running on ${computer}`
            : `${computer} is offline · it carries on there`}
        </span>
        {online ? (
          <button
            type="button"
            disabled={busy}
            title={`Stop the work on ${computer} and carry on here`}
            onClick={bringBack}
          >
            Bring back
          </button>
        ) : (
          <button
            type="button"
            title={`If ${computer} can't hand it back: unlock it here as it left`}
            onClick={() => setAbandoning(true)}
          >
            Take it back without {computer}
          </button>
        )}
      </div>
      {abandoning && (
        <AbandonDialog
          chatId={chat.id}
          computer={computer}
          onClose={() => setAbandoning(false)}
        />
      )}
    </>
  );
}
