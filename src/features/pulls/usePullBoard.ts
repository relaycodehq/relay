import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
import type { Account, Progress, Review } from "../../../shared/types";
import { api } from "../../lib/api";
import { accountKey, accountOn } from "./usePullHosts";
import {
  PULL_BOARD,
  projectPullPage,
  refreshProjectPulls,
  type PullState,
} from "./project-pulls";
export { PULL_BOARD, type PullState } from "./project-pulls";
import {
  buildBoard,
  linkedProjects,
  onServer,
  pullKey,
  verdictOf,
  type Board,
  type BoardHost,
  type BoardInput,
  type BoardPull,
  type ListedPull,
  type Verdict,
} from "./pull-board";

const FILTERS = ["review_requested", "assigned", "created"] as const;

/**
 * The page's PRs: each host's three searches for what you're part of and
 * the first page of each linked project's list. Only your own open PRs cost
 * a request each, for their reviewers' verdicts.
 */
export function usePullBoard(
  accounts: Account[],
  projects: Project[],
  state: PullState,
) {
  const client = useQueryClient();
  const searches = useQueries({
    queries: accounts.flatMap((account) =>
      FILTERS.map((filter) => ({
        queryKey: [PULL_BOARD, "search", accountKey(account), filter, state],
        queryFn: () => api.search(filter, "", state, 1, account.server),
      })),
    ),
  });
  const linked = linkedProjects(
    projects,
    accounts.map((a) => a.server),
  );
  const lists = useQueries({
    queries: linked.map((p) =>
      projectPullPage(p, accountOn(accounts, p.repository?.server), state),
    ),
  });
  // The number of lists and searches follows the projects and hosts, so
  // each keys the memo as one string.
  const listsKey = lists
    .map((l, i) => `${linked[i].id}:${l.dataUpdatedAt}:${l.errorUpdatedAt}`)
    .join();
  const searchesKey = searches
    .map((q, i) => `${accounts[Math.floor(i / 3)].server}:${q.dataUpdatedAt}`)
    .join();
  const fresh = useMemo(() => {
    const input: BoardInput["lists"] = {};
    linked.forEach((p, i) => {
      const { data, error } = lists[i];
      if (data)
        input[p.id] = {
          items: data.items as ListedPull[],
          total: data.total ?? data.items.length,
        };
      else if (error) input[p.id] = { error };
    });
    const hosts = accounts.map((account, i): BoardHost => {
      const [review, assigned, created] = searches
        .slice(i * 3, i * 3 + 3)
        .map((q) => q.data?.items ?? []);
      return {
        server: account.server,
        login: account.user.login,
        review,
        assigned,
        created,
      };
    });
    return buildBoard({ hosts, projects, lists: input });
  }, [accounts, projects, searchesKey, listsKey]);
  const pending = pendingHosts(accounts, searches, lists, linked);
  const { board, holding } = useSettledBoard(fresh, !pending.length);
  const verdicts = useVerdicts(
    board.pulls.filter(
      (p) => p.relation === "mine" && p.state === "open" && !p.draft,
    ),
  );
  const started = useStarted(
    board.pulls.filter((p) => p.relation === "review" && p.state === "open"),
  );
  const failures = accounts.flatMap((account, i) => {
    const error =
      searches.slice(i * 3, i * 3 + 3).find((q) => q.error)?.error ??
      lists.find(
        (q, j) => q.error && linked[j].repository?.server === account.server,
      )?.error;
    return error ? [{ server: account.server, error }] : [];
  });
  return {
    board,
    verdicts,
    started,
    // A slow host mustn't hide the PRs another search or project already found.
    loading: !!pending.length && !board.pulls.length && !board.groups.length,
    // A held board was complete, so nothing is pending on what shows.
    pending: holding ? [] : pending,
    failures,
    fetching:
      searches.some((s) => s.isFetching) || lists.some((l) => l.isFetching),
    retry: (server: string) => {
      searches.forEach((s, i) => {
        if (s.error && accounts[Math.floor(i / 3)].server === server)
          void s.refetch();
      });
      lists.forEach((q, i) => {
        if (q.error && linked[i].repository?.server === server)
          void refreshProjectPulls(
            client,
            linked[i],
            accountOn(accounts, server),
            state,
          );
      });
    },
  };
}

function pendingHosts(
  accounts: Account[],
  searches: { isPending: boolean }[],
  lists: { isPending: boolean }[],
  linked: Project[],
) {
  return accounts
    .filter(
      (account, i) =>
        searches.slice(i * 3, i * 3 + 3).some((q) => q.isPending) ||
        lists.some(
          (q, j) =>
            q.isPending && linked[j].repository?.server === account.server,
        ),
    )
    .map((account) => account.server);
}

const HOLD_MS = 1500;

/**
 * Switching Open, Closed and All asks every host again. Until they have all
 * answered, the last full board stays up, so cards don't pop in and reshuffle
 * one host at a time. A slow host gets 1.5s before the partial board shows.
 */
function useSettledBoard(fresh: Board, settled: boolean) {
  const last = useRef<Board | null>(null);
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    setWaitedOut(false);
    if (settled) return;
    const timer = setTimeout(() => setWaitedOut(true), HOLD_MS);
    return () => clearTimeout(timer);
  }, [settled]);
  if (settled) last.current = fresh;
  const holding = !settled && !waitedOut && !!last.current;
  return { board: holding ? last.current! : fresh, holding };
}

function useVerdicts(pulls: BoardPull[]) {
  const results = useQueries({
    queries: pulls.map((p) => ({
      queryKey: [PULL_BOARD, "verdict", p.ref.server, pullKey(p.ref)],
      queryFn: async () => {
        const reviews: Review[] = [];
        for (let page: number | null = 1; page !== null;) {
          const result = await api.reviews(p.ref, page);
          reviews.push(...result.items);
          page = result.nextPage;
        }
        return verdictOf(reviews);
      },
    })),
  });
  const verdicts = new Map<string, Verdict | null>();
  pulls.forEach((p, i) =>
    verdicts.set(pullKey(p.ref), results[i].data ?? null),
  );
  return verdicts;
}

/** Review progress is saved on this computer, so asking is free. */
function useStarted(pulls: BoardPull[]) {
  const results = useQueries({
    queries: pulls.map((p) => ({
      // Shared with the review's own progress, which keeps it current.
      queryKey: [
        "progress",
        p.ref.server,
        p.ref.owner,
        p.ref.name,
        p.ref.number,
      ],
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

/** The next page each host still has, by server. */
type SearchPages = Record<string, number>;

/**
 * Every host's search across the repositories you can see, for the search
 * box. Each page asks the hosts that have more; one that fails is left out
 * of the rest, its error kept, unless they all do.
 */
export function usePullSearch(
  query: string,
  state: PullState,
  accounts: Account[],
) {
  const first: SearchPages = Object.fromEntries(
    accounts.map((a) => [a.server, 1]),
  );
  return useInfiniteQuery({
    queryKey: [PULL_BOARD, "find", accounts.map(accountKey), query, state],
    queryFn: async ({ pageParam }) => {
      const servers = Object.keys(pageParam);
      const answers = await Promise.allSettled(
        servers.map((server) =>
          api.search("all", query, state, pageParam[server], server),
        ),
      );
      const failed = answers.flatMap((a) =>
        a.status === "rejected" ? [a.reason as unknown] : [],
      );
      if (failed.length === answers.length) throw failed[0];
      const next: SearchPages = {};
      const items: ListedPull[] = [];
      let total: number | undefined = 0;
      answers.forEach((a, i) => {
        if (a.status !== "fulfilled") return;
        items.push(...a.value.items.map((item) => onServer(item, servers[i])));
        if (a.value.nextPage) next[servers[i]] = a.value.nextPage;
        total =
          a.value.total === undefined || total === undefined
            ? undefined
            : total + a.value.total;
      });
      return {
        items: items.sort(
          (a, b) =>
            (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
        ),
        total: failed.length ? undefined : total,
        nextPage: Object.keys(next).length ? next : null,
        failed,
      };
    },
    initialPageParam: first,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: !!query,
  });
}
