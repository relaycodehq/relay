import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { revisionOf, type Pull, type PullRef } from "../../../shared/types";
import type { ReviewProgressController } from "./useReviewProgress";
import { api } from "../../lib/api";

const headOf = (revision: string) => revision.split(":")[1] ?? "";

/**
 * Works like Gitea: a push unmarks only the viewed files it changed. Unchanged
 * files move to the new revision. Changed ones keep the revision they were
 * viewed at and are returned, so the list can say why they're unviewed.
 */
export function useViewedCarryOver(
  ref: PullRef | null,
  pull: Pull | undefined,
  { progress, update, initial }: ReviewProgressController,
): Set<string> {
  const revision = pull ? revisionOf(pull) : "",
    head = pull?.head.sha ?? "";
  const heads = useMemo(
    () =>
      [
        ...new Set(
          Object.values(progress.read)
            .filter((r) => r !== revision)
            .map(headOf)
            .filter((h) => /^[a-f0-9]{40,64}$/.test(h)),
        ),
      ].sort(),
    [progress.read, revision],
  );
  const changes = useQueries({
    queries: heads.map((from) => ({
      queryKey: [
        "changed-between",
        ref?.owner,
        ref?.name,
        ref?.number,
        from,
        head,
      ],
      queryFn: () => api.changedBetween(ref!, from, head),
      enabled: !!ref && !!head && initial.isSuccess,
      staleTime: Infinity,
      retry: false,
    })),
  });
  const settled = changes.map((c) => c.dataUpdatedAt).join();
  const changedSince = useMemo(
    () =>
      new Map(
        heads.flatMap((h, i) => {
          const data = changes[i]?.data;
          return data ? [[h, new Set(data)] as const] : [];
        }),
      ),
    // `changes` is a new array every render; `settled` changes with its data.
    [heads, settled],
  );
  const stale = Object.entries(progress.read).filter(
    ([, r]) => r !== revision && changedSince.has(headOf(r)),
  );
  const carry = stale.some(
    ([path, r]) => !changedSince.get(headOf(r))!.has(path),
  );
  useEffect(() => {
    if (!carry || !initial.isSuccess) return;
    update((p) => {
      const read = { ...p.read };
      for (const [path, r] of Object.entries(p.read))
        if (r !== revision && changedSince.get(headOf(r))?.has(path) === false)
          read[path] = revision;
      return { ...p, read };
    });
  }, [carry, changedSince, revision, initial.isSuccess, update]);
  return new Set(
    stale
      .filter(([path, r]) => changedSince.get(headOf(r))!.has(path))
      .map(([path]) => path),
  );
}
