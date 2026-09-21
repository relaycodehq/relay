import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Progress, PullRef } from "../../shared/types";
import { emptyProgress } from "../../shared/types";
import { api } from "./api";

/** One optimistic progress owner for individual files, group actions and comment drafts. */
export function useReviewProgress(
  pull: PullRef | null,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const key = ["progress", pull?.owner, pull?.name, pull?.number];
  const identity = JSON.stringify(key);
  const initial = useQuery({
    queryKey: key,
    queryFn: () => api.progress(pull!),
    enabled: !!pull,
    staleTime: Infinity,
  });
  const current = useRef({
    identity,
    progress: initial.data ?? emptyProgress(),
    seq: 0,
  });
  const [save, setSave] = useState({ identity, state: "Saved locally" });
  if (current.current.identity !== identity)
    current.current = {
      identity,
      progress: initial.data ?? emptyProgress(),
      seq: 0,
    };
  else if (initial.data) current.current.progress = initial.data;
  const update = (fn: (p: Progress) => Progress): Progress => {
    if (!pull || !initial.isSuccess) return current.current.progress;
    const next = fn(current.current.progress);
    current.current.progress = next;
    qc.setQueryData(key, next);
    setSave({ identity, state: "Saving…" });
    const seq = ++current.current.seq;
    void api
      .saveProgress(pull, next)
      .then(() => {
        if (
          current.current.identity === identity &&
          seq === current.current.seq
        )
          setSave({ identity, state: "Saved locally" });
      })
      .catch((e) => {
        if (
          current.current.identity === identity &&
          seq === current.current.seq
        )
          setSave({ identity, state: "Not saved — retry" });
        onError(e);
      });
    return next;
  };
  return {
    progress: initial.data ?? current.current.progress,
    initial,
    update,
    saveState: save.identity === identity ? save.state : "Saved locally",
    retrySave: () => update((p) => p),
  };
}
export type ReviewProgressController = ReturnType<typeof useReviewProgress>;
