import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorOff, MonitorUp, Server, ServerOff } from "lucide-react";
import type { ChatSummary, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { chatKey, fetchChat } from "../../lib/chat-events";
import { projectComputer, usePairedComputers } from "./usePairedComputers";
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
  const view = useQuery({
    queryKey: ["handoff-view", chat.id],
    queryFn: () => api.handoffView(chat.id),
    refetchInterval: 3000,
  });
  // The thread view fetches it; this only reads along.
  const thread = useQuery({
    queryKey: chatKey(chat.id),
    queryFn: () => fetchChat(qc, chat.id),
    enabled: false,
  });
  const computer = chat.sentTo!.computer;
  const online = view.data?.online ?? true;
  // A message waiting offers it right under itself.
  const waiting = !!thread.data?.outbox?.length;
  const act = (job: () => Promise<void>) => {
    setBusy(true);
    job()
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void qc.invalidateQueries({ queryKey: ["project-chats"] });
        void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
      });
  };
  // A thread of a project that lives there: it only ever runs there.
  if (chat.sentTo!.home)
    return (
      <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
        {online ? <Server size={12} /> : <ServerOff size={12} />}
        <span>
          {online
            ? `On ${computer}`
            : `${computer} is offline · ${
                waiting ? "sends when it's back" : "reconnecting"
              }`}
        </span>
      </div>
    );
  return (
    <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
      {online ? <MonitorUp size={12} /> : <MonitorOff size={12} />}
      <span>{online ? `Running on ${computer}` : `${computer} is offline`}</span>
      {online ? (
        <button
          type="button"
          disabled={busy}
          title={`Stop the work on ${computer} and carry on here`}
          onClick={() => act(() => api.bringBackThread(chat.id))}
        >
          Bring back
        </button>
      ) : (
        !waiting && (
          <button
            type="button"
            disabled={busy}
            title={`Carry on here with the conversation; what ${computer} changed in the code stays there`}
            onClick={() => act(() => api.runThreadHere(chat.id))}
          >
            Run here instead
          </button>
        )
      )}
    </div>
  );
}

/** Before a thread starts in a project on another computer: where it'll run. */
export function HomeComputerLine({ project }: { project: Project }) {
  const computers = usePairedComputers(true);
  const where = projectComputer(project, computers.data);
  if (!where) return null;
  const online = !computers.data || where.online;
  const gone = !!computers.data?.every((c) => c.id !== where.id);
  const connecting =
    computers.data?.find((c) => c.id === where.id)?.status === "connecting";
  return (
    <div className={`handoff-live ${online ? "" : "offline"}`} role="status">
      {online ? <Server size={12} /> : <ServerOff size={12} />}
      <span>
        {online
          ? `On ${where.name}`
          : gone
            ? `${where.name} isn't paired anymore`
            : connecting
              ? `Connecting to ${where.name}…`
              : `${where.name} is offline`}
      </span>
    </div>
  );
}
