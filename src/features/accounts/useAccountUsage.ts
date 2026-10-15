import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { everyWhileShown } from "../../lib/while-shown";
import type { AccountProvider } from "../../../shared/agent-accounts";
import type { ProviderUsage } from "../../../shared/provider-usage";

const REFRESH_MS = 60_000;

/**
 * Each account's limits, read again every minute while the window shows. The main
 * process caches readings, so several views asking at once cost one.
 */
export function useAccountsUsage(
  provider: AccountProvider,
  ids: readonly string[],
): Record<string, ProviderUsage | undefined> {
  const [usage, setUsage] = useState<Record<string, ProviderUsage>>({});
  const key = ids.join(",");
  useEffect(() => {
    let cancel = false;
    const load = () => {
      for (const id of ids)
        void api
          .providerUsage(provider, false, id)
          .then((value) => {
            if (!cancel) setUsage((prev) => ({ ...prev, [id]: value }));
          })
          .catch(() => {});
    };
    load();
    const stop = everyWhileShown(load, REFRESH_MS);
    return () => {
      cancel = true;
      stop();
    };
  }, [provider, key]);
  return usage;
}
