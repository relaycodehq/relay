// Which threads moved since this phone last looked, as the desktop's sidebar
// keeps it per device: a thread is unread once it updates after its last visit.
import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RemoteChatSummary } from "../../../shared/remote";

const seenKey = "relay-thread-seen";
const sinceKey = "relay-thread-seen-since";

let seen: Record<string, number> = {};
/** Threads older than the phone's first look aren't news. */
let since = Number.POSITIVE_INFINITY;
let loading: Promise<void> | undefined;
let version = 0;
const listeners = new Set<() => void>();

function load() {
  loading ??= AsyncStorage.multiGet([seenKey, sinceKey])
    .then(([[, saved], [, first]]) => {
      seen = { ...(saved ? JSON.parse(saved) : {}), ...seen };
      since = Number(first) || Date.now();
      if (!first) void AsyncStorage.setItem(sinceKey, String(since));
      version++;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
  return loading;
}

/** Marks a thread read up to `updated`, while it's open on the phone. */
export function markSeen(id: string, updated: number) {
  if ((seen[id] ?? 0) >= updated) return;
  seen = { ...seen, [id]: updated };
  version++;
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(seenKey, JSON.stringify(seen));
}

const unread = (c: Pick<RemoteChatSummary, "id" | "updated" | "seenAt">) =>
  c.updated > Math.max(since, seen[c.id] ?? 0, c.seenAt ?? 0);

/** Whether a thread has news for this phone; re-renders when that changes. */
export function useUnread() {
  useEffect(() => void load(), []);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return unread;
}
