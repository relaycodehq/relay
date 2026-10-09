import { useRef } from "react";

/**
 * When each thread last held a draft in Activity, for `draftsFirst` to keep
 * it at the top once the draft is gone. Kept for this window only.
 */
export function useDraftRaise(drafted: ReadonlySet<string>) {
  const raised = useRef(new Map<string, number>());
  const now = Date.now();
  for (const id of drafted) raised.current.set(id, now);
  return raised.current;
}
