import type { AccountProvider } from "../../../../shared/agent-accounts";
import { useState } from "react";
import { useUsageReadings } from "../../agents/provider-usage";
import { useAgentAccounts } from "../../accounts/agent-accounts";
import { roomAccounts } from "./room";

/**
 * Every signed-in account's limits, read again each minute while the page is
 * open. The main process caches readings, so the composer asking too costs one.
 */
export function useRoom() {
  const signedIn = useAgentAccounts()?.accounts.filter((a) => a.signedIn) ?? [];
  const { readings, refresh, put } = useUsageReadings(
    signedIn.map((a) => ({ provider: a.provider, account: a.id })),
  );
  const [checking, setChecking] = useState(false);
  const usageOf = (provider: AccountProvider, id: string) =>
    readings[signedIn.findIndex((a) => a.provider === provider && a.id === id)]
      ?.data;
  const accounts = roomAccounts(signedIn, usageOf, Date.now());
  /** Past the cache, for after signing in or spending a reset elsewhere. */
  const recheck = async () => {
    setChecking(true);
    try {
      // One that fails keeps its last reading.
      await Promise.allSettled(signedIn.map((a) => refresh(a.provider, a.id)));
    } finally {
      setChecking(false);
    }
  };
  return { accounts, checking, recheck, put };
}
export type Room = ReturnType<typeof useRoom>;
