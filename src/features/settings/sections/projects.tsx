import { useState } from "react";
import type { SettingEntry } from "../settings-search";
import {
  ProjectAutoSettleSelect,
  ProjectCommitSettleSwitch,
  ProjectFolderRow,
  ProjectNameField,
  ProjectPicker,
  ProjectWorkspaceSelect,
  useSettingsProjects,
} from "../../projects/ProjectSettings";

/** What one project does its own way, on the project picked at the top. */
export function useProjectEntries(
  accountId: string | undefined,
  /** The project it opens on; the first one otherwise. */
  initialProject: string | undefined,
): SettingEntry[] {
  const projects = useSettingsProjects(accountId);
  const [projectId, setProjectId] = useState(initialProject);
  const project = projects?.find((p) => p.id === projectId) ?? projects?.[0];
  if (!project || !projects) return [];
  return [
    {
      id: "project",
      category: "projects",
      title: "Project",
      description: "The project the settings below are for.",
      keywords: "pick choose which repository folder",
      render: () => (
        <ProjectPicker
          projects={projects}
          value={project}
          onChange={setProjectId}
        />
      ),
    },
    {
      id: "project-name",
      category: "projects",
      title: "Name",
      description:
        "Its name in the sidebar and thread lists. The folder on disk keeps its own.",
      keywords: "rename project title sidebar",
      render: () => <ProjectNameField project={project} />,
    },
    {
      id: "project-folder",
      category: "projects",
      title: "Folder",
      keywords: "path location finder reveal disk",
      render: () => <ProjectFolderRow project={project} />,
    },
    ...(project.plain
      ? []
      : [
          {
            id: "project-workspace",
            category: "projects",
            section: "New threads",
            title: "Where new threads start",
            description:
              "What a new thread in this project picks first. You can still change it for each thread before its first message.",
            keywords: "workspace worktree checkout branch folder default",
            render: () => <ProjectWorkspaceSelect project={project} />,
          } satisfies SettingEntry,
        ]),
    {
      id: "project-auto-settle",
      category: "projects",
      section: "Auto-settle",
      title: "Settle quiet threads",
      description:
        "How long this project's threads stay quiet before they move to Settled, or Relay sees their PR merged.",
      keywords:
        "settle settled auto automatic inactive quiet days merged pull request done",
      render: () => <ProjectAutoSettleSelect project={project} />,
    },
    {
      id: "project-commit-settle",
      category: "projects",
      section: "Auto-settle",
      title: "Settle after the agent commits",
      description:
        "Once a turn ends on the agent's own commit and the thread stays quiet for 15 minutes. Writing again brings it back.",
      keywords: "settle settled auto commit git done finished trigger agent",
      render: () => <ProjectCommitSettleSwitch project={project} />,
    },
  ];
}
