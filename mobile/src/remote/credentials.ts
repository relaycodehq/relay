// The computers this phone is paired with, each by its bridge's public key,
// and which one it talks to. Each computer's credentials sit under a key of
// their own; the index only lists them.
import * as SecureStore from "expo-secure-store";
import type { RemoteCredentials } from "../../../shared/remote";

const indexKey = "relay-remote-computers";
const computerKey = (id: string) => `relay-remote-computer-${id}`;
/**
 * Where an app from before several were possible keeps its one computer. It
 * keeps holding the active one, so going back to the APK's built-in version
 * still finds a computer.
 */
const legacyKey = "relay-remote-credentials";

export interface Paired {
  /** Pairing order, oldest first; ids are the computers' public keys. */
  ids: string[];
  active?: string;
}

const parse = <T>(saved: string | null): T | null => {
  if (!saved) return null;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return null;
  }
};

export async function savePaired(
  paired: Paired,
  active?: RemoteCredentials,
) {
  await SecureStore.setItemAsync(indexKey, JSON.stringify(paired));
  if (active) await SecureStore.setItemAsync(legacyKey, JSON.stringify(active));
  else if (!paired.ids.length) await SecureStore.deleteItemAsync(legacyKey);
}

export async function loadPaired(): Promise<{
  paired: Paired;
  computers: RemoteCredentials[];
}> {
  let paired = parse<Paired>(await SecureStore.getItemAsync(indexKey));
  if (!paired) {
    const legacy = parse<RemoteCredentials>(
      await SecureStore.getItemAsync(legacyKey),
    );
    paired = legacy ? { ids: [legacy.key], active: legacy.key } : { ids: [] };
    if (legacy) await saveCredentials(legacy);
    await savePaired(paired);
  }
  const computers: RemoteCredentials[] = [];
  for (const id of paired.ids) {
    const saved = parse<RemoteCredentials>(
      await SecureStore.getItemAsync(computerKey(id)),
    );
    if (saved) computers.push(saved);
  }
  const ids = computers.map((c) => c.key);
  return {
    paired: {
      ids,
      active: ids.includes(paired.active ?? "") ? paired.active : ids[0],
    },
    computers,
  };
}

export const saveCredentials = (credentials: RemoteCredentials) =>
  SecureStore.setItemAsync(
    computerKey(credentials.key),
    JSON.stringify(credentials),
  );

export const clearCredentials = (id: string) =>
  SecureStore.deleteItemAsync(computerKey(id));
