import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  saveUnsentAccountPicks,
  unsentAccountPicks,
} from "../../lib/thread-storage";
import {
  accountsOf,
  hasAccounts,
  threadAccount,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import { useAgentAccounts } from "./agent-accounts";
import { onThreadStarted } from "../agents/composer-settings";
import { errorMessage } from "../../../shared/error-message";

type Pinned = Partial<Record<AccountProvider, string>>;

/**
 * The account each agent runs on in this composer's thread: the one the
 * thread keeps, else the one in use. A pick in a thread that exists is
 * saved to it at once; a new thread's is kept under `settingsKey` until it
 * goes out with the first message.
 */
export function useThreadAccounts(
  { chatId, accounts: pinned }: { chatId?: string; accounts?: Pinned },
  settingsKey: string,
) {
  const state = useAgentAccounts();
  const unsent = !chatId;
  const [picked, setPicked] = useState<Pinned>(() =>
    unsent ? unsentAccountPicks(settingsKey) : {},
  );
  const [error, setError] = useState<string>();
  /** Each agent's latest pick, so an older one failing leaves it be. */
  const latest = useRef<Partial<Record<AccountProvider, number>>>({});
  // The thread's saved account wins again whenever it changes.
  const saved = JSON.stringify(pinned ?? {});
  useEffect(() => {
    setPicked(unsent ? unsentAccountPicks(settingsKey) : {});
    setError(undefined);
  }, [chatId, saved, settingsKey]);
  // The thread took the picks with it; the next draft here starts afresh.
  useEffect(() => {
    if (!unsent) return;
    return onThreadStarted(settingsKey, () => setPicked({}));
  }, [unsent, settingsKey]);
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
      setError(undefined);
      if (unsent) {
        const next = { ...picked, [provider]: id };
        setPicked(next);
        saveUnsentAccountPicks(settingsKey, next);
        return;
      }
      const request = (latest.current[provider] ?? 0) + 1;
      latest.current[provider] = request;
      setPicked((now) => ({ ...now, [provider]: id }));
      void api.setThreadAccount(chatId, provider, id).catch((e) => {
        if (latest.current[provider] !== request) return;
        setPicked(({ [provider]: _, ...rest }) => rest);
        setError(`Couldn't switch the account: ${errorMessage(e)}`);
      });
    },
  };
}

export type ThreadAccounts = ReturnType<typeof useThreadAccounts>;
