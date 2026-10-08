import { useState } from "react";
import { ArrowUp, CalendarClock, Clock3, X } from "lucide-react";
import { agentMentionPattern } from "../../../shared/agents";
import { wakeLabel } from "../../../shared/chat-activity";
import { parseCodeReferences } from "../../../shared/code-references";
import { pastedTexts, replacePastedTexts } from "../../../shared/pasted-texts";
import type {
  ProjectChat as ProjectChatData,
  ProjectChatSend,
} from "../../../shared/projects";
import type { QueueDrop } from "./chat-queue";
import {
  queueKeyLabel,
  steerKeyLabel,
  useRunningSendAction,
  useSendKey,
} from "../../lib/send-key";
import { useShortcutLabel } from "../../lib/shortcuts";
import { Spinner } from "../../ui/ui";
import "./queued-messages.css";

/** A queued message's text, with its attachments counted rather than shown. */
function QueuedBody({ input }: { input: ProjectChatSend }) {
  const code = parseCodeReferences(input.body);
  const pastes = pastedTexts(code.body);
  const body = replacePastedTexts(code.body, () => "\n\n").trim();
  return (
    <>
      <p>{body.replace(agentMentionPattern, "")}</p>
      {!!code.refs.length && (
        <small>{code.refs.length} code reference(s)</small>
      )}
      {!!input.images?.length && (
        <small>{input.images.length} screenshot(s)</small>
      )}
      {!!pastes.length && <small>{pastes.length} pasted text(s)</small>}
    </>
  );
}
/** Drag type for reordering queued messages, so other drops are ignored. */
const QUEUED_DRAG = "application/x-relay-queued-message";

/** The messages waiting to go: queued behind the answer, reordered by dragging, and scheduled for later. */
export function QueuedMessages({
  queue,
  paused,
  scheduled,
  running,
  compacting,
  busy,
  onSteer,
  onMove,
  onReturn,
}: {
  queue?: ProjectChatData["queue"];
  paused?: boolean;
  scheduled?: ProjectChatData["scheduled"];
  running: boolean;
  /** The running turn compacts the session: it can't be steered, the queue goes once it's done. */
  compacting: boolean;
  busy: boolean;
  /** Sends it now, or steers the running answer with it. */
  onSteer: (messageId: string) => void;
  onMove: (messageId: string, target: QueueDrop) => void;
  /** Takes it out of the queue, back into the composer. */
  onReturn: (input: ProjectChatSend) => void;
}) {
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  const editKey = useShortcutLabel("edit-queued");
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<QueueDrop | null>(null);
  const clearDrag = () => {
    setDragging(null);
    setDrop(null);
  };
  function dropped() {
    const moving = dragging,
      target = drop;
    clearDrag();
    if (moving && target) onMove(moving, target);
  }
  return (
    <>
      {!!queue?.length && (
        <section className="chat-queue" aria-label="Queued messages">
          {queue.map((queued, index) => {
            const afterCompaction = compacting && !paused && index === 0;
            return (
              <div
                key={queued.input.id}
                className={[
                  "queued-message",
                  dragging === queued.input.id && "dragging",
                  drop?.id === queued.input.id &&
                    dragging !== queued.input.id &&
                    `drop-${drop.where}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={queue.length > 1 && !busy}
                title={queue.length > 1 ? "Drag to reorder" : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData(QUEUED_DRAG, queued.input.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(queued.input.id);
                }}
                onDragEnd={clearDrag}
                onDragOver={(e) => {
                  if (!dragging || !e.dataTransfer.types.includes(QUEUED_DRAG))
                    return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const box = e.currentTarget.getBoundingClientRect(),
                    where =
                      e.clientY < box.top + box.height / 2 ? "before" : "after";
                  setDrop((current) =>
                    current?.id === queued.input.id && current.where === where
                      ? current
                      : { id: queued.input.id, where },
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropped();
                }}
              >
                <QueuedBody input={queued.input} />
                <footer>
                  <span
                    className="queued-status"
                    title={
                      paused
                        ? (queued.error ?? "Waits for Send now")
                        : index === 0
                          ? "Sends when the current answer finishes"
                          : "Sends after the messages above it"
                    }
                  >
                    {afterCompaction ? (
                      <>
                        <Spinner size={13} steady /> Sends after compaction
                      </>
                    ) : (
                      <>
                        <Clock3 size={13} /> {paused ? "Paused" : "Queued"}
                      </>
                    )}
                  </span>
                  <span className="queued-actions">
                    <button
                      type="button"
                      disabled={busy || afterCompaction}
                      aria-label={
                        compacting
                          ? "Send right after compaction"
                          : running
                            ? "Steer now"
                            : "Send now"
                      }
                      title={
                        afterCompaction
                          ? "Already sends as soon as compaction finishes"
                          : compacting
                            ? "A compaction can't be steered; send this right after it"
                            : running
                              ? "Steer the current answer, or send this next when it can't be steered"
                              : "Send now"
                      }
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onSteer(queued.input.id)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label="Cancel and return to the composer"
                      title="Cancel and return to the composer"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onReturn(queued.input)}
                    >
                      <X size={14} />
                    </button>
                  </span>
                </footer>
              </div>
            );
          })}
          {running && !compacting && (
            <p className="chat-queue-hint">
              <kbd>{queueKeyLabel(sendKey, runningAction)}</kbd> to queue ·{" "}
              <kbd>{steerKeyLabel(sendKey, runningAction)}</kbd> to steer
              {editKey && (
                <>
                  {" "}
                  · <kbd>{editKey}</kbd> to edit the last
                </>
              )}
            </p>
          )}
        </section>
      )}
      {!!scheduled?.length && (
        <section className="chat-queue" aria-label="Scheduled messages">
          {[...scheduled]
            .sort((a, b) => a.at - b.at)
            .map((scheduled) => (
              <div key={scheduled.input.id} className="queued-message">
                <QueuedBody input={scheduled.input} />
                <footer>
                  <span
                    className={`queued-status${scheduled.error ? " error" : ""}`}
                    title={
                      scheduled.error ?? new Date(scheduled.at).toLocaleString()
                    }
                  >
                    <CalendarClock size={13} />{" "}
                    {scheduled.error
                      ? "Didn't send"
                      : `Sends ${wakeLabel(scheduled.at, new Date())}`}
                  </span>
                  <span className="queued-actions">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label="Send now"
                      title={
                        running
                          ? "Queue now, to send when the current answer finishes"
                          : "Send now"
                      }
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onSteer(scheduled.input.id)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label="Cancel and return to the composer"
                      title="Cancel and return to the composer"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => onReturn(scheduled.input)}
                    >
                      <X size={14} />
                    </button>
                  </span>
                </footer>
              </div>
            ))}
        </section>
      )}
    </>
  );
}
