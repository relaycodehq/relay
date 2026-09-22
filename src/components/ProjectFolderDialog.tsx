import { useState, useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import { projectFolderSchema } from "../../shared/project-folders";
import { api } from "../lib/api";
import { Modal, ErrorBox } from "./ui";
export function ProjectFolderDialog({
  projects,
  initial,
  onClose,
}: {
  projects: Project[];
  initial?: string;
  onClose: () => void;
}) {
  const first = projects.find((p) => p.id === initial) ?? projects[0];
  const [projectId, setProjectId] = useState(first?.id ?? "");
  const [folder, setFolder] = useState(first?.folder ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient(),
    listId = useId();
  const folders = [
    ...new Set(
      projects.flatMap((p) =>
        (p.folder?.split("/") ?? []).map((_, i, parts) =>
          parts.slice(0, i + 1).join("/"),
        ),
      ),
    ),
  ].sort();
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const parsed = projectFolderSchema.safeParse(folder);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      await api.setProjectFolder(projectId, parsed.data);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Organize projects"
      className="project-folder-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>Group projects in virtual folders. Your files stay where they are.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Project
          <select
            aria-label="Project to organize"
            disabled={busy}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setFolder(
                projects.find((p) => p.id === e.target.value)?.folder ?? "",
              );
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Virtual folder
          <input
            aria-label="Virtual folder"
            placeholder="Work or Work/Frontend"
            list={listId}
            value={folder}
            disabled={busy}
            onChange={(e) => setFolder(e.target.value)}
            autoFocus
          />
        </label>
        <datalist id={listId}>
          {folders.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
        <p className="muted">
          Use / for nested folders. Leave empty to move the project to the top
          level.
        </p>
        {!!error && <ErrorBox error={error} />}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !projectId}>
            {busy ? "Moving…" : "Move project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
