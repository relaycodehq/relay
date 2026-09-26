import * as SecureStore from "expo-secure-store";
import type { RemoteCredentials } from "../../../shared/remote";

const key = "relay-remote-credentials";

export async function loadCredentials(): Promise<RemoteCredentials | null> {
  const saved = await SecureStore.getItemAsync(key);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as RemoteCredentials;
  } catch {
    return null;
  }
}

export const saveCredentials = (credentials: RemoteCredentials) =>
  SecureStore.setItemAsync(key, JSON.stringify(credentials));

export const clearCredentials = () => SecureStore.deleteItemAsync(key);
