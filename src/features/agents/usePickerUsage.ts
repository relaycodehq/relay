import { usageProviders, type UsageProvider } from "../../../shared/agents";
import type { ProviderUsage } from "../../../shared/provider-usage";
import { useNow } from "../../lib/useNow";
import { useUsageReadings } from "./provider-usage";

/** The picker's account-scoped readings; opening it observes the same cache as the composer. */
export function usePickerUsage(
  open: boolean,
  accountOf?: (provider: UsageProvider) => string | undefined,
) {
  const { readings } = useUsageReadings(
    usageProviders.map((provider) => ({
      provider,
      account: accountOf?.(provider),
    })),
    open,
  );
  const usage = Object.fromEntries(
    usageProviders.map((provider, i) => [provider, readings[i].data]),
  ) as Partial<Record<UsageProvider, ProviderUsage>>;
  const now = useNow(20_000, open);
  return { usage, now };
}
