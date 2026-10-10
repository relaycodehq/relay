import { persistedStore } from "./persisted-store";

/**
 * What this person has used at least once on this device, by key: a shortcut
 * as `shortcut:<id>`, a feature by its own name. Tips read it, so nobody is
 * told about something they already do.
 */
const used = persistedStore<string[]>(
  "relay-used",
  (saved) => {
    try {
      const keys: unknown = JSON.parse(saved ?? "[]");
      return Array.isArray(keys)
        ? keys.filter((k): k is string => typeof k === "string")
        : [];
    } catch {
      return [];
    }
  },
  (keys) => JSON.stringify(keys),
);

export function noteUsed(key: string) {
  const keys = used.get();
  if (!keys.includes(key)) used.set([...keys, key]);
}

export const usedKeys = (): ReadonlySet<string> => new Set(used.get());
