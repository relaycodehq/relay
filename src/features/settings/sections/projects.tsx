import type { Project } from "../../../../shared/projects";
import { LinkedFoldersSetting } from "../../linked-folders/LinkedFoldersSetting";
import type { SettingEntry } from "../settings-search";
import {
  ProjectAutoSettleSelect,
  ProjectCommitSettleSwitch,
  ProjectFolderRow,
  ProjectNameField,
  ProjectWorkspaceSelect,
  ProjectWorktreeCleanupSelect,
  ProjectWorktreeCommandField,
} from "../../projects/ProjectSettings";

/** What the project opened from its own menu does its own way. */
export function projectEntries(project: Project | undefined): SettingEntry[] {
  if (!project) return [];
  return [
    {
      id: "project-name",
      category: "project",
      title: "Name",
      description:
        "Its name in the sidebar and thread lists. The folder on disk keeps its own.",
      keywords: "rename project title sidebar",
      render: () => <ProjectNameField project={project} />,
    },
    {
      id: "project-folder",
      category: "project",
      title: "Folder",
      keywords: "path location finder reveal disk",
      render: () => <ProjectFolderRow project={project} />,
    },
    {
      id: "project-links",
      category: "project",
      section: "Linked folders",
      title: "Folders every thread reaches",
      description:
        "Other folders this project's agents may read, like the backend or shared types. A note tells the agent what's in each. /add-dir links one to a single thread.",
      keywords:
        "linked folders link add-dir directory repository backend frontend shared types monorepo access read write outside external",
      block: true,
      render: () => <LinkedFoldersSetting project={project} />,
    },
    ...(project.plain
      ? []
      : [
          {
            id: "project-workspace",
            category: "project",
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
      category: "project",
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
      category: "project",
      section: "Auto-settle",
      title: "Settle after the agent commits",
      description:
        "Once a turn ends on the agent's own commit and the thread stays quiet for 15 minutes. Writing again brings it back.",
      keywords: "settle settled auto commit git done finished trigger agent",
      render: () => <ProjectCommitSettleSwitch project={project} />,
    },
    ...(project.plain
      ? []
      : [
          {
            id: "project-worktree-cleanup",
            category: "project",
            section: "Worktrees",
            title: "Remove settled threads' worktrees",
            description:
              "Once this project's thread has been settled this long, its worktree goes and its branch stays. A worktree with uncommitted changes, or with something running in it, stays.",
            keywords:
              "worktree cleanup clean remove delete disk space settled branch folder prune",
            render: () => <ProjectWorktreeCleanupSelect project={project} />,
          } satisfies SettingEntry,
          {
            id: "project-worktree-setup",
            category: "project",
            section: "Worktrees",
            title: "Setup command",
            description:
              "Runs in each new worktree before its thread's first answer, in your login shell. RELAY_PORT_OFFSET, RELAY_WORKTREE and RELAY_PROJECT_ROOT tell it where it is. The thread shows what it printed; if it fails, the agent starts anyway and hears why. A .worktreeinclude file in the project names the ignored files, like .env, to copy in first.",
            keywords:
              "worktree setup install bootstrap script command npm env port offset worktreeinclude ignored copy",
            block: true,
            render: () => (
              <ProjectWorktreeCommandField
                project={project}
                setting="worktreeSetup"
                placeholder="npm ci"
              />
            ),
          } satisfies SettingEntry,
          {
            id: "project-worktree-teardown",
            category: "project",
            section: "Worktrees",
            title: "Teardown command",
            description:
              "Runs in a worktree before Relay removes it, like stopping its containers. The worktree goes even if it fails.",
            keywords:
              "worktree teardown cleanup remove script command docker stop",
            block: true,
            render: () => (
              <ProjectWorktreeCommandField
                project={project}
                setting="worktreeTeardown"
                placeholder="docker compose down"
              />
            ),
          } satisfies SettingEntry,
        ]),
  ];
}
