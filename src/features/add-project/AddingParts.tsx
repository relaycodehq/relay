// The palette's smaller pieces: a way to add a project, progress, what a
// picked folder turned out to be, and a new project's fields.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { AddingJob, NewProject } from "../../../shared/projects";
import { linkName, tildePath } from "../../../shared/projects";
import {
  Segmented,
  SettingsCard,
  SettingsRow,
  Switch,
} from "../../ui/SettingsCard";
import type { Picked } from "./useAdding";

/** One way to add a project, on the palette's first page. */
export function WayRow({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="headline-project-row palette-row"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <ChevronRight size={14} />
    </button>
  );
}

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
  onAdd,
}: {
  picked: Picked;
  onAdd: (path: string, setUpGit?: boolean) => void;
}) {
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
    <div className="add-note add-plain-note">
      <span>
        <strong>{linkName(picked.path)}</strong> has no Git history. Branches
        and worktrees are unavailable.
      </span>
      <div className="add-note-actions">
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
      </div>
    </div>
  );
}

export type Spec = Omit<NewProject, "name">;

/** Where a new project goes, and whether it gets git and a GitHub repo. */
export function NewProjectFields({
  name,
  spec,
  login,
  onSpec,
}: {
  name: string;
  spec: Spec;
  /** The `gh` login, when known. */
  login?: string;
  onSpec: (next: Spec) => void;
}) {
  return (
    <SettingsCard className="add-new-card">
      <SettingsRow label="Set up git">
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
            ? `github.com/${login ?? "you"}/${name || "…"}`
            : undefined
        }
      >
        <Switch
          label="Create it on GitHub"
          checked={spec.github}
          disabled={!spec.git}
          onChange={(github) => onSpec({ ...spec, github })}
        />
      </SettingsRow>
      {spec.github && (
        <SettingsRow label="Visibility">
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
        </SettingsRow>
      )}
    </SettingsCard>
  );
}
