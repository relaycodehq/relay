import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, MonitorCheck, MonitorUp } from "lucide-react";
import type { ChatSummary } from "../../shared/projects";
import type { HandoffView } from "../../shared/handoff";
import { api } from "../lib/api";
import "./waiting-strip.css";
import "./handoff.css";

/** The composer's placeholder while the thread is elsewhere, or on its way. */
export function awayPlaceholder(chat: ChatSummary) {
  const { sentTo, cameFrom } = chat;
  if (sentTo?.state === "sending")
    return sentTo.error
      ? "The handoff didn't finish. Try again, or keep the thread here."
      : `Handing off to ${sentTo.computer}…`;
  if (sentTo)
    return `This thread is on ${sentTo.computer}. Bring it back to continue here.`;
  if (cameFrom?.returnedAt)
    return `This thread continues on ${cameFrom.computer}.`;
}

/** What the strip says about a thread on another computer. */
export function handoffLine(view: HandoffView): {
  title: string;
  detail?: string;
  failed?: boolean;
} {
  const { sentTo, online, remote } = view;
  const where = sentTo.computer;
  if (sentTo.error)
    return {
      title:
        sentTo.state === "returning"
          ? `Couldn't bring it back from ${where}`
          : `Couldn't hand off to ${where}`,
      detail: sentTo.error,
      failed: true,
    };
  if (sentTo.state === "sending")
    return {
      title: `Handing off to ${where}`,
      detail: "stopping the agent, writing the note, committing, sending…",
    };
  if (sentTo.state === "returning")
    return {
      title: `Bringing it back from ${where}`,
      detail: "the agent there stops and writes a note first…",
    };
  if (!online || !remote)
    return { title: `On ${where}`, detail: "can't reach it right now" };
  if (remote.waiting)
    return { title: `On ${where}`, detail: "waiting for an answer there" };
  if (remote.running) return { title: `Working on ${where}` };
  if (remote.failed)
    return {
      title: `Stopped on ${where}`,
      detail: remote.failed.split("\n")[0],
      failed: true,
    };
  return {
    title: `${where} finished`,
    ...(remote.latest ? { detail: remote.latest.split("\n")[0] } : {}),
  };
}

/**
 * A thread that's on another computer, or on its way there or back. Docked
 * on the composer like the waiting strip; the composer stays shut meanwhile.
 */
export function HandoffStrip({
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
  const data = view.data;
  // The summary catches up once the handoff settles, or ends.
  const phase = data ? `${data.sentTo.state}:${!!data.sentTo.error}` : "here";
  const seen = useRef(phase);
  useEffect(() => {
    if (seen.current === phase) return;
    seen.current = phase;
    void qc.invalidateQueries({ queryKey: ["project-chats"] });
    void qc.invalidateQueries({ queryKey: ["project-chat", chat.id] });
  }, [phase]);
  if (!data) return null;
  const line = handoffLine(data);
  const act = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch(onError)
      .finally(() => {
        setBusy(false);
        void view.refetch();
      });
  };
  const { sentTo } = data;
  return (
    <div
      className={`waiting-strip handoff-strip ${line.failed ? "failed" : ""}`}
      role="status"
    >
      <div className="waiting-strip-head">
        {line.failed ? (
          <CircleAlert size={15} />
        ) : sentTo.state === "away" && !data.remote?.running ? (
          <MonitorCheck size={15} />
        ) : (
          <MonitorUp size={15} />
        )}
        <span className="waiting-strip-text" title={line.detail}>
          <b>{line.title}</b>
          {line.detail && <span> · {line.detail}</span>}
        </span>
        {sentTo.state === "sending" && sentTo.error && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.keepThreadHere(chat.id))}
            >
              Keep it here
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={busy}
              onClick={() => act(() => api.retryHandoff(chat.id))}
            >
              Try again
            </button>
          </>
        )}
        {(sentTo.state === "away" ||
          (sentTo.state === "returning" && sentTo.error)) && (
          <button
            type="button"
            className="primary-action"
            disabled={busy || !data.online}
            title={
              data.online
                ? `Stop the work on ${sentTo.computer} and carry on here`
                : `${sentTo.computer} has to be reachable to bring it back`
            }
            onClick={() => act(() => api.bringBackThread(chat.id))}
          >
            {sentTo.error ? "Try again" : "Bring back"}
          </button>
        )}
      </div>
    </div>
  );
}

/** A copy that went back to the computer it came from. */
export function ReturnedStrip({ computer }: { computer: string }) {
  return (
    <div className="waiting-strip settled" role="status">
      <div className="waiting-strip-head">
        <MonitorCheck size={15} />
        <span className="waiting-strip-text">
          <b>Back on {computer}</b>
          <span> · it continues there; this copy stays as it was</span>
        </span>
      </div>
    </div>
  );
}
