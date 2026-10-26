import { persistedStore } from "../../lib/persisted-store";
import type { UpdateState } from "../../../shared/updates";
import { relayItem, shortVersion } from "./update-items";
import { useUpdates } from "./updates";

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

/** What Relay's update is up to, said after its version. */
function waitingPhrase(state: UpdateState): string | undefined {
  switch (state.status) {
    case "available":
      return "is available";
    case "downloading":
      return "is downloading";
    case "ready":
    case "waiting":
    case "installing":
      return "is ready to install";
    default:
      return undefined;
  }
}

/**
 * "Relay 0.24.2 is ready to install" while Relay's update waits and you've put
 * its toast off; undefined while the toast still says so itself.
 */
export function usePutOffRelayUpdate(): string | undefined {
  const { state } = useUpdates();
  const keys = putOffToasts.use();
  const item = relayItem(state);
  if (!state || !item?.version || !keys.includes(item.key)) return undefined;
  const phrase = waitingPhrase(state);
  return phrase && `Relay ${shortVersion(item.version)} ${phrase}`;
}
