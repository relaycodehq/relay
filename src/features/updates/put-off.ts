import { persistedStore } from "../../lib/persisted-store";

/** The keys of toasts put off, newest last; old ones fall away past this. */
const keepPutOff = 50;

/** Toasts you put off, shared by the toast stack and whatever reminds you of them. */
export const putOffToasts = persistedStore<string[]>(
  "relay.updateToasts.putOff",
  (saved) => {
    const keys: unknown = saved === null ? [] : JSON.parse(saved);
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
  },
  (keys) => JSON.stringify(keys),
);

export function putOff(key: string) {
  const others = putOffToasts.get().filter((k) => k !== key);
  putOffToasts.set([...others, key].slice(-keepPutOff));
}
