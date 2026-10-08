// The palette's smaller pieces: progress, what a picked folder turned out to
// be, and a new project's fields.
import type { AddingJob, NewProject, Project } from "../../../shared/projects";
import { linkName, tildePath } from "../../../shared/projects";
import {
  Segmented,
  SettingsCard,
  SettingsRow,
  Switch,
} from "../../ui/SettingsCard";
import type { Picked } from "./useAdding";

export function JobProgress({
  job,
  onCancel,
}: {
  job: AddingJob;
  onCancel: () => void;
}) {
  return (
    <div className="add-job" role="status">
      <div className="add-job-text">
        <strong>{job.title}</strong>
        <small>
          {job.step}
          {job.progress !== null && ` · ${Math.round(job.progress * 100)}%`}
        </small>
      </div>
      <button type="button" className="text-button" onClick={onCancel}>
        Cancel
      </button>
      <div className="add-job-track">
        <i style={{ transform: `scaleX(${job.progress ?? 0})` }} />
      </div>
    </div>
  );
}

/** Said under a picked folder that can't simply be added. */
export function PickedNote({
  picked,
  onOpen,
  onAdd,
}: {
  picked: Picked;
  onOpen: (project: Project) => void;
  onAdd: (path: string, setUpGit?: boolean) => void;
}) {
  if (picked.kind === "added")
    return (
      <p className="add-note">
        <span>
          Already in Relay as <strong>{picked.project.name}</strong>.
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => onOpen(picked.project)}
        >
          Open it
        </button>
      </p>
    );
  if (picked.kind === "inside")
    return (
      <p className="add-note">
        <span>
          That's inside the Git repository at{" "}
          <code>{tildePath(picked.root)}</code>.
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => onAdd(picked.root)}
        >
          Add {linkName(picked.root)}
        </button>
      </p>
    );
  if (picked.kind === "missing")
    return (
      <p className="add-note">
        <span>
          <code>{tildePath(picked.path)}</code> isn't a folder.
        </span>
      </p>
    );
  return (
    <p className="add-note">
      <span>
        <strong>{linkName(picked.path)}</strong> isn't a git repository, so it
        gets no branches, Changes or worktrees.
      </span>
      <button
        type="button"
        className="text-button"
        onClick={() => onAdd(picked.path, true)}
      >
        Set up git
      </button>
      <button
        type="button"
        className="text-button"
        onClick={() => onAdd(picked.path)}
      >
        Add it as it is
      </button>
    </p>
  );
}

export type Spec = Omit<NewProject, "name">;

/** Where a new project goes, and whether it gets git and a GitHub repo. */
export function NewProjectFields({
  name,
  spec,
  login,
  onSpec,
  onLocation,
}: {
  name: string;
  spec: Spec;
  /** The `gh` login, when known. */
  login?: string;
  onSpec: (next: Spec) => void;
  onLocation: () => void;
}) {
  return (
    <SettingsCard className="add-new-card">
      <SettingsRow
        label="Location"
        hint={`${tildePath(spec.location)}/${name || "…"}`}
      >
        <button type="button" onClick={onLocation}>
          Change…
        </button>
      </SettingsRow>
      <SettingsRow
        label="Set up git"
        hint="git init, a .gitignore and a first commit"
      >
        <Switch
          label="Set up git"
          checked={spec.git}
          onChange={(git) =>
            onSpec({ ...spec, git, github: git && spec.github })
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Create it on GitHub"
        hint={
          spec.github
            ? `github.com/${login ?? "you"}/${name || "…"}, through gh`
            : "Pushes the first commit to a new repository"
        }
      >
        {spec.github && (
          <Segmented
            label="Visibility"
            value={spec.private ? "private" : "public"}
            options={
              [
                ["private", "Private"],
                ["public", "Public"],
              ] as const
            }
            onChange={(v) => onSpec({ ...spec, private: v === "private" })}
          />
        )}
        <Switch
          label="Create it on GitHub"
          checked={spec.github}
          disabled={!spec.git}
          onChange={(github) => onSpec({ ...spec, github })}
        />
      </SettingsRow>
    </SettingsCard>
  );
}
