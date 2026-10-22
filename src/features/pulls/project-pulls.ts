import {
  queryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import type { Account } from "../../../shared/types";
import { api } from "../../lib/api";
import { accountKey } from "./usePullHosts";
import { useHostAccount } from "./useHostAccount";
import { bootstrapQuery } from "../../lib/workspace-queries";

export type PullState = "open" | "closed" | "all";
/** Every board request starts here, including the lists shared with the composer. */
export const PULL_BOARD = "pull-board";

export const projectPullsKey = (
  project: Project | undefined,
  account: Account | null | undefined,
  state?: PullState,
) => [
  PULL_BOARD,
  "project",
  project?.id,
  project?.repository,
  account ? accountKey(account) : null,
  ...(state ? [state] : []),
];

/** A page has one owner even when the board and paginated views need it together. */
export const projectPullPage = (
  project: Project | undefined,
  account: Account | null | undefined,
  state: PullState,
  page = 1,
) =>
  queryOptions({
    queryKey: [...projectPullsKey(project, account, state), "page", page],
    queryFn: () => api.projectPulls(project!.id, state, page),
    enabled: !!project,
    staleTime: 30_000,
  });

export function refreshProjectPulls(
  client: QueryClient,
  project: Project,
  account: Account | null | undefined,
  state: PullState,
) {
  return client.invalidateQueries({
    queryKey: projectPullsKey(project, account, state),
  });
}

/** Same identity as the board, without passing sign-in state through the composer. */
export function useProjectPullAccount(project: Project) {
  const boot = useQuery(bootstrapQuery);
  const host = useHostAccount(project.repository, boot.data?.account);
  return { account: host.account, pending: boot.isPending || host.pending };
}

/** The picker and repository page also share their loaded pagination. */
export function useProjectPulls(
  project: Project | undefined,
  account: Account | null | undefined,
  state: PullState,
  enabled = true,
) {
  const client = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: [...projectPullsKey(project, account, state), "list"],
    queryFn: ({ pageParam }) =>
      client.query(projectPullPage(project, account, state, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: enabled && !!project,
    staleTime: 30_000,
  });
  return {
    ...list,
    refetch: () =>
      project
        ? refreshProjectPulls(client, project, account, state)
        : Promise.resolve(),
  };
}
