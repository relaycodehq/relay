import type { AccountProvider } from "../../../shared/agent-accounts";
import type { ProviderUsage } from "../../../shared/provider-usage";
import { useUsageReadings } from "../agents/provider-usage";

/** Account settings observes the same readings as the composer and Usage Room. */
export function useAccountsUsage(
  provider: AccountProvider,
  ids: readonly string[],
): Record<string, ProviderUsage | undefined> {
  const { readings } = useUsageReadings(
    ids.map((account) => ({ provider, account })),
  );
  return Object.fromEntries(ids.map((id, i) => [id, readings[i].data]));
}
