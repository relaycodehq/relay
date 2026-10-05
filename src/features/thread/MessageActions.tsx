import { Check, Copy, Reply, Split } from "lucide-react";
import { sentLabel } from "../../../shared/chat-activity";
import { useCopy } from "../../lib/useCopy";
import { ReadAloudButton } from "../read-aloud/ReadAloudButton";

/** The row under an agent's answer: copy, read aloud, fork, reply, and when it was sent. */
export function MessageActions({
  text,
  readingKey,
  sent,
  pending,
  onReply,
  onFork,
}: {
  text?: string;
  /** What identifies the answer while it is read aloud. */
  readingKey?: string;
  sent: number;
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
