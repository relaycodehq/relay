import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { AccountProvider } from "../../../../shared/agent-accounts";
import type { ProviderUsage } from "../../../../shared/provider-usage";
import { api } from "../../../lib/api";
import { useAgentAccounts } from "../../accounts/agent-accounts";
import { roomAccounts } from "./room";

const REFRESH_MS = 60_000;
const usageKey = (provider: AccountProvider, id: string) => [
  "provider-usage",
  provider,
  id,
];

/**
 * Every signed-in account's limits, read again each minute while the page is
 * open. The main process caches readings, so the composer asking too costs one.
 */
export function useRoom() {
  const qc = useQueryClient();
  const signedIn =
    useAgentAccounts()?.accounts.filter((a) => a.signedIn) ?? [];
  const readings = useQueries({
    queries: signedIn.map((a) => ({
      queryKey: usageKey(a.provider, a.id),
      queryFn: () => api.providerUsage(a.provider, false, a.id),
      refetchInterval: REFRESH_MS,
    })),
  });
  const [checking, setChecking] = useState(false);
  const usageOf = (provider: AccountProvider, id: string) =>
    readings[signedIn.findIndex((a) => a.provider === provider && a.id === id)]
      ?.data;
  const accounts = roomAccounts(signedIn, usageOf, Date.now());
  const put = (provider: AccountProvider, id: string, usage: ProviderUsage) =>
    qc.setQueryData(usageKey(provider, id), usage);
  /** Past the cache, for after signing in or spending a reset elsewhere. */
  const recheck = async () => {
    setChecking(true);
    try {
      // One that fails keeps its last reading.
      await Promise.allSettled(
        signedIn.map((a) =>
          api
            .providerUsage(a.provider, true, a.id)
            .then((usage) => put(a.provider, a.id, usage)),
        ),
      );
    } finally {
      setChecking(false);
    }
  };
  return { accounts, checking, recheck, put };
}
export type Room = ReturnType<typeof useRoom>;
