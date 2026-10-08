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
import { IconButton, Spinner } from "../../ui/ui";

/**
 * The version this Relay runs, at the footer's start; opens About. A
 * development build never updates, and its package version is a placeholder.
 */
export function RunningVersion({ onAbout }: { onAbout: () => void }) {
  const state = useUpdates().state;
  const dev = state?.status === "off";
  return (
    <button
      className="sb-version"
      title={
        state &&
        (dev ? "Development build · About" : `Relay ${state.current} · About`)
      }
      onClick={onAbout}
    >
      {state && (dev ? "dev" : `v${state.current}`)}
    </button>
  );
}

/**
 * Sidebar footer icon that looks for a newer release. It steps aside once
 * there is one: the update button beside it takes over from there.
 */
export function CheckUpdatesButton() {
  const { state, checking, failure } = useUpdates();
  const [askedAt, setAskedAt] = useState<number>();
  const answered = useRecent(
    !checking && state?.status === "idle" ? askedAt : undefined,
    // The check itself takes at least 1.4s of the window.
    3400,
  );
  if (!state || (state.status !== "idle" && state.status !== "checking"))
    return null;
  const busy = checking || state.status === "checking";
  const label = busy
    ? "Checking for updates…"
    : failure
      ? `${failure} Click to try again.`
      : answered
        ? `Relay ${state.current} is up to date`
        : "Check for updates";
  return (
    <IconButton
      label={label}
      disabled={busy}
      onClick={() => {
        setAskedAt(Date.now());
        void checkForUpdates();
      }}
    >
      {busy ? (
        <Spinner size={14} />
      ) : failure ? (
        <AlertCircle size={15} />
      ) : answered ? (
        <Check size={15} />
      ) : (
        <RefreshCw size={15} />
      )}
    </IconButton>
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
          Download {state.version}
        </button>
      ) : (
        <button
          type="button"
          className="sb-update"
          title={`Download Relay ${state.version} (you have ${state.current})${state.notes ? `\n\n${state.notes}` : ""}`}
          onClick={() => void api.downloadUpdate()}
        >
          <ArrowDownToLine size={13} />
          Update {state.version}
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
