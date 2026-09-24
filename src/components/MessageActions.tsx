import { useEffect, useState } from "react";
import { Check, Copy, Reply, Split } from "lucide-react";
import { sentLabel } from "../../shared/chat-activity";
import { api } from "../lib/api";

/** The row under an agent's answer: copy, fork, reply, and when it was sent. */
export function MessageActions({
  text,
  sent,
  pending,
  onReply,
  onFork,
}: {
  text?: string;
  sent: number;
  /** While the answer streams the row keeps its height but stays hidden. */
  pending: boolean;
  onReply: () => void;
  onFork?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <footer className="message-actions" inert={pending}>
      {!!text?.trim() && (
        <button
          type="button"
          title={copied ? "Copied" : "Copy answer"}
          aria-label={copied ? "Copied" : "Copy answer"}
          onClick={() =>
            void api
              .writeClipboard(text)
              .then(() => setCopied(true))
              .catch(() => {})
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
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
