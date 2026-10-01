import { useQueries } from "@tanstack/react-query";
import { chatIsEmpty } from "../../shared/chat-activity";
import type { Project } from "../../shared/projects";
import { api } from "./api";
import { SCRATCH_CHATS } from "./chat-events";
import { useAwayViews, withAway } from "./useAwayViews";

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
  const away = useAwayViews(lists.flatMap((q) => q.data ?? []));
  const all = lists
    .flatMap((q) => q.data ?? [])
    .filter((c) => !c.archivedAt && (c.id === chatId || !chatIsEmpty(c)))
    .map((c) => withAway(c, away[c.id]))
    .sort((a, b) => b.updated - a.updated);
  return { all, away };
}
