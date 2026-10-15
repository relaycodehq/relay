import { useEffect, useState } from "react";
import type { CrashOffer } from "../../../shared/bug-report";
import { api } from "../../lib/api";

/** The last run's crash, offered once until it's reported or put off. */
export function useCrashOffer() {
  const [offer, setOffer] = useState<CrashOffer | null>(null);
  useEffect(() => {
    void api.crashReportOffer().then(setOffer, () => {});
  }, []);
  return {
    offer,
    report: () => {
      setOffer(null);
      api
        .reportCrash()
        .catch((e) => console.warn("Could not open the bug report:", e));
    },
    dismiss: () => {
      setOffer(null);
      void api.dismissCrashReport().catch(() => {});
    },
  };
}
