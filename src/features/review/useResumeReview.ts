import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { revisionOf, type Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import { shouldResumeReview } from "./resumeReview";
import type { PullSelection } from "./usePullSelection";

/** The PR reopened at launch stays open only while your review of it goes on. */
export function useResumeReview(
  { selected, restoring, restored }: PullSelection,
  pull: Pull | undefined,
  userId: number,
) {
  const resume = useQuery({
    queryKey: ["resume", selected, pull && revisionOf(pull)],
    queryFn: () =>
      shouldResumeReview(pull!, userId, (ref, page) => api.reviews(ref, page)),
    enabled: restoring && !!pull,
    staleTime: 0,
  });
  useEffect(() => {
    if (!restoring || resume.data === undefined) return;
    restored(resume.data);
  }, [restoring, resume.data]);
  return resume;
}
