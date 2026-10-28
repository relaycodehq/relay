import { queryOptions } from "@tanstack/react-query";
import { api } from "../../lib/api";

/**
 * How far each branch is ahead and behind. Built out here, not inline in a
 * component: the cached query keeps the last fetch's `queryFn`, and a closure
 * made in a component keeps that whole render alive with it, a left thread's
 * composer and messages included.
 */
export const branchCountsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["project-branch-counts", projectId],
    queryFn: () => api.projectBranchCounts(projectId),
  });
