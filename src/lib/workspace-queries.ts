import { useQuery } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import { api } from "./api";

// The queries several screens share, so each reads one cache entry and a
// change one of them hears reaches every other.

/** What the window opened with: the account, the settings the shell starts from. */
export const bootstrapQuery = {
  queryKey: ["bootstrap"],
  queryFn: () => api.bootstrap(),
  staleTime: Infinity,
} as const;

/** Every project; another account's sign-in lists its own, so the account is in the key. */
export const projectsQuery = (accountId: string | undefined) => ({
  queryKey: ["projects", accountId],
  queryFn: () => api.projects(),
});

/** A project's threads, kept current by the desktop's pushes; see ./chat-events. */
export const projectChatsQuery = (projectId: string) => ({
  queryKey: ["project-chats", projectId],
  queryFn: () => api.projectChats(projectId),
});

/** The projects as the signed-in account sees them, picked over with `select`. */
export function useProjectList<T = Project[]>(
  select?: (projects: Project[]) => T,
) {
  const boot = useQuery(bootstrapQuery);
  return useQuery({
    ...projectsQuery(boot.data?.account?.id),
    enabled: !!boot.data,
    select,
  });
}
