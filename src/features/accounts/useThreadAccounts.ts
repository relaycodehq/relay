import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  accountsOf,
  hasAccounts,
  threadAccount,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import { useAgentAccounts } from "./agent-accounts";

type Pinned = Partial<Record<AccountProvider, string>>;

/**
 * The account each agent runs on in this composer's thread: the one the
 * thread keeps, else the one in use. A pick in a thread that exists is
 * saved to it at once; a new thread's goes out with its first message.
 */
export function useThreadAccounts(chatId?: string, pinned?: Pinned) {
  const state = useAgentAccounts();
  const [picked, setPicked] = useState<Pinned>({});
  const [error, setError] = useState<string>();
  /** Each agent's latest pick, so an older one failing leaves it be. */
  const latest = useRef<Partial<Record<AccountProvider, number>>>({});
  // The thread's saved account wins again whenever it changes.
  const saved = JSON.stringify(pinned ?? {});
  useEffect(() => {
    setPicked({});
    setError(undefined);
  }, [chatId, saved]);
  const of = (provider: string) =>
    state && hasAccounts(provider)
      ? threadAccount(state, provider, picked[provider] ?? pinned?.[provider])
      : undefined;
  return {
    state,
    of,
    /** More than one account to choose between. */
    several: (provider: string) =>
      !!state &&
      hasAccounts(provider) &&
      accountsOf(state, provider).length > 1,
    /** Why the last switch didn't stick. */
    error,
    pick(provider: AccountProvider, id: string) {
      const request = (latest.current[provider] ?? 0) + 1;
      latest.current[provider] = request;
      setPicked((now) => ({ ...now, [provider]: id }));
      setError(undefined);
      if (chatId)
        void api.setThreadAccount(chatId, provider, id).catch((e) => {
          if (latest.current[provider] !== request) return;
          setPicked(({ [provider]: _, ...rest }) => rest);
          setError(
            `Couldn't switch the account: ${e instanceof Error ? e.message : String(e)}`,
          );
        });
    },
  };
}
export type ThreadAccounts = ReturnType<typeof useThreadAccounts>;
