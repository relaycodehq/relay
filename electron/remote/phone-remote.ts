import { hostname } from "node:os";
import { z } from "zod";
import type { Store } from "../store";
import { toBase64Url } from "../../shared/remote-crypto";
import {
  defaultRemotePort,
  pairingUrl,
  type PhoneAppearance,
  type PhonePairing,
  type PhoneRemoteState,
} from "../../shared/remote";
import { RemoteBridge, type RemoteHost } from "./bridge";
import { RemoteDevices } from "./devices";
import { RemoteServer } from "./server";
import { tailnetProbe, type TailnetProbe } from "./tailscale";

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const paletteSchema = z
  .object({
    kind: z.enum(["light", "dark"]),
    sidebar: color,
    surface: color,
    toolbar: color,
    inbox: color,
    text: color,
    muted: color,
    border: color,
    hover: color,
    selected: color,
    accent: color,
    accentSoft: color,
    onAccent: color,
    diffAddition: color,
    diffDeletion: color,
  })
  .strict();
export const phoneAppearanceSchema = z
  .object({
    mode: z.enum(["system", "light", "dark"]),
    light: paletteSchema,
    dark: paletteSchema,
  })
  .strict();

/**
 * Phone access: off until the user turns it on, and only reachable while on,
 * and then only over Tailscale: it listens on this computer's tailnet address
 * alone, so a phone has to be on the same tailnet.
 */
export class PhoneRemote {
  readonly devices: RemoteDevices;
  private bridge: RemoteBridge;
  private server: RemoteServer;
  private error?: string;
  private watch?: NodeJS.Timeout;
  private syncing = Promise.resolve();
  constructor(
    store: Store,
    seal: (value: string) => Promise<string | null>,
    unseal: (value: string) => Promise<string>,
    host: Omit<RemoteHost, "name">,
    port = defaultRemotePort,
    private tailnet: TailnetProbe = tailnetProbe(),
  ) {
    this.devices = new RemoteDevices(store, seal, unseal);
    const name = () => hostname().replace(/\.local$/, "") || "Relay";
    this.bridge = new RemoteBridge(
      { ...host, name, appearance: () => this.devices.settings.appearance },
      (event) => this.server.broadcast(event),
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
    if (this.devices.settings.enabled) await this.follow();
  }
  /** Keeps the window's theme for phones, and hands a change to those online. */
  async setAppearance(appearance: PhoneAppearance) {
    if (
      JSON.stringify(appearance) ===
      JSON.stringify(this.devices.settings.appearance)
    )
      return;
    await this.devices.setAppearance(appearance);
    if (this.server.listening)
      this.server.broadcast({ kind: "appearance", appearance });
  }
  chatEvent(event: Parameters<RemoteBridge["chatEvent"]>[0]) {
    if (this.server.listening) this.bridge.chatEvent(event);
  }
  async state(): Promise<PhoneRemoteState> {
    const tailnet = await this.tailnet(true);
    const online = this.server.online();
    return {
      enabled: !!this.devices.settings.enabled,
      listening: this.server.listening,
      ...(this.error ? { error: this.error } : {}),
      port: this.server.port,
      tailnet,
      hosts: this.server.host ? [this.server.host] : [],
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
    if (enabled && (await this.tailnet()).status !== "connected")
      throw new Error("Connect this computer to Tailscale first.");
    await this.devices.setEnabled(enabled);
    if (enabled) await this.follow();
    else {
      clearInterval(this.watch);
      this.watch = undefined;
      await this.sync();
    }
    return this.state();
  }
  async pairing(): Promise<PhonePairing> {
    const host = this.server.host;
    if (!host) throw new Error("Turn on phone access first.");
    const key = await this.devices.key();
    const { code, expiresAt } = this.devices.newPairing();
    return {
      url: pairingUrl({
        hosts: [host],
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
    clearInterval(this.watch);
    this.watch = undefined;
    this.bridge.dispose();
    await this.server.close();
  }
  /** Listens now, and keeps up as Tailscale goes off, comes back or moves. */
  private async follow() {
    if (!this.watch) {
      this.watch = setInterval(() => void this.sync(), 10_000);
      this.watch.unref();
    }
    await this.sync();
  }
  /** Listens on this computer's Tailscale address while phone access is on, and nowhere else. */
  private sync() {
    this.syncing = this.syncing.then(async () => {
      const tailnet = this.devices.settings.enabled
        ? await this.tailnet()
        : undefined;
      const host =
        tailnet?.status === "connected" ? tailnet.addresses[0] : undefined;
      if (host === this.server.host) return;
      await this.server.close();
      this.error = undefined;
      if (!host) return;
      try {
        await this.server.listen(host);
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
    });
    return this.syncing;
  }
}
