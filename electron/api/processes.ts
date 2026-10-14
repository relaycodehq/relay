import { ProcessOverviews } from "../processes";
import { type ApiContext, type Handlers } from "./context";

/** The Processes page: what Relay and its agents run, across projects. */
export function processHandlers(ctx: ApiContext) {
  const overviews = new ProcessOverviews({
    projects: () =>
      (ctx.store.get().projects ?? []).flatMap((p) =>
        p.removed ? [] : [{ id: p.id, name: p.name }],
      ),
    taskFolder: (id) => ctx.projects.taskFolder(id),
    worktrees: (id) => ctx.projectChats.worktreeFolders(id),
    chats: (id) => ctx.listChats(id),
  });
  return {
    processOverview: () => overviews.read(),
  } satisfies Handlers;
}
