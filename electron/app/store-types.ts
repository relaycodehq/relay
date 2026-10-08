import type { PhoneAppReport } from "../../shared/phone-app";
import type { DeviceKind, PhoneAppearance } from "../../shared/remote";

// Shapes the store saves for other folders. They live here so the store can
// name them without importing the folders that own the code around them.

export interface RemoteDevice {
  id: string;
  name: string;
  /** Unset for a phone. */
  kind?: DeviceKind;
  created: number;
  lastSeen?: number;
  /** SHA-256 of the device's token; the token itself only lives on the phone. */
  tokenHash: string;
  app?: PhoneAppReport;
}
export interface RemoteSettings {
  enabled?: boolean;
  /** The bridge's X25519 secret: sealed by the OS credential store, or `plain:` where there is none. */
  key?: string;
  devices?: RemoteDevice[];
  /** The desktop's last theme, for phones that connect before its window draws. */
  appearance?: PhoneAppearance;
}

/** A computer this one hands threads to, as the phone keeps its desktop. */
export interface SavedComputer {
  id: string;
  name: string;
  hosts: string[];
  port: number;
  /** Its bridge's public key, pinned. */
  key: string;
  deviceId: string;
  /** This computer's token there: sealed by the OS credential store, or `plain:` where there is none. */
  token: string;
  /** Hand-backs whose last word didn't reach it yet; said again when it's online. */
  unacknowledged?: string[];
  /** Handoffs taken back without it whose notice didn't reach it yet; said again when it's online. */
  abandoned?: string[];
}
