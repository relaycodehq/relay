import { useEffect } from "react";
import { api } from "../../lib/api";

/**
 * Opens the report page when the Help menu or a crash prompt asks, including
 * a prompt answered before this page loaded.
 */
export function useReportRequests(open: () => void) {
  useEffect(() => {
    const take = () =>
      void api.takeBugReportWanted().then(
        (wanted) => wanted && open(),
        () => {},
      );
    take();
    return api.onBugReport(take);
  }, [open]);
}
