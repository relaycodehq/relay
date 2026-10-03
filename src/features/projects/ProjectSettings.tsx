import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  projectNameSchema,
  type ChatWorkspace,
  type Project,
  type ProjectSettings,
} from "../../../shared/projects";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { ProjectBadge } from "./ProjectBadge";
import { Switch } from "../../ui/SettingsCard";
import { ErrorBox } from "../../ui/ui";

/** The projects Settings can pick from: every real one, scratch chats aside. */
export function useSettingsProjects(accountId: string | undefined) {
  const projects = useQuery({
    queryKey: ["projects", accountId],
    queryFn: () => api.projects(),
  });
  return projects.data?.filter((p) => !p.scratch);
}

/**
 * One project setting, saved as it changes. What matches the app is dropped,
 * so the project follows later changes there. Each save carries the project's
 * other settings as the list holds them, changes not yet saved included.
 */
function useProjectSetting<K extends keyof ProjectSettings>(
  project: Project,
  key: K,
) {
  const qc = useQueryClient();
  const mutationKey = ["project-settings", project.id];
  // Shown at once: the list only re-renders a tick later, and a controlled
  // switch would flick back meanwhile.
  const [saving, setSaving] = useState<{
    project: string;
    value: ProjectSettings[K] | undefined;
  }>();
  const patch = (settings: ProjectSettings | undefined) =>
    qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
      list?.map((p) => (p.id === project.id ? { ...p, settings } : p)),
    );
  const latest = () =>
    qc
      .getQueriesData<Project[]>({ queryKey: ["projects"] })
      .flatMap(([, list]) => list ?? [])
      .find((p) => p.id === project.id)?.settings ?? project.settings;
  const save = useMutation({
    mutationKey,
    mutationFn: (settings: ProjectSettings) =>
      api.saveProjectSettings(project.id, settings),
    onSuccess: async (saved) => {
      // An earlier answer would undo a later change still on its way.
      if (qc.isMutating({ mutationKey }) <= 1) patch(saved.settings);
      await qc.invalidateQueries({ queryKey: ["project-chats", project.id] });
    },
    onError: () => void qc.invalidateQueries({ queryKey: ["projects"] }),
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) setSaving(undefined);
    },
  });
  return {
    value:
      saving?.project === project.id ? saving.value : project.settings?.[key],
    change(value: ProjectSettings[K] | undefined) {
      const next = { ...latest() };
      if (value === undefined) delete next[key];
      else next[key] = value;
      // The list polls; a fetch already on its way mustn't undo this.
      void qc.cancelQueries({ queryKey: ["projects"] }, { revert: false });
      patch(next);
      setSaving({ project: project.id, value });
      save.mutate(next);
    },
    error: save.isError ? save.error : undefined,
  };
}

export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value: Project;
  onChange: (id: string) => void;
}) {
  return (
    <div className="composer-tools model-field">
      <ComposerSelect
        label="Project"
        value={value.id}
        icon={<ProjectBadge id={value.id} name={value.name} />}
        options={projects.map((p) => ({
          value: p.id,
          label: p.name,
          ...(p.folder ? { description: p.folder } : {}),
        }))}
        onChange={onChange}
      />
    </div>
  );
}

export function ProjectNameField({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.id, project.name]);
  const rename = useMutation({
    mutationFn: (next: string) => api.renameProject(project.id, next),
    onMutate: (next) =>
      qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
        list?.map((p) => (p.id === project.id ? { ...p, name: next } : p)),
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const parsed = projectNameSchema.safeParse(name);
  const commit = () => {
    if (!parsed.success) return setName(project.name);
    if (parsed.data !== project.name) rename.mutate(parsed.data);
  };
  return (
    <>
      <input
        className="settings-project-name"
        aria-label="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && name !== project.name) {
            e.preventDefault();
            setName(project.name);
          }
        }}
      />
      {rename.isError && <ErrorBox error={rename.error} />}
    </>
  );
}

export function ProjectFolderRow({ project }: { project: Project }) {
  const [error, setError] = useState<unknown>();
  return (
    <>
      <span className="settings-project-path" title={project.path}>
        {project.path}
      </span>
      <button
        type="button"
        onClick={() => void api.revealProject(project.id).catch(setError)}
      >
        <FolderOpen size={13} />
        Open in Finder
      </button>
      {!!error && <ErrorBox error={error} />}
    </>
  );
}

export function ProjectWorkspaceSelect({ project }: { project: Project }) {
  const workspace = useProjectSetting(project, "workspace");
  const value = workspace.value ?? "checkout";
  return (
    <>
      <div className="composer-tools model-field">
        <ComposerSelect<ChatWorkspace>
          label="Where new threads start"
          value={value}
          options={[
            {
              value: "checkout",
              label: "Project folder",
              description: "Works in the checkout, on whatever branch it has.",
            },
            {
              value: "worktree",
              label: "New worktree",
              description:
                "A branch and folder of its own, made with the first message.",
            },
          ]}
          onChange={(next) =>
            workspace.change(next === "checkout" ? undefined : next)
          }
        />
      </div>
      {!!workspace.error && <ErrorBox error={workspace.error} />}
    </>
  );
}

const dayChoices = [
  { value: "off", label: "Never" },
  { value: "1", label: "After 1 day" },
  { value: "3", label: "After 3 days" },
  { value: "7", label: "After a week" },
  { value: "14", label: "After 2 weeks" },
  { value: "30", label: "After 30 days" },
];
const daysLabel = (days: number | null) =>
  days === null
    ? "Never"
    : (dayChoices.find((c) => c.value === String(days))?.label ??
      `After ${days} days`);

export function ProjectAutoSettleSelect({ project }: { project: Project }) {
  const days = useProjectSetting(project, "autoSettleDays");
  const appDays = useQuery({
    queryKey: ["auto-settle-days"],
    queryFn: () => api.autoSettleDays(),
  });
  const own = days.value;
  const value = own === undefined ? "app" : own === null ? "off" : String(own);
  return (
    <>
      <div className="composer-tools model-field">
        <ComposerSelect
          label="Settle quiet threads"
          value={value}
          options={[
            {
              value: "app",
              label:
                appDays.data === undefined
                  ? "Like the app"
                  : `Like the app (${daysLabel(appDays.data).toLowerCase()})`,
            },
            ...dayChoices,
            ...(value === "app" || dayChoices.some((c) => c.value === value)
              ? []
              : [{ value, label: `After ${value} days` }]),
          ]}
          onChange={(next) =>
            days.change(
              next === "app" ? undefined : next === "off" ? null : +next,
            )
          }
        />
      </div>
      {!!days.error && <ErrorBox error={days.error} />}
    </>
  );
}

export const cleanupChoices = [
  { value: "off", label: "Never" },
  { value: "0", label: "Once it settles" },
  { value: "1", label: "A day after it settles" },
  { value: "3", label: "3 days after it settles" },
  { value: "7", label: "A week after it settles" },
  { value: "14", label: "2 weeks after it settles" },
  { value: "30", label: "30 days after it settles" },
];
export const cleanupLabel = (days: number | null) =>
  cleanupChoices.find((c) => c.value === (days === null ? "off" : String(days)))
    ?.label ?? `${days} days after it settles`;

export function ProjectWorktreeCleanupSelect({
  project,
}: {
  project: Project;
}) {
  const days = useProjectSetting(project, "worktreeCleanupDays");
  const appDays = useQuery({
    queryKey: ["worktree-cleanup-days"],
    queryFn: () => api.worktreeCleanupDays(),
  });
  const own = days.value;
  const value = own === undefined ? "app" : own === null ? "off" : String(own);
  return (
    <>
      <div className="composer-tools model-field">
        <ComposerSelect
          label="Remove settled threads' worktrees"
          value={value}
          options={[
            {
              value: "app",
              label:
                appDays.data === undefined
                  ? "Like the app"
                  : `Like the app (${cleanupLabel(appDays.data).toLowerCase()})`,
            },
            ...cleanupChoices,
            ...(own === undefined ||
            cleanupChoices.some((c) => c.value === value)
              ? []
              : [{ value, label: cleanupLabel(own) }]),
          ]}
          onChange={(next) =>
            days.change(
              next === "app" ? undefined : next === "off" ? null : +next,
            )
          }
        />
      </div>
      {!!days.error && <ErrorBox error={days.error} />}
    </>
  );
}

export function ProjectCommitSettleSwitch({ project }: { project: Project }) {
  const commit = useProjectSetting(project, "settleOnCommit");
  return (
    <>
      <Switch
        label="Settle threads after the agent commits"
        checked={!!commit.value}
        onChange={(on) => commit.change(on || undefined)}
      />
      {!!commit.error && <ErrorBox error={commit.error} />}
    </>
  );
}
