import { useState } from "react";
import { FolderGit2, FolderSymlink } from "lucide-react";
import {
  linkName,
  tildePath,
  type LinkSuggestion,
  type Project,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { Switch } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";
import { AddProjectHeading } from "./AddProjectHeading";

/** After adding: offer the repos beside it as linked folders, read only. Done saves them. */
export function LinkStep({
  project,
  related,
  onDone,
}: {
  project: Project;
  related: readonly LinkSuggestion[];
  onDone: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const shown = all ? related : related.slice(0, 4);
  async function done() {
    if (!chosen.length) return onDone();
    setSaving(true);
    try {
      await api.addProjectLinks(
        project.id,
        chosen.map((path) => ({ path, access: "read" as const })),
      );
      onDone();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }
  return (
    <>
      <AddProjectHeading title="Link related folders" />
      <div className="palette-body add-link-step">
        <div className="add-link-head">
          <strong>{project.name} is in Relay.</strong>
          <p>Let agents read these folders. Access is read only.</p>
        </div>
        <ul className="add-link-list">
          {shown.map((s) => {
            const on = chosen.includes(s.path);
            return (
              <li key={s.path}>
                <label>
                  {s.project ? (
                    <FolderGit2 size={15} />
                  ) : (
                    <FolderSymlink size={15} />
                  )}
                  <span>
                    <strong>{s.project ?? linkName(s.path)}</strong>
                    <small>{tildePath(s.path)}</small>
                  </span>
                  <em>{on ? "Read only" : ""}</em>
                  <Switch
                    label={`Link ${linkName(s.path)}`}
                    checked={on}
                    disabled={saving}
                    onChange={(next) =>
                      setChosen((list) =>
                        next
                          ? [...list, s.path]
                          : list.filter((p) => p !== s.path),
                      )
                    }
                  />
                </label>
              </li>
            );
          })}
        </ul>
        {!!error && <ErrorBox error={error} />}
      </div>
      <div className="add-project-footer">
        {shown.length < related.length && (
          <button
            type="button"
            className="text-button add-more"
            disabled={saving}
            onClick={() => setAll(true)}
          >
            Show {related.length - shown.length} more
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={saving}
          autoFocus
          onClick={() => void done()}
        >
          Done
        </button>
      </div>
    </>
  );
}
