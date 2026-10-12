import { Check, Copy, Reply, Split } from "lucide-react";
import { sentLabel } from "../../../shared/chat-activity";
import { answerSpeed, type Streamed } from "../../../shared/usage";
import { formatCost } from "../../../shared/thread-cost";
import { useCopy } from "../../lib/useCopy";
import { PinMessageButton } from "../../ui/KeepBlock";
import { ReadAloudButton } from "../read-aloud/ReadAloudButton";

const speedDetail = (s: Streamed) =>
  `${s.output.toLocaleString("en-US")} tokens in ${(s.ms / 1000).toFixed(1)} s ` +
  "of writing; thinking, waiting and tool runs don't count";

/** The row under an agent's answer: copy, read aloud, fork, reply, how fast it wrote, what it cost, when it was sent, and pin. */
export function MessageActions({
  id,
  text,
  readingKey,
  sent,
  streamed,
  cost,
  pending,
  onReply,
  onFork,
}: {
  id: string;
  text?: string;
  /** What identifies the answer while it is read aloud. */
  readingKey?: string;
  sent: number;
  streamed?: Streamed;
  /** Dollars it cost, where its agent priced it. */
  cost?: number;
  /** While the answer streams the row keeps its height but stays hidden. */
  pending: boolean;
  onReply: () => void;
  onFork?: () => void;
}) {
  const speed = answerSpeed(streamed);
  return (
    <footer className="message-actions" inert={pending}>
      {!!text?.trim() && <CopyMessageButton text={text} label="Copy answer" />}
      {!!text?.trim() && readingKey && (
        <ReadAloudButton readingKey={readingKey} text={text} />
      )}
      {onFork && (
        <button
          type="button"
          title="Fork into a new thread"
          aria-label="Fork into a new thread"
          onClick={onFork}
        >
          <Split size={15} />
        </button>
      )}
      <button
        type="button"
        title="Reply to message"
        aria-label="Reply to message"
        onClick={onReply}
      >
        <Reply size={15} />
      </button>
      {streamed && speed !== undefined && (
        <span className="message-speed" title={speedDetail(streamed)}>
          {speed} tok/s
        </span>
      )}
      {!!cost && cost > 0 && (
        <span className="message-speed" title="What this answer cost, as its agent priced it">
          {formatCost(cost)}
        </span>
      )}
      <time
        dateTime={new Date(sent).toISOString()}
        title={new Date(sent).toLocaleString()}
      >
        {sentLabel(sent, new Date())}
      </time>
      {/* Last, at the edge, where a pinned answer's pin stays on its own. */}
      {!!text?.trim() && <PinMessageButton id={id} />}
    </footer>
  );
}

export function CopyMessageButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className={className}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      onClick={() => copy(text)}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
