import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import type { Account, Progress } from "../../shared/types";
import { api } from "./api";
import {
  buildBoard,
  linkedProjects,
  pullKey,
  verdictOf,
  type BoardInput,
  type BoardPull,
  type ListedPull,
  type Verdict,
} from "./pull-board";

export type PullState = "open" | "closed" | "all";

/** Every query here starts with this, so one refresh reloads the page. */
export const PULL_BOARD = "pull-board";

/**
 * The page's PRs: the three searches for what you're part of and the first
 * page of each linked project's list. Only your own open PRs cost a request
 * each, for their reviewers' verdicts.
 */
export function usePullBoard(
  account: Account,
  projects: Project[],
  state: PullState,
) {
  const searches = useQueries({
    queries: (["review_requested", "assigned", "created"] as const).map(
      (filter) => ({
        queryKey: [PULL_BOARD, "search", account.id, filter, state],
        queryFn: () => api.search(filter, "", state, 1),
      }),
    ),
  });
  const linked = linkedProjects(projects, account.server);
  const lists = useQueries({
    queries: linked.map((p) => ({
      queryKey: [PULL_BOARD, "project", p.id, state],
      queryFn: () => api.projectPulls(p.id, state, 1),
    })),
  });
  const [review, assigned, created] = searches;
  // The number of lists follows the projects, so they key the memo as one string.
  const listsKey = lists
    .map((l, i) => `${linked[i].id}:${l.dataUpdatedAt}:${l.errorUpdatedAt}`)
    .join();
  const board = useMemo(() => {
    const input: BoardInput["lists"] = {};
    linked.forEach((p, i) => {
      const { data, error } = lists[i];
      if (error) input[p.id] = { error };
      else if (data)
        input[p.id] = {
          items: data.items as ListedPull[],
          total: data.total ?? data.items.length,
        };
    });
    return buildBoard({
      server: account.server,
      login: account.user.login,
      projects,
      review: review.data?.items ?? [],
      assigned: assigned.data?.items ?? [],
      created: created.data?.items ?? [],
      lists: input,
    });
  }, [
    account.server,
    account.user.login,
    projects,
    review.data,
    assigned.data,
    created.data,
    listsKey,
  ]);
  const verdicts = useVerdicts(
    board.pulls.filter(
      (p) => p.relation === "mine" && p.state === "open" && !p.draft,
    ),
  );
  const started = useStarted(
    board.pulls.filter((p) => p.relation === "review" && p.state === "open"),
  );
  return {
    board,
    verdicts,
    started,
    loading: searches.some((s) => s.isPending),
    error: searches.find((s) => s.error)?.error,
    fetching:
      searches.some((s) => s.isFetching) || lists.some((l) => l.isFetching),
    retry: () => searches.forEach((s) => s.error && void s.refetch()),
  };
}

function useVerdicts(pulls: BoardPull[]) {
  const results = useQueries({
    queries: pulls.map((p) => ({
      queryKey: [PULL_BOARD, "verdict", pullKey(p.ref)],
      queryFn: async () => verdictOf((await api.reviews(p.ref, 1)).items),
    })),
  });
  const verdicts = new Map<string, Verdict | null>();
  pulls.forEach((p, i) =>
    verdicts.set(pullKey(p.ref), results[i].data ?? null),
  );
  return verdicts;
}

/** Review progress is saved on this Mac, so asking is free. */
function useStarted(pulls: BoardPull[]) {
  const results = useQueries({
    queries: pulls.map((p) => ({
      // Shared with the review's own progress, which keeps it current.
      queryKey: ["progress", p.ref.owner, p.ref.name, p.ref.number],
      queryFn: () => api.progress(p.ref),
      staleTime: Infinity,
    })),
  });
  const started = new Set<string>();
  pulls.forEach((p, i) => {
    const progress = results[i].data as Progress | undefined;
    if (
      progress &&
      (Object.keys(progress.read).length || progress.drafts.length)
    )
      started.add(pullKey(p.ref));
  });
  return started;
}

/** Gitea's search across every repository you can see, for the search box. */
export function usePullSearch(
  query: string,
  state: PullState,
  accountId: string,
) {
  return useQuery({
    queryKey: [PULL_BOARD, "find", accountId, query, state],
    queryFn: () => api.search("all", query, state, 1),
    enabled: !!query,
  });
}
