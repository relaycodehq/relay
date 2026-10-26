// How a phone or another computer pairs with this one, and the desktop's own
// view of phone access for Settings.

import type { PhoneAppReport } from "./phone-app";
import type { PhoneAppearance } from "./remote-models";
import type { RouteKind } from "./remote-routes";

export const remoteProtocol = 1;
const remoteScheme = "relay-remote";
export const defaultRemotePort = 47821;
/** Where to get Tailscale: its download page for computers, Google Play for phones. */
export const tailscaleDownload = "https://tailscale.com/download";
export const tailscaleAndroid =
  "https://play.google.com/store/apps/details?id=com.tailscale.ipn";

/** What the desktop's QR code carries; the key pins the desktop the phone may talk to. */
export interface PairingLink {
  /** Addresses to try: on the local network, then on Tailscale. */
  hosts: string[];
  port: number;
  /** The desktop's X25519 public key, base64url. */
  key: string;
  /** One-time secret, traded for a device token on first contact. */
  code: string;
  /** The computer's name, shown on the phone. */
  name: string;
}

export function pairingUrl(link: PairingLink): string {
  const q = new URLSearchParams({
    h: link.hosts.join(","),
    p: String(link.port),
    k: link.key,
    c: link.code,
    n: link.name,
  });
  return `${remoteScheme}://pair?${q}`;
}

/** Accepts the link itself or a URL wrapping it, e.g. Expo Go's `exp://…/--/pair?…`. */
export function parsePairingUrl(text: string): PairingLink | null {
  const query = text.trim().match(/[/:]pair\?(.+)$/)?.[1];
  if (!query) return null;
  const q = new URLSearchParams(query);
  const hosts = (q.get("h") ?? "").split(",").filter(validHost),
    port = Number(q.get("p")),
    key = q.get("k") ?? "",
    code = q.get("c") ?? "",
    name = (q.get("n") ?? "").slice(0, 80) || "Relay";
  if (
    !hosts.length ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(key) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(code)
  )
    return null;
  return { hosts, port, key, code, name };
}

export const validHost = (host: string) =>
  /^[A-Za-z0-9.-]{1,253}$/.test(host) || /^\[[0-9a-fA-F:]+\]$/.test(host);

/** What a paired phone keeps to reconnect: the pinned desktop and its own token. */
export interface RemoteCredentials {
  hosts: string[];
  port: number;
  key: string;
  name: string;
  deviceId: string;
  token: string;
  /** Which way to try first; left out, the local network. */
  routes?: RouteKind[];
}

/** Phones leave the kind out; a computer pairs to hand threads over. */
export type DeviceKind = "computer";

/**
 * Tailscale on this computer. Phone access listens on its tailnet address,
 * and on the local network too when that's allowed.
 */
export interface PhoneTailnet {
  /** connected: on a tailnet; stopped: installed but off or signed out; missing: not found. */
  status: "connected" | "stopped" | "missing";
  /** Its Tailscale IPv4 addresses. */
  addresses: string[];
  /** This computer's name on the tailnet, when the tailscale CLI answers. */
  name?: string;
  /** Phones on the tailnet, when the tailscale CLI answers. */
  phones?: { name: string; online: boolean }[];
}

/** The desktop's own view of phone access, for Settings. */
export interface PhoneRemoteState {
  enabled: boolean;
  listening: boolean;
  error?: string;
  port: number;
  tailnet: PhoneTailnet;
  /** Phones on the same local network may connect too. */
  lan: boolean;
  /** Where phones reach this computer: local addresses first, then Tailscale's. */
  hosts: string[];
  /**
   * The address its bridge listens on, which `relay pipe` connects to: with
   * no Tailscale, its loopback, which only a pipe reaches (`listening` stays
   * false then).
   */
  bound?: string;
  devices: {
    id: string;
    name: string;
    kind?: DeviceKind;
    created: number;
    lastSeen?: number;
    online: boolean;
    /** As the phone last reported it; phones from before the report leave it out. */
    app?: PhoneAppReport;
  }[];
}

export interface PhonePairing {
  url: string;
  expiresAt: number;
}

export interface PhoneRemoteApi {
  /** The window's resolved theme, passed on to paired phones. */
  phoneAppearance(appearance: PhoneAppearance): Promise<void>;
  phoneRemoteState(): Promise<PhoneRemoteState>;
  setPhoneRemote(enabled: boolean): Promise<PhoneRemoteState>;
  setPhoneRemoteLan(lan: boolean): Promise<PhoneRemoteState>;
  /** A fresh QR link; the previous one stops working. */
  phonePairing(): Promise<PhonePairing>;
  revokePhone(deviceId: string): Promise<PhoneRemoteState>;
}
