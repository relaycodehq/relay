import { cpus, totalmem } from "node:os";
import { chatSettled } from "../../shared/chat-activity";
import type { ChatSummary } from "../../shared/projects";
import type { ProcessOverview } from "../../shared/processes";
import { agentName, projectTasks } from "../terminal/tasks";
import { buildOverview } from "./overview";

export { buildOverview } from "./overview";
export { MachineLoads } from "./machine-load";

/** What the Processes page reads from the rest of Relay. */
export interface ProcessSources {
  projects(): { id: string; name: string }[];
  taskFolder(projectId: string): Promise<string>;
  worktrees(projectId: string): { path: string; chatId: string }[];
  chats(projectId: string): ChatSummary[];
}

const platform = (): ProcessOverview["platform"] =>
  process.platform === "darwin" ||
  process.platform === "linux" ||
  process.platform === "win32"
    ? process.platform
    : "other";

/** Everything Relay and its agents run, by project and folder. */
export class ProcessOverviews {
  constructor(private sources: ProcessSources) {}

  async read(): Promise<ProcessOverview> {
    const listed = this.sources.projects();
    const projects = await Promise.all(
      listed.map(async (p) => {
        const root = await this.sources.taskFolder(p.id);
        const worktrees = this.sources.worktrees(p.id);
        const tasks = await projectTasks
          .list(root, worktrees, { costed: true })
          .catch(() => []);
        return {
          ...p,
          root,
          worktrees,
          tasks: tasks.map((t) => ({ ...t, members: projectTasks.members(t.id) })),
        };
      }),
    );
    // Read after the lists, and even with no projects to list.
    const rows = await projectTasks.costedTable();
    const relayPids = [process.pid, ...projectTasks.hosts()];
    const agents = rows.filter((r) => agentName(r.line));
    const agentFolders = await projectTasks.workingFolders(agents);
    const threads = new Map<
      string,
      { title: string; settled: boolean; projectId: string }
    >();
    for (const p of listed)
      for (const c of this.sources.chats(p.id))
        threads.set(c.id, {
          title: c.title,
          settled: chatSettled(c),
          projectId: p.id,
        });
    const now = Date.now();
    return buildOverview({
      rows,
      relayPids,
      terminals: projectTasks.terminalShells(),
      projects,
      agentOf: agentName,
      agentFolders,
      agentWork: (pid, started) => projectTasks.agentWork(pid, started),
      cpuOf: (row) => row.cpu,
      threads,
      machine: { cores: cpus().length, totalMb: Math.round(totalmem() / 2 ** 20) },
      platform: platform(),
      now,
    });
  }
}
