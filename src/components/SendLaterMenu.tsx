import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { CalendarClock } from "lucide-react";
import { useRef, useState, type ReactElement } from "react";
import { sendLaterPresets, wakeLabel } from "../../shared/chat-activity";
import { PickTime } from "./PickTime";
import "./send-later.css";

// Its own component so the times are worked out when the menu opens, not on
// every keystroke in the composer that holds the closed menu.
function SendLaterPresets({ onPick }: { onPick: (at: number) => void }) {
  const [now] = useState(() => new Date());
  return sendLaterPresets(now).map((preset) => (
    <ContextMenu.Item
      key={preset.label}
      className="sb-menu-item"
      onClick={() => onPick(preset.at)}
    >
      <span>{preset.label}</span>
      <small>{wakeLabel(preset.at, now)}</small>
    </ContextMenu.Item>
  ));
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
  const [picking, setPicking] = useState(false);
  const button = useRef<HTMLDivElement>(null);
  return (
    <>
      <ContextMenu.Root disabled={disabled}>
        <ContextMenu.Trigger ref={button} render={children} />
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="sb-menu-positioner">
            <ContextMenu.Popup className="sb-menu send-later-menu">
              <div className="sb-menu-heading">Send later…</div>
              <SendLaterPresets onPick={onPick} />
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
      {/* A menu can't hold a calendar, so the picker opens on its own by Send. */}
      <Popover.Root open={picking} onOpenChange={setPicking}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={button}
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="sb-menu-positioner"
          >
            <Popover.Popup className="sb-menu" aria-label="Send later">
              <PickTime
                action="Schedule"
                hint="Relay has to be open then; if it's closed, the message goes out when Relay starts."
                onPick={(at) => {
                  setPicking(false);
                  onPick(at);
                }}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}
