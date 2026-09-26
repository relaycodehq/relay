import {
  hostname,
  networkInterfaces,
  type NetworkInterfaceInfo,
} from "node:os";
import type { Store } from "../store";
import { toBase64Url } from "../../shared/remote-crypto";
import {
  defaultRemotePort,
  pairingUrl,
  type PhonePairing,
  type PhoneRemoteState,
} from "../../shared/remote";
import { RemoteBridge, type RemoteHost } from "./bridge";
import { RemoteDevices } from "./devices";
import { RemoteServer } from "./server";

/** Phone access: off until the user turns it on, and only reachable while on. */
export class PhoneRemote {
  readonly devices: RemoteDevices;
  private bridge: RemoteBridge;
  private server: RemoteServer;
  private error?: string;
  constructor(
    store: Store,
    seal: (value: string) => Promise<string | null>,
    unseal: (value: string) => Promise<string>,
    host: Omit<RemoteHost, "name">,
    port = defaultRemotePort,
    private interfaces = networkInterfaces,
  ) {
    this.devices = new RemoteDevices(store, seal, unseal);
    const name = () => hostname().replace(/\.local$/, "") || "Relay";
    this.bridge = new RemoteBridge({ ...host, name }, (event) =>
      this.server.broadcast(event),
    );
    this.server = new RemoteServer({
      devices: this.devices,
      port,
      name,
      handle: (method, args) => this.bridge.handle(method, args),
      onPresence: () => this.bridge.setWatching(this.server.online().size > 0),
    });
  }
  /** Resumes listening if phone access was on when Relay last quit. */
  async start() {
    if (this.devices.settings.enabled) await this.listen();
  }
  chatEvent(event: Parameters<RemoteBridge["chatEvent"]>[0]) {
    if (this.server.listening) this.bridge.chatEvent(event);
  }
  state(): PhoneRemoteState {
    const online = this.server.online();
    return {
      enabled: !!this.devices.settings.enabled,
      listening: this.server.listening,
      ...(this.error ? { error: this.error } : {}),
      port: this.server.port,
      hosts: remoteHosts(this.interfaces()),
      devices: this.devices.list().map((d) => ({
        id: d.id,
        name: d.name,
        created: d.created,
        lastSeen: d.lastSeen,
        online: online.has(d.id),
      })),
    };
  }
  async setEnabled(enabled: boolean) {
    await this.devices.setEnabled(enabled);
    if (enabled) await this.listen();
    else {
      this.error = undefined;
      this.bridge.setWatching(false);
      await this.server.close();
    }
    return this.state();
  }
  async pairing(): Promise<PhonePairing> {
    if (!this.server.listening) throw new Error("Turn on phone access first.");
    const hosts = remoteHosts(this.interfaces());
    if (!hosts.length)
      throw new Error("Connect this computer to a network first.");
    const key = await this.devices.key();
    const { code, expiresAt } = this.devices.newPairing();
    return {
      url: pairingUrl({
        hosts,
        port: this.server.port,
        key: toBase64Url(key.public),
        code,
        name: hostname().replace(/\.local$/, "") || "Relay",
      }),
      expiresAt,
    };
  }
  async revoke(deviceId: string) {
    await this.devices.revoke(deviceId);
    this.server.disconnect(deviceId);
    return this.state();
  }
  async close() {
    this.bridge.dispose();
    await this.server.close();
  }
  private async listen() {
    try {
      await this.server.listen();
      this.error = undefined;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

/**
 * IPv4 addresses a phone could reach: home and office networks first, then
 * VPNs like Tailscale (100.64.0.0/10), then anything else that isn't loopback
 * or link-local.
 */
export function remoteHosts(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const rank = (ip: string) => {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 192 && b === 168) return 0;
    if (a === 10 || (a === 172 && b >= 16 && b <= 31)) return 1;
    if (a === 100 && b >= 64 && b <= 127) return 2;
    return 3;
  };
  const found = Object.values(interfaces)
    .flat()
    .filter(
      (i): i is NetworkInterfaceInfo =>
        !!i &&
        i.family === "IPv4" &&
        !i.internal &&
        !i.address.startsWith("169.254."),
    )
    .map((i) => i.address);
  return [...new Set(found)].sort((x, y) => rank(x) - rank(y)).slice(0, 4);
}
