import { useSyncExternalStore } from "react";
import type { DeviceHubState } from "../../../shared/devices";
import { api } from "../../lib/api";

let state: DeviceHubState | undefined;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;

function set(next: DeviceHubState) {
  state = next;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void) {
  unsubscribe ??= api.onDeviceHub(set);
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The device hub's last pushed state; unset until asked. */
export function useDeviceHub() {
  return useSyncExternalStore(subscribe, () => state);
}

/** The tab came to the front: a hub downloaded before starts without asking again. */
export async function showDeviceHub() {
  const now = await api.deviceHub();
  set(now);
  if (now.status === "stopped") await startDeviceHub();
}
export const startDeviceHub = () => api.startDeviceHub().then(set);
/** Its tab closed: the page goes; the hub and the devices keep running. */
export const closeDeviceView = () => void api.closeDeviceView();
