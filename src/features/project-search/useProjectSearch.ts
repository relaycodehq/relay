import { useEffect, useState } from "react";
import type {
  ProjectSearchQuery,
  ProjectSearchResult,
} from "../../../shared/project-search";
import { api } from "../../lib/api";

export interface SearchState {
  /** The last answer, kept while the next search runs so the list does not blink. */
  result?: ProjectSearchResult;
  error?: unknown;
  loading: boolean;
}

/**
 * Searches the workspace as `query` changes, after `delayMs` of quiet. The
 * main process cancels the previous search in `slot` when the next one starts,
 * and the answer of one that was overtaken is never shown. `null` clears.
 * `again` re-runs the same query, e.g. after a replace.
 */
export function useProjectSearch(
  where: string,
  query: ProjectSearchQuery | null,
  slot: string,
  delayMs: number,
  again = 0,
): SearchState {
  const [state, setState] = useState<SearchState>({ loading: false });
  // A new object per render would re-run the effect; the query's content is its identity.
  const key = query && JSON.stringify(query);
  useEffect(() => {
    if (!key) {
      void api.cancelProjectSearch(slot).catch(() => {});
      setState({ loading: false });
      return;
    }
    const current = JSON.parse(key) as ProjectSearchQuery;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const timer = setTimeout(() => {
      api.searchProjectText(where, current, slot).then(
        (result) => {
          if (live && !result.cancelled) setState({ result, loading: false });
        },
        (error: unknown) => {
          if (live) setState({ error, loading: false });
        },
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [where, key, slot, delayMs, again]);
  useEffect(
    () => () => {
      void api.cancelProjectSearch(slot).catch(() => {});
    },
    [slot],
  );
  return state;
}
