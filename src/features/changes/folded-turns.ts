import { useCallback, useState } from "react";
import { persistedStore } from "../../lib/persisted-store";
import { TURN_FOLDS } from "../../lib/thread-storage";

type Folds = ReturnType<typeof persistedStore<string[]>>;
// One store per thread, so a thread's own window follows the main one.
const stores = new Map<string, Folds>();

function foldsOf(chatId: string): Folds {
  let store = stores.get(chatId);
  if (!store) {
    store = persistedStore<string[]>(
      TURN_FOLDS + chatId,
      (saved) => {
        if (saved === null) return [];
        const ids: unknown = JSON.parse(saved);
        return Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : [];
      },
      (ids) => (ids.length ? JSON.stringify(ids) : null),
    );
    stores.set(chatId, store);
  }
  return store;
}

/**
 * Whether a turn's changed files are folded away, kept per thread on this
 * device. Without a thread it lasts only as long as the card.
 */
export function useFoldedTurn(chatId: string | undefined, messageId: string) {
  const store = foldsOf(chatId ?? "");
  const saved = store.use().includes(messageId);
  const [own, setOwn] = useState(false);
  const setFolded = useCallback(
    (folded: boolean) => {
      if (!chatId) return setOwn(folded);
      const rest = store.get().filter((id) => id !== messageId);
      store.set(folded ? [...rest, messageId] : rest);
    },
    [store, chatId, messageId],
  );
  return [chatId ? saved : own, setFolded] as const;
}
