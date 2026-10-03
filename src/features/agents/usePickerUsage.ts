import { useEffect, useState } from "react";
import { usageProviders, type UsageProvider } from "../../../shared/agents";
import type { ProviderUsage } from "../../../shared/provider-usage";
import { api } from "../../lib/api";

/**
 * Each agent's usage for the picker's footer, read whenever it opens, and a
 * clock for the reset times that ticks while it is open.
 */
export function usePickerUsage(
  open: boolean,
  accountOf?: (provider: UsageProvider) => string | undefined,
) {
  const [usage, setUsage] = useState<
    Partial<Record<UsageProvider, ProviderUsage>>
  >({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    for (const provider of usageProviders) {
      void api
        .providerUsage(provider, false, accountOf?.(provider))
        .then((value) => {
          if (!cancel) setUsage((prev) => ({ ...prev, [provider]: value }));
        })
        .catch(() => {
          if (!cancel) {
            setUsage((prev) => ({
              ...prev,
              [provider]: {
                provider,
                windows: [],
                message: "Couldn't read usage",
              },
            }));
          }
        });
    }
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      cancel = true;
      clearInterval(tick);
    };
  }, [open]);
  return { usage, now };
}
