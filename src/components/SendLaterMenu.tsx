import { ContextMenu } from "@base-ui/react/context-menu";
import { CalendarClock } from "lucide-react";
import { useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { atHour, wakeLabel } from "../../shared/chat-activity";
import { Modal } from "./ui";
import "./send-later.css";

interface Preset {
  label: string;
  at: number;
}

export function sendLaterPresets(now: Date): Preset[] {
  const presets: Preset[] = [
    { label: "In 30 minutes", at: now.getTime() + 1_800_000 },
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 10_800_000 },
  ];
  // Only offer "this evening" while it is still meaningfully ahead.
  if (now.getHours() < 17)
    presets.push({ label: "This evening", at: atHour(now, 0, 18) });
  presets.push({ label: "Tomorrow morning", at: atHour(now, 1, 9) });
  return presets;
}

/** The value a datetime-local input takes, in local time. */
function localInput(at: number) {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function SendLaterDialog({
  onPick,
  onClose,
}: {
  onPick: (at: number) => void;
  onClose: () => void;
}) {
  // An hour ahead, on the next five minutes.
  const [value, setValue] = useState(() =>
    localInput(Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000),
  );
  const at = value ? new Date(value).getTime() : NaN;
  const valid = at > Date.now();
  return (
    <Modal title="Send later" onClose={onClose} className="send-later-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // React bubbles it through the portal to the composer's own form.
          e.stopPropagation();
          if (!valid) return;
          onClose();
          onPick(at);
        }}
      >
        <label>
          Send at
          <input
            type="datetime-local"
            aria-label="Send at"
            value={value}
            min={localInput(Date.now())}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <p className="field-note">
          {valid
            ? `Sends ${wakeLabel(at, new Date())}. Relay has to be open then; if it's closed, the message goes out when Relay starts.`
            : "Choose a time in the future."}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Schedule
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Right-click on Send: send the message at a later time instead. */
export function SendLaterMenu({
  disabled,
  onPick,
  children,
}: {
  disabled?: boolean;
  onPick: (at: number) => void;
  /** The send button, which becomes the trigger. */
  children: ReactElement;
}) {
  const [now, setNow] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  return (
    <>
      <ContextMenu.Root
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) setNow(new Date());
        }}
      >
        <ContextMenu.Trigger render={children} />
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="sb-menu-positioner">
            <ContextMenu.Popup className="sb-menu send-later-menu">
              <div className="sb-menu-heading">Send later…</div>
              {sendLaterPresets(now).map((preset) => (
                <ContextMenu.Item
                  key={preset.label}
                  className="sb-menu-item"
                  onClick={() => onPick(preset.at)}
                >
                  <span>{preset.label}</span>
                  <small>{wakeLabel(preset.at, now)}</small>
                </ContextMenu.Item>
              ))}
              <ContextMenu.Separator className="send-later-separator" />
              <ContextMenu.Item
                className="sb-menu-item"
                onClick={() => setPicking(true)}
              >
                <span className="sb-menu-label">
                  <CalendarClock size={14} />
                  Pick a time…
                </span>
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {/* Outside the composer's form, which a nested form would submit. */}
      {picking &&
        createPortal(
          <SendLaterDialog onPick={onPick} onClose={() => setPicking(false)} />,
          document.body,
        )}
    </>
  );
}
