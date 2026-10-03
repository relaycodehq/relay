import { useEffect, useState } from "react";
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
  // The thread's own word wins once it changes, e.g. after a limit moved it.
  const saved = JSON.stringify(pinned ?? {});
  useEffect(() => setPicked({}), [chatId, saved]);
  const of = (provider: string) =>
    state && hasAccounts(provider)
      ? threadAccount(state, provider, picked[provider] ?? pinned?.[provider])
      : undefined;
  return {
    state,
    of,
    /** More than one account to choose between. */
    several: (provider: string) =>
      !!state && hasAccounts(provider) && accountsOf(state, provider).length > 1,
    pick(provider: AccountProvider, id: string) {
      setPicked((now) => ({ ...now, [provider]: id }));
      if (chatId)
        void api
          .setThreadAccount(chatId, provider, id)
          .catch(() => setPicked(({ [provider]: _, ...rest }) => rest));
    },
  };
}
export type ThreadAccounts = ReturnType<typeof useThreadAccounts>;
