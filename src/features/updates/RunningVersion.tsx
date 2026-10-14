import { useState } from "react";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { checkForUpdates, useUpdates } from "./updates";
import { useRecent } from "./useRecent";

/**
 * The version this Relay runs, at the footer's start. While no update is under
 * way a click looks for a newer release, which a ↻ rolling out of the number
 * on hover says; otherwise, and in a development build, it opens About.
 */
export function RunningVersion({ onAbout }: { onAbout: () => void }) {
  const { state, checking, failure } = useUpdates();
  const [askedAt, setAskedAt] = useState<number>();
  const answered = useRecent(
    !checking && state?.status === "idle" ? askedAt : undefined,
    // The check itself takes at least 1.4s of the window.
    3400,
  );
  if (!state) return <button type="button" className="sb-version" />;
  const dev = state.status === "off";
  const checks = state.status === "idle" || state.status === "checking";
  const busy = checking || state.status === "checking";
  const shows = !checks
    ? undefined
    : busy
      ? "checking"
      : failure
        ? "failed"
        : answered
          ? "done"
          : undefined;
  const title = dev
    ? "Development build · About"
    : !checks
      ? `Relay ${state.current} · About`
      : busy
        ? "Checking for updates…"
        : failure
          ? `${failure} Click to try again.`
          : answered
            ? `Relay ${state.current} is up to date`
            : `Relay ${state.current} · Check for updates`;
  return (
    <button
      type="button"
      className="sb-version"
      data-shows={shows}
      aria-busy={busy || undefined}
      title={title}
      onClick={() => {
        if (!checks) return onAbout();
        if (busy) return;
        setAskedAt(Date.now());
        void checkForUpdates();
      }}
    >
      {dev ? "dev" : `v${state.current}`}
      {checks && (
        // Every icon stays mounted in one cell, so states cross-fade and
        // hovering never changes the button's width.
        <span className="sb-version-icon" aria-hidden="true">
          <span className="sb-version-turn">
            <span className="sb-version-spin">
              <RefreshCw size={12} />
            </span>
          </span>
          <Check size={12} className="sb-version-done" />
          <AlertCircle size={12} className="sb-version-failed" />
        </span>
      )}
    </button>
  );
}
