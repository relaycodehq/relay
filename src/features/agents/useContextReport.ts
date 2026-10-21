import { useQuery } from "@tanstack/react-query";
import type { ContextReport } from "../../../shared/context-report";

export type DatedReport = { report: ContextReport; at: number };

/** Counts what fills a session's window; null when it has no live session. */
export type ContextCounter = {
  /** Which session it counts, e.g. the thread and its side conversation. */
  key: string;
  count: () => Promise<ContextReport | null>;
};

/**
 * What fills the agent's window, counted while the meter's details are open.
 * Each count is kept until `version` changes (a new reply), so hovering
 * again doesn't ask again. Without a live session, `saved` (the thread's
 * latest /context answer) stands in.
 */
export function useContextReport({
  counter,
  version,
  open,
  saved,
}: {
  counter?: ContextCounter;
  version: string | number;
  open: boolean;
  saved?: DatedReport;
}): { shown?: DatedReport; live: boolean; counting: boolean } {
  const query = useQuery({
    queryKey: ["context-report", counter?.key, version],
    queryFn: async (): Promise<DatedReport | null> => {
      const report = await counter!.count();
      return report && { report, at: Date.now() };
    },
    enabled: open && !!counter,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
    // Keep Claude's last count for this session. An estimate must match the
    // reported total, especially when compaction has just shrunk the window.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === counter?.key && !previous?.report.estimated
        ? previous
        : undefined,
  });
  const live = query.data ?? undefined;
  const settled = query.isFetched || query.isError;
  return {
    shown: live ?? (settled ? saved : undefined),
    live: !!live,
    counting: query.isFetching && !live,
  };
}
