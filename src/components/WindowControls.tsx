import { useEffect, useState } from "react";
import "./window-controls.css";

/** Windows only: macOS keeps its traffic lights and Linux the native overlay. */
export const drawsWindowControls =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Win");

/**
 * Minimize, maximize and close, drawn by Relay so they sit centred in the
 * header; Electron's own overlay can only hug the top of the window. Glyphs
 * come from Windows' icon font, so they match every other app's.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    void window.relay.isMaximized().then((value) => {
      if (live) setMaximized(value);
    });
    const stop = window.relay.onMaximized(setMaximized);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return (
    <div className="window-controls">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void window.relay.windowControl("minimize")}
      >
        {""}
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void window.relay.windowControl("toggleMaximize")}
      >
        {maximized ? "" : ""}
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="Close"
        title="Close"
        onClick={() => void window.relay.windowControl("close")}
      >
        {""}
      </button>
    </div>
  );
}
