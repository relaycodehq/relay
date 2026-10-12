import { persistedStore } from "../../lib/persisted-store";

const KEPT = 200;

/** Per thread, the latest workspace move the user looked at in its menu, on this device. */
const seen = persistedStore<Record<string, number>>(
  "relay-workspace-move-seen",
  (saved) => {
    const value: unknown = saved ? JSON.parse(saved) : {};
    return value && typeof value === "object"
      ? (value as Record<string, number>)
      : {};
  },
  (value) => JSON.stringify(value),
);

export const useWorkspaceMoveSeen = (chatId: string) =>
  seen.use()[chatId] ?? 0;

export function markWorkspaceMoveSeen(chatId: string, at: number) {
  const current = seen.get();
  if ((current[chatId] ?? 0) >= at) return;
  const { [chatId]: _, ...rest } = current;
  // Insertion order is age; the oldest threads drop off first.
  seen.set(
    Object.fromEntries([...Object.entries(rest), [chatId, at]].slice(-KEPT)),
  );
}
