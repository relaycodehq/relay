import { AlertCircle, ArrowDownToLine, Clock, RotateCw } from "lucide-react";
import { api } from "../lib/api";
import { useUpdates } from "../lib/updates";
import { releasesPage } from "../../shared/updates";
import { Spinner } from "./ui";

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
