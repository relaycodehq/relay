import type { RemoteSite } from "../../shared/remote-tunnel";
import type { ProjectTask } from "../../shared/tasks";

/** What listing sites needs of the desktop: its projects, and their tasks through its own dispatch. */
export interface SiteSource {
  projects(): Promise<{ id: string; name: string }[]>;
  dispatch(method: "projectTasks", args: [string]): Promise<unknown>;
}

/**
 * The ports projects' tasks listen on, one site per port, the first task to
 * claim it winning; `refused` ports (the bridge's own) are left out. A project
 * whose tasks can't be read lists none.
 */
export async function listSites(
  source: SiteSource,
  refused: number[],
): Promise<RemoteSite[]> {
  const projects = await source.projects();
  // All at once: projects' lists asked for together share one `ps` and one `lsof`.
  const found = await Promise.all(
    projects.map(async (project) => {
      const tasks = (await source
        .dispatch("projectTasks", [project.id])
        .catch(() => [])) as ProjectTask[];
      return tasks.flatMap((task) =>
        task.ports.map((port): RemoteSite => ({
          port,
          title: task.title,
          command: task.command,
          projectId: project.id,
          project: project.name,
          ...(task.chatId ? { chatId: task.chatId } : {}),
          ...(task.worktree ? { worktree: true } : {}),
        })),
      );
    }),
  );
  const sites = new Map<number, RemoteSite>();
  for (const site of found.flat())
    if (!sites.has(site.port) && !refused.includes(site.port))
      sites.set(site.port, site);
  return [...sites.values()].sort((a, b) => a.port - b.port);
}
