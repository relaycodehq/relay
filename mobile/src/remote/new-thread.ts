import type { RemoteChatSummary, RemoteProject } from "../../../shared/remote";

/** A project's id, or a Scratchpad chat in whichever folder the desktop hands out. */
export type Where = string | "scratch";

/** The projects a new thread can start in, the one used last first. */
export function projectsByUse(
  projects: readonly RemoteProject[],
  chats: readonly Pick<RemoteChatSummary, "projectId">[],
): RemoteProject[] {
  const order = new Map<string, number>();
  chats.forEach((c, i) => {
    if (!order.has(c.projectId)) order.set(c.projectId, i);
  });
  const rank = (p: RemoteProject) => order.get(p.id) ?? Infinity;
  return projects
    .filter((p) => !p.scratch)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * Where a new thread starts: what the screen was opened for, else where the
 * latest thread is. Undefined until the computer has listed its projects.
 */
export function startingWhere(
  overview:
    | {
        projects: readonly RemoteProject[];
        chats: readonly Pick<RemoteChatSummary, "projectId">[];
      }
    | undefined,
  asked: { project?: string; scratch?: string },
): Where | undefined {
  if (asked.scratch) return "scratch";
  if (!overview) return undefined;
  const of = (id?: string) => overview.projects.find((p) => p.id === id);
  // From a Scratchpad thread, /new means another Scratchpad chat, not that folder.
  const wanted = of(asked.project) ?? of(overview.chats[0]?.projectId);
  if (wanted) return wanted.scratch ? "scratch" : wanted.id;
  return overview.projects.find((p) => !p.scratch)?.id ?? "scratch";
}
