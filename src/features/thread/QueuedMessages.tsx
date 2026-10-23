import { BrowserAnnotationChip } from "../images/BrowserAnnotationChip";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { onlyImageTokens } from "../../../shared/image-refs";
import type { ProjectFileLink } from "../../../shared/project-file-links";
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
import { SentMemes, useSentMemes } from "../memes/SentMemes";
import { ImageThumbnail } from "../images/ImagePreview";
import { ImageViewer } from "../images/ImageViewer";
import { CodeReferenceList } from "./CodeReferenceChip";
import type { SentImage } from "./SentPills";
import { pilledImages, UserText } from "./UserText";
import { useDragSort } from "../../lib/useDragSort";
import "./queued-messages.css";

/** A queued screenshot as a sent one: it has no id yet, so it loads from what the queue holds. */
function queuedImages(input: ProjectChatSend): SentImage[] {
  return (input.images ?? []).map((image, i) => ({
    image: {
      id: `${input.id}-${i}`,
      name: image.name,
      mimeType: image.mimeType,
      browser: image.browser,
      sizeBytes: Math.floor(
        ((image.dataUrl.length - image.dataUrl.indexOf(",") - 1) * 3) / 4,
      ),
    },
    preview: {
      key: `queued:${input.id}:${i}`,
      name: image.name,
      load: () => Promise.resolve(image.dataUrl),
    },
  }));
}

/** A queued message as it will read once sent: its screenshots, code references, memes and pills. */
function QueuedBody({
  input,
  projectRoot,
  onOpenFile,
}: {
  input: ProjectChatSend;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const [viewing, setViewing] = useState<string>();
  const code = useMemo(() => parseCodeReferences(input.body), [input.body]);
  const said = code.body.replace(agentMentionPattern, "");
  const text = onlyImageTokens(said) ? "" : said;
  const memes = useSentMemes(text);
  const images = useMemo(() => queuedImages(input), [input]);
  const pilled = useMemo(() => pilledImages(text), [text]);
  const strip = images.filter(
    (sent, i) => !pilled.has(i + 1) && !sent.image.browser,
  );
  const previews = images.map((sent) => sent.preview);
  const viewingIndex = previews.findIndex((image) => image.key === viewing);
  return (
    <>
      {images
        .filter((sent) => sent.image.browser)
        .map(({ image, preview }) => (
          <BrowserAnnotationChip
            key={image.id}
            annotation={image.browser!}
            image={preview}
            onOpen={() => setViewing(preview.key)}
          />
        ))}
      {!!strip.length && (
        <div className="message-images">
          {strip.map(({ preview }) => (
            <ImageThumbnail
              key={preview.key}
              image={preview}
              onOpen={() => setViewing(preview.key)}
            />
          ))}
        </div>
      )}
      {!!code.refs.length && (
        <CodeReferenceList
          references={code.refs}
          onOpen={(ref) =>
            onOpenFile({ path: ref.path, line: ref.start, directory: false })
          }
        />
      )}
      {!!memes.memes.length && <SentMemes memes={memes.memes} />}
      {!!memes.rest?.trim() && (
        <UserText
          text={memes.rest}
          skills={input.skills}
          images={images}
          onOpenImage={setViewing}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
        />
      )}
      {viewingIndex >= 0 && (
        <ImageViewer
          images={previews}
          index={viewingIndex}
          onIndex={(index) => setViewing(previews[index].key)}
          onClose={() => setViewing(undefined)}
        />
      )}
    </>
  );
}
/** A queued compaction: what it does, and the instructions it carries. */
function QueuedCompact({ body }: { body: string }) {
  const instructions = compactInstructions(body);
  return (
    <div className="user-text">
      <p className="queued-compact">
        <Minimize2 size={13} aria-hidden /> Compact context
      </p>
      {instructions && <small>{instructions}</small>}
    </div>
  );
}
/**
 * One waiting message, shaped like the sent message it will become and dimmed
 * until hovered: its place in line, its buttons where a sent one's copy button
 * sits. Long ones fold to five lines and open with a click.
 */
function QueuedRow({
  order,
  sortable,
  text,
  when,
  justDropped,
  children,
  actions,
}: {
  order?: number;
  sortable?: boolean;
  /** The message's text, to measure again whether it folds when it changes. */
  text: string;
  /** Where a sent message shows its time. */
  when?: ReactNode;
  justDropped?: () => boolean;
  children: ReactNode;
  actions: ReactNode;
}) {
  const row = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const box = row.current?.querySelector(":scope > .user-text");
    if (!box || open) return;
    const measure = () => setLong(box.scrollHeight > box.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text, open]);
  return (
    <li
      ref={row}
      className={[
        "project-message user queued-message",
        sortable && "sortable",
        long && "long",
        open && "open",
      ]
        .filter(Boolean)
        .join(" ")}
      title={sortable ? "Drag to reorder" : undefined}
      onClick={(e) => {
        // Only the text box folds; its pills, and the viewer a screenshot opens, keep their clicks.
        const target = e.target as Element;
        const box = target.closest?.(".user-text");
        if (
          !box ||
          target.closest("button, a") ||
          box.parentElement !== row.current
        )
          return;
        if (!justDropped?.() && (long || open)) setOpen(!open);
      }}
    >
      {order !== undefined && (
        <span className="queued-order" aria-hidden>
          <span>{order}</span>
          {sortable && <GripVertical size={13} />}
        </span>
      )}
      <header>
        <strong>You</strong>
        {when}
        <span className="queued-actions">{actions}</span>
      </header>
      {children}
      {(long || open) && (
        <button
          type="button"
          className="queued-expand"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
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
  projectRoot,
  onOpenFile,
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
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const sendKey = useSendKey();
  const runningAction = useRunningSendAction();
  const editKey = useShortcutLabel("edit-queued");
  const sort = useDragSort(
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
                  {queued.compact ? (
                    <QueuedCompact body={queued.input.body} />
                  ) : (
                    <QueuedBody
                      input={queued.input}
                      projectRoot={projectRoot}
                      onOpenFile={onOpenFile}
                    />
                  )}
                  {paused && queued.error && (
                    <small className="queued-error">{queued.error}</small>
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
                  when={
                    scheduled.error ? (
                      <span className="queued-error" title={scheduled.error}>
                        Didn't send
                      </span>
                    ) : (
                      <time
                        dateTime={new Date(scheduled.at).toISOString()}
                        title={new Date(scheduled.at).toLocaleString()}
                      >
                        Sends {wakeLabel(scheduled.at, new Date())}
                      </time>
                    )
                  }
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
                  <QueuedBody
                    input={scheduled.input}
                    projectRoot={projectRoot}
                    onOpenFile={onOpenFile}
                  />
                </QueuedRow>
              ))}
          </ol>
        </section>
      )}
    </>
  );
}
