import { Check, Copy, Reply, Split } from "lucide-react";
import { sentLabel } from "../../../shared/chat-activity";
import { tokensPerSecond, type Streamed } from "../../../shared/usage";
import { useCopy } from "../../lib/useCopy";
import { ReadAloudButton } from "../read-aloud/ReadAloudButton";

/** Fewer tokens than this stream too briefly for a speed to mean much. */
const TIMED_OUTPUT = 50;

const speedDetail = (s: Streamed) =>
  `${s.output.toLocaleString("en-US")} tokens in ${(s.ms / 1000).toFixed(1)} s ` +
  "of writing; thinking, waiting and tool runs don't count";

/** The row under an agent's answer: copy, read aloud, fork, reply, how fast it wrote and when it was sent. */
export function MessageActions({
  text,
  readingKey,
  sent,
  streamed,
  pending,
  onReply,
  onFork,
}: {
  text?: string;
  /** What identifies the answer while it is read aloud. */
  readingKey?: string;
  sent: number;
  streamed?: Streamed;
  /** While the answer streams the row keeps its height but stays hidden. */
  pending: boolean;
  onReply: () => void;
  onFork?: () => void;
}) {
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
      {streamed && streamed.output >= TIMED_OUTPUT && (
        <span className="message-speed" title={speedDetail(streamed)}>
          {Math.round(tokensPerSecond(streamed))} tok/s
        </span>
      )}
      <time
        dateTime={new Date(sent).toISOString()}
        title={new Date(sent).toLocaleString()}
      >
        {sentLabel(sent, new Date())}
      </time>
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
