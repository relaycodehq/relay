import { ArrowUp } from "lucide-react";
import { steerKeyLabel, type SendKey } from "../../lib/send-key";
import { SendLaterMenu } from "./SendLaterMenu";

/** Stops the running answer; armed shows the first Escape of two is in. */
export function StopButton({
  armed,
  keys,
  onStop,
}: {
  armed: boolean;
  keys: string;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      className="composer-stop"
      data-armed={armed || undefined}
      aria-label={armed ? "Press Escape again to stop" : "Stop answer"}
      title={`Stop answer and pause queued messages${keys && ` · ${keys}`}`}
      onClick={onStop}
    >
      {armed ? (
        <span className="composer-stop-esc">esc</span>
      ) : (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      )}
    </button>
  );
}

/** Submits the composer's form; right-click picks a time to send it later. */
export function SendButton({
  disabled,
  running,
  sendKey,
  onSendLater,
}: {
  disabled: boolean;
  /** An answer runs, so the message queues. */
  running: boolean;
  sendKey: SendKey;
  onSendLater: (at: number) => void;
}) {
  return (
    <SendLaterMenu disabled={disabled} onPick={onSendLater}>
      <button
        className="primary send-message"
        aria-label="Send message"
        title={
          running
            ? `Queue message · ${steerKeyLabel(sendKey)} to steer · right-click to send later`
            : "Send message · right-click to send later"
        }
        disabled={disabled}
      >
        <ArrowUp size={18} />
      </button>
    </SendLaterMenu>
  );
}
