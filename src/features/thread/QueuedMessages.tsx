import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  CalendarClock,
  Clock3,
  GripVertical,
  Minimize2,
  X,
} from "lucide-react";
import { agentMentionPattern } from "../../../shared/agents";
import { wakeLabel } from "../../../shared/chat-activity";
import { parseCodeReferences } from "../../../shared/code-references";
import { pastedTexts, replacePastedTexts } from "../../../shared/pasted-texts";
import type {
  ProjectChat as ProjectChatData,
  ProjectChatSend,
} from "../../../shared/projects";
import type { QueueDrop } from "./chat-queue";
import { compactInstructions } from "../../../shared/commands";
import {
  queueKeyLabel,
  steerKeyLabel,
  useRunningSendAction,
  useSendKey,
} from "../../lib/send-key";
import { useShortcutLabel } from "../../lib/shortcuts";
import { Spinner } from "../../ui/ui";
import { useQueueSort } from "./useQueueSort";
import "./queued-messages.css";

/** A queued message's text, with its attachments counted rather than shown; folded, its blank lines close up. */
function QueuedBody({
  input,
  folded,
}: {
  input: ProjectChatSend;
  folded: boolean;
}) {
  const code = parseCodeReferences(input.body);
  const pastes = pastedTexts(code.body);
  const body = replacePastedTexts(code.body, () => "\n\n")
    .trim()
    .replace(agentMentionPattern, "");
  return (
    <>
      <p>{folded ? body.replace(/\n\s*\n+/g, "\n") : body}</p>
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
/** A queued compaction: what it does, and the instructions it carries. */
function QueuedCompact({ body }: { body: string }) {
  const instructions = compactInstructions(body);
  return (
    <>
      <p className="queued-compact">
        <Minimize2 size={13} aria-hidden /> Compact context
      </p>
      {instructions && <small>{instructions}</small>}
    </>
  );
}
/** One waiting message: its unsent bubble, its place in line, and its buttons on hover. Long ones fold to three lines and open with a click. */
function QueuedRow({
  order,
  sortable,
  text,
  justDropped,
  children,
  actions,
}: {
  order?: number;
  sortable?: boolean;
  /** The message's text, to measure again whether it folds when it changes. */
  text: string;
  justDropped?: () => boolean;
  children: (folded: boolean) => ReactNode;
  actions: ReactNode;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const p = bubble.current?.querySelector("p");
    if (p && !open) setLong(p.scrollHeight > p.clientHeight + 1);
  }, [text, open]);
  return (
    <li
      className={`queued-message${sortable ? " sortable" : ""}`}
      title={sortable ? "Drag to reorder" : undefined}
    >
      {order !== undefined && (
        <span className="queued-order" aria-hidden>
          <span>{order}</span>
          {sortable && <GripVertical size={13} />}
        </span>
      )}
      <div
        ref={bubble}
        className={["queued-bubble", long && "long", open && "open"]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!justDropped?.() && (long || open)) setOpen(!open);
        }}
      >
        {children(!open)}
      </div>
      <span className="queued-actions">{actions}</span>
    </li>
  );
}
/** What the queue as a whole waits for. */
function queueHeading(count: number, paused?: boolean, compacting?: boolean) {
  const what = count > 1 ? `${count} queued` : "Queued";
  if (paused) return count > 1 ? `Paused · ${count} queued` : "Paused";
  if (compacting)
    return `${what} · ${count > 1 ? "the first sends" : "sends"} after compaction`;
  return `${what} · ${count > 1 ? "sent one by one" : "sends"} after this answer`;
}

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
  onRemove,
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
  /** Drops a queued compaction, which has nothing to take back. */
  onRemove: (messageId: string) => void;
}) {
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  const editKey = useShortcutLabel("edit-queued");
  const sort = useQueueSort(
    queue?.map((q) => q.input.id) ?? [],
    (queue?.length ?? 0) > 1 && !busy,
    onMove,
  );
  return (
    <>
      {!!queue?.length && (
        <section className="chat-queue" aria-label="Queued messages">
          <header
            className="chat-queue-head"
            title={
              paused
                ? "Waits for Send now"
                : "Sends when the current answer finishes, in this order"
            }
          >
            {compacting && !paused ? (
              <Spinner size={13} steady />
            ) : (
              <Clock3 size={13} />
            )}
            {queueHeading(queue.length, paused, compacting)}
          </header>
          <ol
            className="chat-queue-list"
            ref={sort.list}
            onPointerDown={sort.onPointerDown}
          >
            {queue.map((queued, index) => {
              const afterCompaction = compacting && !paused && index === 0;
              return (
                <QueuedRow
                  key={queued.input.id}
                  order={queue.length > 1 ? index + 1 : undefined}
                  sortable={queue.length > 1 && !busy}
                  text={queued.input.body}
                  justDropped={sort.justDropped}
                  actions={
                    <>
                      {queued.compact ? (
                        !running && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Compact now"
                            title="Compact now"
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={() => onSteer(queued.input.id)}
                          >
                            <ArrowUp size={14} />
                          </button>
                        )
                      ) : (
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
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={
                          queued.compact
                            ? "Don't compact"
                            : "Cancel and return to the composer"
                        }
                        title={
                          queued.compact
                            ? "Don't compact"
                            : "Cancel and return to the composer"
                        }
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() =>
                          queued.compact
                            ? onRemove(queued.input.id)
                            : onReturn(queued.input)
                        }
                      >
                        <X size={14} />
                      </button>
                    </>
                  }
                >
                  {(folded) => (
                    <>
                      {queued.compact ? (
                        <QueuedCompact body={queued.input.body} />
                      ) : (
                        <QueuedBody input={queued.input} folded={folded} />
                      )}
                      {paused && queued.error && (
                        <small className="queued-error">{queued.error}</small>
                      )}
                    </>
                  )}
                </QueuedRow>
              );
            })}
          </ol>
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
          <header className="chat-queue-head">
            <CalendarClock size={13} /> Scheduled
          </header>
          <ol className="chat-queue-list">
            {[...scheduled]
              .sort((a, b) => a.at - b.at)
              .map((scheduled) => (
                <QueuedRow
                  key={scheduled.input.id}
                  text={scheduled.input.body}
                  actions={
                    <>
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
                    </>
                  }
                >
                  {(folded) => (
                    <>
                      <QueuedBody input={scheduled.input} folded={folded} />
                      <small
                        className={`queued-when${scheduled.error ? " queued-error" : ""}`}
                        title={
                          scheduled.error ??
                          new Date(scheduled.at).toLocaleString()
                        }
                      >
                        {scheduled.error
                          ? "Didn't send"
                          : `Sends ${wakeLabel(scheduled.at, new Date())}`}
                      </small>
                    </>
                  )}
                </QueuedRow>
              ))}
          </ol>
        </section>
      )}
    </>
  );
}
