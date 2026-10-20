import { MachineLoads, ProcessOverviews } from "../processes";
import { type ApiContext, type Handlers } from "./context";

/** The Processes page: what Relay and its agents run, across projects. */
export function processHandlers(ctx: ApiContext) {
  const overviews = new ProcessOverviews({
    // A project on another computer runs its processes there.
    projects: () =>
      (ctx.store.get().projects ?? []).flatMap((p) =>
        p.removed || p.computer ? [] : [{ id: p.id, name: p.name }],
      ),
    taskFolder: (id) => ctx.projects.taskFolder(id),
    worktrees: (id) => ctx.projectChats.worktreeFolders(id),
    chats: (id) => ctx.listChats(id),
  });
  const machine = new MachineLoads();
  return {
    processOverview: () => overviews.read(),
    machineLoad: () => machine.read(),
  } satisfies Handlers;
}
