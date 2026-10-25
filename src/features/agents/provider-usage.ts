import { useEffect } from "react";
import {
  queryOptions,
  useQueries,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { UsageProvider } from "../../../shared/agents";
import { SYSTEM_ACCOUNT } from "../../../shared/agent-accounts";
import type { ProviderUsage } from "../../../shared/provider-usage";
import { api } from "../../lib/api";
import { everyWhileShown } from "../../lib/while-shown";

const REFRESH_MS = 60_000;
export type UsageAccount = { provider: UsageProvider; account?: string };
export const usageKey = (provider: UsageProvider, account = SYSTEM_ACCOUNT) =>
  ["provider-usage", provider, account] as const;
/** A redeemed reset wins over a poll that started before it. */
export async function putUsage(
  qc: QueryClient,
  provider: UsageProvider,
  account: string,
  usage: ProviderUsage,
) {
  await qc.cancelQueries({
    queryKey: usageKey(provider, account),
    exact: true,
  });
  qc.setQueryData(usageKey(provider, account), usage);
}

export const usageOptions = (
  provider: UsageProvider,
  account = SYSTEM_ACCOUNT,
) =>
  queryOptions({
    queryKey: usageKey(provider, account),
    queryFn: () => api.providerUsage(provider, false, account),
    staleTime: REFRESH_MS,
  });

/** Each observed account has one poll, shared by all its views in this window. */
const polling = new WeakMap<
  QueryClient,
  Map<string, { users: number; stop: () => void }>
>();

function follow(qc: QueryClient, { provider, account }: UsageAccount) {
  let accounts = polling.get(qc);
  if (!accounts) polling.set(qc, (accounts = new Map()));
  const key = JSON.stringify(usageKey(provider, account));
  let entry = accounts.get(key);
  if (!entry) {
    entry = {
      users: 0,
      stop: everyWhileShown(() => {
        void qc
          .query({ ...usageOptions(provider, account), staleTime: 0 })
          .catch(() => {});
      }, REFRESH_MS),
    };
    accounts.set(key, entry);
  }
  entry.users++;
  return () => {
    if (--entry.users) return;
    entry.stop();
    accounts.delete(key);
  };
}

export function useUsageReadings(
  accounts: readonly UsageAccount[],
  enabled = true,
) {
  const qc = useQueryClient();
  const readings = useQueries({
    queries: accounts.map(({ provider, account }) => ({
      ...usageOptions(provider, account),
      enabled,
    })),
  });
  const key = JSON.stringify(
    accounts.map(({ provider, account }) => usageKey(provider, account)),
  );
  useEffect(() => {
    if (!enabled) return;
    const stops = accounts.map((account) => follow(qc, account));
    return () => stops.forEach((stop) => stop());
  }, [qc, key, enabled]);
  const refresh = async (provider: UsageProvider, account = SYSTEM_ACCOUNT) => {
    // A force refresh must not join a cached reading already on its way back.
    await qc.cancelQueries({
      queryKey: usageKey(provider, account),
      exact: true,
    });
    return qc.query({
      ...usageOptions(provider, account),
      staleTime: 0,
      queryFn: () => api.providerUsage(provider, true, account),
    });
  };
  const put = async (
    provider: UsageProvider,
    account: string,
    usage: ProviderUsage,
  ) => {
    await putUsage(qc, provider, account, usage);
  };
  return {
    readings: readings.map((reading, i) => ({
      ...reading,
      data:
        reading.data ??
        (reading.isError
          ? ({
              provider: accounts[i].provider,
              windows: [],
              message: "Couldn’t read usage",
            } satisfies ProviderUsage)
          : undefined),
    })),
    refresh,
    put,
  };
}
