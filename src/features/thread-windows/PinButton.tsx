import { useEffect, useState } from "react";
import { Pin } from "lucide-react";
import { api } from "../../lib/api";
import { useShortcut, useShortcutLabel } from "../../lib/shortcuts";

/** Keeps this popped-out window, a thread's or an editor's, on top of other apps. */
export function PinButton({ onError }: { onError: (error: unknown) => void }) {
  const [pinned, setPinned] = useState(false);
  const keys = useShortcutLabel("pin-window");
  useEffect(() => {
    void api.windowPinned().then(setPinned, onError);
  }, []);
  const toggle = () => {
    const next = !pinned;
    api.pinWindow(next).then(() => setPinned(next), onError);
  };
  useShortcut("pin-window", true, toggle);
  const label = pinned ? "Stop keeping on top" : "Keep on top of other apps";
  return (
    <button
      type="button"
      className={`pane-toggle${pinned ? " active" : ""}`}
      aria-label={label}
      aria-pressed={pinned}
      aria-keyshortcuts={keys || undefined}
      title={keys ? `${label} · ${keys}` : label}
      onClick={toggle}
    >
      <Pin size={14} />
    </button>
  );
}
