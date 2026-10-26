import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReviewTarget } from "../../../../shared/deep-review";
import {
  parsePasses,
  passCoverage,
  passesText,
  type ReviewPass,
} from "../../../../shared/review-passes";
import { suggestPasses } from "../../../../shared/suggest-passes";
import { api } from "../../../lib/api";
import { readJson, writeJson } from "../../../lib/persisted-store";

const seamsKey = "deep-review-seams";

/**
 * The passes a new deep review runs in: Relay's suggestion for what it
 * reviews, until you write your own. Changing what it reviews starts over
 * from the suggestion.
 */
export function useReviewPasses(
  projectId: string,
  target: ReviewTarget | undefined,
  /** Uncommitted files in the checkout, so their list follows edits. */
  changes: number,
) {
  const key = JSON.stringify(target ?? null);
  const files = useQuery({
    queryKey: ["deep-review-files", projectId, key, changes],
    queryFn: () => api.deepReviewFiles(projectId, target!),
    enabled: !!target,
    staleTime: 30_000,
  });
  const suggested = useMemo(
    () => suggestPasses(files.data ?? []),
    [files.data],
  );
  const [written, setWritten] = useState<{ key: string; text: string }>();
  const edited = written?.key === key;
  const text = edited ? written.text : passesText(suggested);
  const passes = parsePasses(text);
  const [seams, keepSeams] = useState(() => readJson(seamsKey) !== false);
  return {
    files: files.data,
    edited,
    text,
    passes,
    coverage: files.data ? passCoverage(passes, files.data) : undefined,
    /** A last pass over how the parts fit together, which only a split review has. */
    seams: seams && passes.length > 1,
    seamsOn: seams,
    write: (next: string) => setWritten({ key, text: next }),
    setPasses: (next: ReviewPass[]) =>
      setWritten({ key, text: passesText(next) }),
    /** Back to what Relay suggests. */
    reset: () => setWritten(undefined),
    setSeams: (on: boolean) => {
      keepSeams(on);
      writeJson(seamsKey, on);
    },
  };
}

export type ReviewPasses = ReturnType<typeof useReviewPasses>;
