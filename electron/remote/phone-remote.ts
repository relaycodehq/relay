import { hostname } from "node:os";
import { z } from "zod";
import type { Store } from "../store";
import type { ProjectChatsEvent } from "../../shared/events";
import { toBase64Url } from "../../shared/remote-crypto";
import {
  computerMethods,
  defaultRemotePort,
  maxDictationChunk,
  pairingUrl,
  type PhoneAppearance,
  type PhonePairing,
  type PhoneRemoteState,
  updateMethods,
} from "../../shared/remote";
import { RemoteBridge, type RemoteHost } from "./bridge";
import { RemoteDevices } from "./devices";
import { PhoneDictations } from "./phone-dictation";
import { RemoteServer } from "./server";
import { tailnetProbe, type TailnetProbe } from "./tailscale";

const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const appReportSchema = z
  .object({
    version,
    updated: z.boolean(),
    apk: version,
    updates: z.boolean(),
    update: z
      .object({
        kind: z.enum(["downloading", "ready", "apk"]),
        version,
      })
      .strict()
      .optional(),
    failed: version.optional(),
  })
  .strict();

const dictationId = z.number().int().nonnegative();
const dictationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), id: dictationId }).strict(),
  z
    .object({
      type: z.literal("audio"),
      id: dictationId,
      pcm: z
        .string()
        .max(maxDictationChunk)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .strict(),
  z.object({ type: z.literal("stop"), id: dictationId }).strict(),
  z.object({ type: z.literal("cancel"), id: dictationId }).strict(),
]);

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
  private dictations?: PhoneDictations;
  private error?: string;
  private watch?: NodeJS.Timeout;
  private syncing = Promise.resolve();
  constructor(
    store: Store,
    seal: (value: string) => Promise<string | null>,
    unseal: (value: string) => Promise<string>,
    private host: Omit<RemoteHost, "name">,
    port = defaultRemotePort,
    private tailnet: TailnetProbe = tailnetProbe(),
  ) {
    this.devices = new RemoteDevices(store, seal, unseal);
    const name = () => hostname().replace(/\.local$/, "") || "Relay";
    this.bridge = new RemoteBridge(
      { ...host, name, appearance: () => this.devices.settings.appearance },
      (event) => this.server.broadcast(event, (id) => !this.isComputer(id)),
    );
    if (host.dictation) this.dictations = new PhoneDictations(host.dictation);
    this.server = new RemoteServer({
      devices: this.devices,
      port,
      name,
      handle: async (method, args, deviceId) => {
        const device = this.devices.list().find((d) => d.id === deviceId);
        const computer = device?.kind === "computer";
        if ((computerMethods as readonly string[]).includes(method)) {
          const either = (updateMethods as readonly string[]).includes(method);
          if (!(computer || either) || !device || !host.handoffs)
            throw new Error("Only a paired computer can do that.");
          return host.handoffs.handle(
            method as (typeof computerMethods)[number],
            args,
            device,
          );
        }
        if (computer) throw new Error("Computers can't do that.");
        if (method === "reportApp")
          return this.devices.setApp(deviceId, appReportSchema.parse(args[0]));
        if (method === "dictate") {
          if (!this.dictations)
            throw new Error("Dictation isn't available on this computer.");
          return this.dictations.handle(
            deviceId,
            dictationSchema.parse(args[0]),
          );
        }
        return this.bridge.handle(method, args);
      },
      // Thread states are watched for phones; computers ask for theirs.
      onPresence: () =>
        this.bridge.setWatching(
          [...this.server.online()].some((id) => !this.isComputer(id)),
        ),
    });
  }
  private isComputer(deviceId: string) {
    return (
      this.devices.list().find((d) => d.id === deviceId)?.kind === "computer"
    );
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
      this.server.broadcast(
        { kind: "appearance", appearance },
        (id) => !this.isComputer(id),
      );
  }
  chatEvent(event: Parameters<RemoteBridge["chatEvent"]>[0]) {
    if (this.server.listening) this.bridge.chatEvent(event);
  }
  chatsEvent(event: ProjectChatsEvent) {
    if (this.server.listening) this.bridge.chatsChanged(event.projectId);
  }
  async state(): Promise<PhoneRemoteState> {
    const [tailnet, phoneApp] = await Promise.all([
      this.tailnet(true),
      this.host.phoneApp?.release(),
    ]);
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
        ...(d.kind ? { kind: d.kind } : {}),
        created: d.created,
        lastSeen: d.lastSeen,
        online: online.has(d.id),
        ...(d.app ? { app: d.app } : {}),
      })),
      ...(phoneApp ? { phoneApp: phoneApp.version } : {}),
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
    const computer = this.isComputer(deviceId);
    await this.devices.revoke(deviceId);
    this.server.disconnect(
      deviceId,
      computer
        ? `${hostname().replace(/\.local$/, "") || "Relay"} removed this computer.`
        : undefined,
    );
    return this.state();
  }
  async close() {
    clearInterval(this.watch);
    this.watch = undefined;
    this.bridge.dispose();
    this.dictations?.dispose();
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
