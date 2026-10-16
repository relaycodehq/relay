import { useQueries } from "@tanstack/react-query";
import { chatIsEmpty } from "../../../shared/chat-activity";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { SCRATCH_CHATS } from "../../lib/chat-events";
import { useAwayViews, withAway } from "./useAwayViews";

/** Every project's threads and Scratchpad's, as listed, in no order. */
export const useEveryThread = (
  /** Every project but Scratchpad's. */
  projects: Project[],
) => useThreadLists(projects).threads;

/** `useEveryThread`, and whether every list has answered yet. */
function useThreadLists(projects: Project[]) {
  // Kept current by the desktop's pushes; see lib/chat-events.
  const lists = useQueries({
    queries: [
      ...projects.map((p) => ({
        queryKey: ["project-chats", p.id],
        queryFn: () => api.projectChats(p.id),
      })),
      // One list for every Scratchpad folder: there's one per chat.
      {
        queryKey: SCRATCH_CHATS,
        queryFn: () => api.scratchChats(),
      },
    ],
  });
  return {
    threads: lists.flatMap((q) => q.data ?? []),
    loaded: lists.every((q) => !q.isPending),
  };
}

/**
 * Every thread the sidebar lists, newest first: the projects' and
 * Scratchpad's, not archived, and not empty unless open. Handed-off threads
 * show as the computer they're on has them, by their `away` views.
 */
export function useSidebarThreads(
  /** Every project but Scratchpad's. */
  projects: Project[],
  chatId: string | undefined,
) {
  const { threads, loaded } = useThreadLists(projects);
  const away = useAwayViews(threads);
  const all = threads
    .filter((c) => !c.archivedAt && (c.id === chatId || !chatIsEmpty(c)))
    .map((c) => withAway(c, away[c.id]))
    .sort((a, b) => b.updated - a.updated);
  return { all, away, loaded };
}
