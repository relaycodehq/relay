import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReviewTarget } from "../../../../shared/deep-review";
import { passCoverage, type ReviewPass } from "../../../../shared/review-passes";
import { suggestPasses } from "../../../../shared/suggest-passes";
import { api } from "../../../lib/api";
import { readJson, writeJson } from "../../../lib/persisted-store";
import { runnablePasses } from "./pass-tree";

const seamsKey = "deep-review-seams";

/**
 * The passes a new deep review runs in: Relay's suggestion for what it
 * reviews, until you change them. Changing what it reviews starts over
 * from the suggestion.
 */
export function useReviewPasses(
  projectId: string,
  target: ReviewTarget | undefined,
  /** Uncommitted files where it reads, so their list follows edits. */
  changes: number,
  /** A branch checked out in another folder, read there instead of the project folder. */
  on?: string,
) {
  const key = JSON.stringify(target ?? null);
  const files = useQuery({
    queryKey: ["deep-review-files", projectId, key, changes, on],
    queryFn: () => api.deepReviewFiles(projectId, target!, on),
    enabled: !!target,
    staleTime: 30_000,
  });
  const suggested = useMemo(
    () => suggestPasses(files.data ?? []),
    [files.data],
  );
  const [changed, setChanged] = useState<{ key: string; shown: ReviewPass[] }>();
  const edited = changed?.key === key;
  const shown = edited ? changed.shown : suggested;
  const passes = runnablePasses(shown);
  const [seams, keepSeams] = useState(() => readJson(seamsKey) !== false);
  return {
    files: files.data,
    edited,
    /** The passes the setup shows: a pass emptied by a move stays, so the rest keep their numbers. */
    shown,
    passes,
    coverage: files.data ? passCoverage(passes, files.data) : undefined,
    /** A last pass over how the parts fit together, which only a split review has. */
    seams: seams && passes.length > 1,
    seamsOn: seams,
    setPasses: (next: ReviewPass[]) => setChanged({ key, shown: next }),
    /** Back to what Relay suggests. */
    reset: () => setChanged(undefined),
    setSeams: (on: boolean) => {
      keepSeams(on);
      writeJson(seamsKey, on);
    },
  };
}

export type ReviewPasses = ReturnType<typeof useReviewPasses>;
