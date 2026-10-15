import { useEffect } from "react";
import { api } from "../../lib/api";

/**
 * Opens the report page when the Help menu or a crash prompt asks, including
 * a prompt answered before this page loaded. Waits for `ready`: the shell
 * coming back to the last thread at launch would close the page again.
 */
export function useReportRequests(open: () => void, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const take = () =>
      void api.takeBugReportWanted().then(
        (wanted) => wanted && open(),
        () => {},
      );
    take();
    return api.onBugReport(take);
  }, [open, ready]);
}
