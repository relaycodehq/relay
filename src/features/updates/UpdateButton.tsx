import { useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  Clock,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { api } from "../../lib/api";
import { checkForUpdates, useUpdates } from "./updates";
import { useRecent } from "./useRecent";
import { releasesPage } from "../../../shared/updates";
import { Spinner } from "../../ui/ui";

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

/** Sidebar footer control; stays hidden until there's a newer release. */
export function UpdateButton() {
  const { state } = useUpdates();
  if (!state) return null;
  switch (state.status) {
    case "available":
      return state.install === "manual" ? (
        <button
          type="button"
          className="sb-update"
          title={`Relay ${state.version} is available. ${state.reason ?? ""} Opens the download page.`.trim()}
          onClick={() => void api.openExternal(releasesPage)}
        >
          <ArrowDownToLine size={13} />
          <span className="fit-word">Download</span>
          {state.version}
        </button>
      ) : (
        <button
          type="button"
          className="sb-update"
          title={`Download Relay ${state.version} (you have ${state.current})${state.notes ? `\n\n${state.notes}` : ""}`}
          onClick={() => void api.downloadUpdate()}
        >
          <ArrowDownToLine size={13} />
          <span className="fit-word">Update</span>
          {state.version}
        </button>
      );
    case "downloading":
      return (
        <button
          type="button"
          className="sb-update busy"
          disabled
          title={`Downloading Relay ${state.version}`}
          style={
            { "--progress": `${Math.round(state.progress * 100)}%` } as never
          }
        >
          <ArrowDownToLine size={13} />
          {Math.round(state.progress * 100)}%
        </button>
      );
    case "ready":
      return (
        <button
          type="button"
          className="sb-update"
          title={`Relay ${state.version} is ready. Restart to finish updating.`}
          onClick={() => void api.installUpdate()}
        >
          <RotateCw size={13} />
          Restart
        </button>
      );
    case "waiting":
      return (
        <button
          type="button"
          className="sb-update"
          title={`Relay ${state.version} restarts once Claude's background work finishes (${state.tasks} running). Click to restart now; that work stops.`}
          onClick={() => void api.installUpdate()}
        >
          <Clock size={13} />
          After tasks
        </button>
      );
    case "installing":
      return (
        <button type="button" className="sb-update busy" disabled>
          <Spinner size={12} />
          Updating…
        </button>
      );
    case "error":
      return (
        <button
          type="button"
          className="sb-update failed"
          title={`${state.message} Click to try again.`}
          onClick={() => void api.downloadUpdate()}
        >
          <AlertCircle size={13} />
          Retry update
        </button>
      );
    default:
      return null;
  }
}
