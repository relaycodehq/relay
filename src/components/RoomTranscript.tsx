import { useMemo } from "react";
import { clock } from "../../shared/waiting";
import { z } from "zod";
import { ChevronDown, FileCode2, Reply, Square } from "lucide-react";
import type { RoomMessage } from "../../shared/rooms";
import { RichText } from "./ui";
import { agentName } from "../../shared/agents";

const evidenceSchema = z.object({
  lines: z
    .array(
      z.object({
        line: z.number().int().positive().max(2_000_000),
        text: z.string().max(60_000),
        selected: z.boolean(),
      }),
    )
    .max(250),
});

function CodeExcerpt({ message }: { message: RoomMessage }) {
  const lines = useMemo(() => {
    try {
      return evidenceSchema.parse(JSON.parse(message.context.excerpt!)).lines;
    } catch {
      return null;
    }
  }, [message.context.excerpt]);
  if (!lines)
    return (
      <p className="room-run-error">
        Code preview unavailable. Open the file to inspect this selection.
      </p>
    );
  return (
    <pre className="room-code-lines">
      <code>
        {lines
          .filter(
            (l) =>
              l.line >= (message.context.start ?? 1) - 3 &&
              l.line <= (message.context.end ?? 1) + 3,
          )
          .map((l) => (
            <span
              className={`room-code-line ${l.selected ? "selected" : ""}`}
              key={l.line}
            >
              <span className="room-code-number">{l.line}</span>
              <span>{l.text || " "}</span>
            </span>
          ))}
      </code>
    </pre>
  );
}

type Props = {
  messages: RoomMessage[];
  head: string;
  memberId: string;
  onSelect: (path: string) => void;
  onReply: (message: RoomMessage) => void;
  onRetry: (message: RoomMessage) => void;
  onCancel: (id: string) => void;
};

// The server stores a flat, chronological log. Keep answers next to their
// questions and collect reply branches below the original turn, without
// indefinitely nesting the transcript as people reply to one another.
export function RoomTranscript(props: Props) {
  const { messages } = props;
  const turns = useMemo(() => {
    type Turn = {
      root: RoomMessage;
      answers: RoomMessage[];
      replies: RoomMessage[];
    };
    const result: Turn[] = [],
      owners = new Map<string, Turn>();
    for (const message of messages) {
      const owner = message.parentId ? owners.get(message.parentId) : undefined;
      if (owner) {
        if (message.kind === "agent" && message.requestId === owner.root.id)
          owner.answers.push(message);
        else owner.replies.push(message);
        owners.set(message.id, owner);
      } else {
        const turn = { root: message, answers: [], replies: [] };
        result.push(turn);
        owners.set(message.id, turn);
      }
    }
    return result;
  }, [messages]);
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );
  return turns.map((turn) => (
    <section
      className="room-turn"
      key={turn.root.id}
      aria-label={`Conversation started by ${turn.root.author}`}
    >
      <TranscriptMessage {...props} message={turn.root} />
      {turn.answers.map((message) => (
        <TranscriptMessage {...props} key={message.id} message={message} />
      ))}
      {!!turn.replies.length && (
        <details className="room-replies" open>
          <summary>
            <span className="room-avatar-stack" aria-hidden="true">
              {[
                ...new Map(
                  turn.replies
                    .filter((m) => m.kind === "human")
                    .map((m) => [m.authorId, m]),
                ).values(),
              ]
                .slice(0, 3)
                .map((m) => (
                  <RoomAvatar key={m.authorId} name={m.author} />
                ))}
            </span>
            <span>
              {turn.replies.filter((m) => m.kind === "human").length}{" "}
              {turn.replies.filter((m) => m.kind === "human").length === 1
                ? "reply"
                : "replies"}
            </span>
            <ChevronDown size={12} />
          </summary>
          <div className="room-reply-thread">
            {turn.replies.map((message) => (
              <TranscriptMessage
                {...props}
                key={message.id}
                message={message}
                parent={
                  message.kind === "human" && message.parentId
                    ? byId.get(message.parentId)
                    : undefined
                }
              />
            ))}
          </div>
        </details>
      )}
    </section>
  ));
}

export function RoomAvatar({
  name,
  agent = false,
}: {
  name: string;
  agent?: boolean;
}) {
  const hue = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      className={`room-avatar ${agent ? "agent-avatar" : ""}`}
      style={
        agent
          ? undefined
          : {
              background: `light-dark(hsl(${hue} 24% 87%), hsl(${hue} 19% 32%))`,
            }
      }
      title={name}
    >
      {agent
        ? "AI"
        : name
            .split(/[\s_-]+/)
            .map((s) => s[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
    </span>
  );
}

function TranscriptMessage({
  message: m,
  parent,
  head,
  memberId,
  onSelect,
  onReply,
  onRetry,
  onCancel,
}: Props & { message: RoomMessage; parent?: RoomMessage }) {
  const agent = m.kind === "agent";
  return (
    <article
      className={`room-message ${agent ? "agent-message" : "human-message"}`}
      data-message-id={m.id}
    >
      <div className="room-message-gutter">
        <RoomAvatar
          name={agent ? `${m.provider} · ${m.author}` : m.author}
          agent={agent}
        />
      </div>
      <div className="room-message-content">
        <div className="room-message-heading">
          <strong>{agent ? agentName(m.provider ?? "codex") : m.author}</strong>
          {agent && <small>via {m.author}</small>}
          <time
            dateTime={new Date(m.createdAt).toISOString()}
            title={new Date(m.createdAt).toLocaleString()}
          >
            {clock(m.createdAt)}
          </time>
          <button
            className="room-reply-action"
            onClick={(event) => {
              const discussion = event.currentTarget
                .closest(".room-turn")
                ?.querySelector<HTMLDetailsElement>(":scope > .room-replies");
              if (discussion) discussion.open = true;
              onReply(m);
            }}
            title="Reply to this message"
            aria-label="Reply"
          >
            <Reply size={13} />
          </button>
        </div>
        {parent && (
          <blockquote className="room-quote">
            <span>{parent.body.slice(0, 180)}</span>
          </blockquote>
        )}
        {!agent &&
          m.context.path &&
          (m.context.excerpt ? (
            <details className="room-code-context">
              <summary>
                <FileCode2 size={12} />
                <span>
                  {m.context.path.split("/").at(-1)}:{m.context.start}
                  {m.context.end !== m.context.start ? `–${m.context.end}` : ""}
                </span>
                <small>
                  {m.context.side === "deletions" ? "before" : "after"}
                </small>
                <ChevronDown size={12} />
              </summary>
              <CodeExcerpt message={m} />
              <button
                className="room-context-link"
                disabled={m.context.head !== head}
                onClick={() => onSelect(m.context.path!)}
              >
                {m.context.head !== head
                  ? "Earlier PR revision"
                  : "Open in changes"}{" "}
                · {m.context.head.slice(0, 7)}
              </button>
            </details>
          ) : (
            <button
              className="room-context-link"
              title={m.context.path}
              disabled={m.context.head !== head}
              onClick={() => onSelect(m.context.path!)}
            >
              <FileCode2 size={12} />
              {m.context.path.split("/").at(-1)}
              {m.context.head !== head && <small> · earlier revision</small>}
            </button>
          ))}
        {m.body && <RichText text={m.body} />}
        {m.status === "running" && (
          <div className="room-run-status">
            <span className="room-thinking" />
            {m.body ? "Writing an answer…" : "Reading the repository…"}
            {m.authorId === memberId && (
              <button onClick={() => onCancel(m.id)}>
                <Square size={10} />
                Stop
              </button>
            )}
          </div>
        )}
        {m.error && <p className="room-run-error">{m.error}</p>}
        {agent && (
          <div className="room-message-meta">
            <span title={m.model ?? undefined}>{m.model}</span>
            {(m.status === "failed" || m.status === "cancelled") &&
              m.authorId === memberId && (
                <button onClick={() => onRetry(m)}>Ask again</button>
              )}
          </div>
        )}
      </div>
    </article>
  );
}
