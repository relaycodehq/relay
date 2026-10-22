import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderX } from "lucide-react";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { errorMessage } from "../../../shared/error-message";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import "./projects.css";

/**
 * Over a thread whose project folder was moved or deleted: where it was, and
 * either pointing the project at its new place or taking it out of Relay.
 */
export function FolderGone({
  project,
  path,
}: {
  project: Project;
  path: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      // Everything read from the old folder is stale now.
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="folder-gone" role="alert">
      <FolderX size={15} aria-hidden />
      <div className="folder-gone-text">
        <strong>{project.name}’s folder is gone</strong>
        <MiddleTruncate text={path} kind="path" />
        {error && <span className="folder-gone-error">{error}</span>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => api.locateProject(project.id))}
      >
        Locate…
      </button>
      <button
        type="button"
        disabled={busy}
        title="Threads stay; adding the folder again brings them back"
        onClick={() => void run(() => api.removeProject(project.id))}
      >
        Remove from Relay
      </button>
    </div>
  );
}

/** Where a pane would read the missing folder: the project's, or with `reason` the thread's own. */
export function FolderGoneEmpty({ reason }: { reason?: string }) {
  return (
    <div className="empty pane-empty folder-gone-empty">
      <FolderX size={24} />
      <p>
        {reason ?? "Nothing to show while the project’s folder is missing."}
      </p>
    </div>
  );
}
