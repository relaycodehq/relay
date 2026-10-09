import { useRef } from "react";
import { draftSentAt } from "../composer/drafts";

/** A thread that held a draft in Activity, for `draftsFirst` to place. */
export interface DraftRaise {
  /** When it last had one. */
  at: number;
  /** That one went out rather than being cleared away. */
  sent: boolean;
}

/** Activity's threads that held a draft, kept for this window only. */
export function useDraftRaise(
  drafted: ReadonlySet<string>,
): ReadonlyMap<string, DraftRaise> {
  // `since`: when it got the draft it has, or last had; a send counts after it.
  const seen = useRef(
    new Map<string, { at: number; since: number; drafted: boolean }>(),
  );
  const now = Date.now();
  for (const [id, raise] of seen.current)
    if (!drafted.has(id)) raise.drafted = false;
  for (const id of drafted) {
    const was = seen.current.get(id);
    const since = was?.drafted ? was.since : now;
    seen.current.set(id, { at: now, since, drafted: true });
  }
  return new Map(
    [...seen.current].map(([id, { at, since }]) => [
      id,
      { at, sent: (draftSentAt(id) ?? -1) >= since },
    ]),
  );
}
