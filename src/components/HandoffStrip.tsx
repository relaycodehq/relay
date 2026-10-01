import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { CircleAlert, MonitorCheck, MonitorUp } from "lucide-react";
import type { ChatSummary } from "../../shared/projects";
import type { HandoffView } from "../../shared/handoff";
import { liveLabel } from "../../shared/activity-labels";
import { api } from "../lib/api";
import { readDraft, writeDraft } from "../lib/drafts";
import { threadDraftKey } from "../lib/thread-storage";
import { canPeek, remoteCall, RemotePeek } from "./RemotePeek";
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

/** What the thread is asked to do once it's back with work that didn't land. */
function resolveReturnPrompt(chat: ChatSummary) {
  const { sentTo, worktree } = chat;
  const ref = `refs/relay/handoffs/${sentTo!.id}`;
  const branch = worktree?.branch ?? "this branch";
  return [
    `Your work from ${sentTo!.computer} came back but couldn't land: \`${branch}\` got new commits here while you were away, and both change ${(sentTo!.conflicts ?? []).map((f) => `\`${f}\``).join(", ")}.`,
    "",
    `Your commits are at \`${ref}\`. Apply them onto \`${branch}\` with \`git cherry-pick HEAD..${ref}\` and resolve the conflicts as they come, keeping what both sides meant. If one needs a judgement call, stop and ask me.`,
    "",
    `Once they're all in, delete the ref with \`git update-ref -d ${ref}\`. Don't push.`,
  ].join("\n");
}

/** What the strip says about a thread on another computer. */
function handoffLine(view: HandoffView): {
  title: string;
  detail?: string;
  failed?: boolean;
} {
  const { sentTo, online, remote } = view;
  const where = sentTo.computer;
  if (sentTo.conflicts?.length)
    return {
      title: `Its work from ${where} clashes with this worktree`,
      detail: `both sides changed ${sentTo.conflicts.join(", ")}`,
      failed: true,
    };
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
  if (remote.running) {
    const call = remoteCall(view);
    return {
      title: `Working on ${where}`,
      ...(call ? { detail: liveLabel(call) } : {}),
    };
  }
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
        {canPeek(data) ? (
          <Popover.Root>
            <Popover.Trigger
              openOnHover
              delay={150}
              closeDelay={250}
              className="waiting-strip-text handoff-strip-peek"
            >
              <b>{line.title}</b>
              {line.detail && <span> · {line.detail}</span>}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                side="top"
                align="start"
                sideOffset={10}
                collisionPadding={12}
              >
                <Popover.Popup
                  className="subagents-card remote-peek-card"
                  aria-label={`What ${sentTo.computer} is doing`}
                >
                  <RemotePeek view={data} />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <span className="waiting-strip-text" title={line.detail}>
            <b>{line.title}</b>
            {line.detail && <span> · {line.detail}</span>}
          </span>
        )}
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
            className={sentTo.conflicts?.length ? undefined : "primary-action"}
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
        {sentTo.state === "returning" && !!sentTo.conflicts?.length && (
          <button
            type="button"
            className="primary-action"
            disabled={busy || !data.online}
            title="Bring it back with its work set aside, and ask it to replay that work here"
            onClick={() => {
              const key = threadDraftKey(chat.id),
                draft = readDraft(key).trim();
              const prompt = resolveReturnPrompt({ ...chat, sentTo });
              writeDraft(key, draft ? `${prompt}\n\n${draft}` : prompt);
              act(() => api.bringBackThread(chat.id, true));
            }}
          >
            Bring back to resolve
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
