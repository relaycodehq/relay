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
    <div className="add-link-step">
      <div className="add-link-head">
        <strong>{project.name} is in Relay.</strong>
        <p>
          Link the repos beside it? Its agents read linked folders without
          asking, and you can change them in Project settings from the project's
          menu.
        </p>
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
      <div className="add-actions">
        {shown.length < related.length && (
          <button
            type="button"
            className="text-button add-more"
            onClick={() => setAll(true)}
          >
            {related.length - shown.length} more beside it
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
    </div>
  );
}
