import { networkInterfaces } from "node:os";
import { z } from "zod";
import type { Store } from "../app/store";
import type { ProjectChatsEvent } from "../../shared/events";
import { toBase64Url } from "../../shared/remote-crypto";
import type { DraftChange } from "../../shared/drafts";
import type { NewsItem } from "../../shared/thread-news";
import {
  computerMethods,
  defaultRemotePort,
  draftsBridge,
  newsBridge,
  maxDictationChunk,
  maxReadAloudText,
  pairingUrl,
  type PhoneAppearance,
  type PhonePairing,
  type PhoneRemoteState,
  updateMethods,
} from "../../shared/remote";
import { maxHosts } from "../../shared/remote-routes";
import { RemoteBridge, type RemoteHost } from "./bridge";
import { RemoteDevices } from "./devices";
import { PhoneDictations } from "./phone-dictation";
import { PhoneReadings } from "./phone-read-aloud";
import { lanAddresses } from "./lan";
import { RemoteServer } from "./server";
import { tailnetProbe, type TailnetProbe } from "./tailscale";
import { computerName } from "../platform/computer-name";
import { listSites, Tunnel, TunnelPorts } from "../tunnel";
import { errorMessage } from "../../shared/error-message";

const version = z.string().regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/);
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

const readingId = z.number().int().nonnegative();
const readAloudSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      id: readingId,
      markdown: z.string().max(maxReadAloudText),
    })
    .strict(),
  z.object({ type: z.literal("pull"), id: readingId }).strict(),
  z.object({ type: z.literal("stop"), id: readingId }).strict(),
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
    send: color.optional(),
    onSend: color.optional(),
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
 * Phone access: off until the user turns it on, and only reachable while on.
 * It listens on this computer's tailnet address alone, so a phone has to be
 * on the same tailnet, unless the local network is allowed too: then it
 * listens everywhere and lets in the tailnet and private addresses. Either
 * way a device needs the pinned key and its token to get anything.
 */
const portSchema = z.number().int().min(1).max(65535);

const loopback = "127.0.0.1";

export class PhoneRemote {
  readonly devices: RemoteDevices;
  private bridge: RemoteBridge;
  private server: RemoteServer;
  private dictations?: PhoneDictations;
  private readings?: PhoneReadings;
  private error?: string;
  private watch?: NodeJS.Timeout;
  private syncing = Promise.resolve();
  /** Where devices reach this computer now: local addresses, then Tailscale's. */
  private hosts: string[] = [];
  private tunnelPorts: TunnelPorts;
  constructor(
    store: Store,
    seal: (value: string) => Promise<string | null>,
    unseal: (value: string) => Promise<string>,
    private host: Omit<RemoteHost, "name">,
    port = defaultRemotePort,
    private tailnet: TailnetProbe = tailnetProbe(),
    private lan: () => string[] = () => lanAddresses(networkInterfaces()),
  ) {
    this.devices = new RemoteDevices(store, seal, unseal);
    this.tunnelPorts = new TunnelPorts(() =>
      listSites(host, [this.server.port]),
    );
    const name = computerName;
    this.bridge = new RemoteBridge(
      { ...host, name, appearance: () => this.devices.settings.appearance },
      // Phones before drafts take any other event for a thread's message.
      (event) =>
        this.server.broadcast(
          event,
          (id, bridge) =>
            !this.isComputer(id) &&
            (event.kind !== "presence" || bridge >= draftsBridge),
        ),
    );
    if (host.dictation) this.dictations = new PhoneDictations(host.dictation);
    if (host.readAloud) this.readings = new PhoneReadings(host.readAloud);
    this.server = new RemoteServer({
      devices: this.devices,
      port,
      name,
      hosts: () => this.hosts,
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
        if (method === "readAloud") {
          if (!this.readings)
            throw new Error("Read aloud isn't available on this computer.");
          return this.readings.handle(deviceId, readAloudSchema.parse(args[0]));
        }
        if (method === "sites") return this.tunnelPorts.sites();
        if (method === "tunnelAllow")
          return this.tunnelPorts.type(deviceId, portSchema.parse(args[0]));
        return this.bridge.handle(method, args, deviceId);
      },
      tunnel: (deviceId, send) =>
        this.isComputer(deviceId)
          ? undefined
          : new Tunnel(send, {
              refused: () => [this.server.port],
              allowed: (port) => this.tunnelPorts.allowed(deviceId, port),
            }),
      // Thread states are watched for phones; computers ask for theirs.
      onPresence: () =>
        this.bridge.setWatching(
          [...this.server.online()].some((id) => !this.isComputer(id)),
        ),
    });
    host.handoffs?.connect?.({
      send: (deviceId, event) =>
        this.server.broadcast(event, (id) => id === deviceId),
    });
  }
  private isComputer(deviceId: string) {
    return (
      this.devices.list().find((d) => d.id === deviceId)?.kind === "computer"
    );
  }
  /** Resumes listening if phone access was on when Relay last quit. */
  async start(defaultEnabled = false) {
    if (defaultEnabled && this.devices.settings.enabled === undefined)
      await this.devices.setEnabled(true);
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
  /** Tells the phones that know drafts; older ones would take the event for a message. */
  draftChanged(change: DraftChange) {
    if (!this.server.listening) return;
    this.server.broadcast(
      { kind: "draft", change },
      (id, bridge) => !this.isComputer(id) && bridge >= draftsBridge,
    );
  }
  chatEvent(
    event: Parameters<RemoteBridge["chatEvent"]>[0] & { setup?: true },
  ) {
    // Phones don't show a thread's setup on another computer yet.
    if (!this.server.listening || event.setup) return;
    this.bridge.chatEvent(event);
    this.host.handoffs?.chatEvent?.(event);
  }
  /** News the computer decided; older phones read theirs off the thread lists. */
  news(item: NewsItem) {
    if (!this.server.listening) return;
    this.server.broadcast(
      { kind: "news", item },
      (id, bridge) => !this.isComputer(id) && bridge >= newsBridge,
    );
    // A computer hears only of the threads it handed over live, and remaps them.
    this.host.handoffs?.news?.(item);
  }
  /** Someone may have come to the computer or left it. */
  presenceChanged() {
    if (this.server.listening) this.bridge.presenceChanged();
  }
  chatsEvent(event: ProjectChatsEvent) {
    if (!this.server.listening) return;
    this.bridge.chatsChanged(event.projectId);
    this.host.handoffs?.chatsChanged?.(event.projectId);
  }
  async state(): Promise<PhoneRemoteState> {
    const tailnet = await this.tailnet(true);
    const online = this.server.online();
    return {
      enabled: !!this.devices.settings.enabled,
      lan: !!this.devices.settings.lan,
      listening: this.server.listening && this.hosts.length > 0,
      ...(this.error ? { error: this.error } : {}),
      port: this.server.port,
      ...(this.server.host ? { bound: this.server.host } : {}),
      tailnet,
      hosts: this.server.listening ? this.hosts : [],
      devices: this.devices.list().map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.kind ? { kind: d.kind } : {}),
        created: d.created,
        lastSeen: d.lastSeen,
        online: online.has(d.id),
        ...(d.app ? { app: d.app } : {}),
      })),
    };
  }
  /** Enables access using the saved network choice, including an explicit LAN off. */
  async setEnabled(enabled: boolean) {
    await this.devices.setEnabled(enabled);
    if (enabled) await this.follow();
    else {
      clearInterval(this.watch);
      this.watch = undefined;
      await this.sync();
    }
    return this.state();
  }
  async setLan(lan: boolean) {
    await this.devices.setLan(lan);
    if (this.devices.settings.enabled) await this.follow();
    return this.state();
  }
  /** A paired phone or computer may call in, so this one shouldn't sleep on its own. */
  expectsCalls() {
    return this.server.listening && this.devices.list().length > 0;
  }
  /** `pipe`: for a computer that reaches this one over SSH or wsl.exe, which needs no network. */
  async pairing({ pipe = false } = {}): Promise<PhonePairing> {
    if (!this.server.listening) throw new Error("Turn on phone access first.");
    if (!this.hosts.length && !pipe)
      throw new Error("This computer isn't on a network a phone can reach.");
    // Listening on its loopback alone, it pairs over the pipe.
    const hosts = this.hosts.length ? this.hosts : [this.server.host!];
    const key = await this.devices.key();
    const { code, expiresAt } = this.devices.newPairing();
    return {
      url: pairingUrl({
        hosts,
        port: this.server.port,
        key: toBase64Url(key.public),
        code,
        name: computerName(),
      }),
      expiresAt,
    };
  }
  async revoke(deviceId: string) {
    const computer = this.isComputer(deviceId);
    await this.devices.revoke(deviceId);
    this.host.handoffs?.closeShells?.(deviceId);
    this.server.disconnect(
      deviceId,
      computer ? `${computerName()} removed this computer.` : undefined,
    );
    return this.state();
  }
  async close() {
    clearInterval(this.watch);
    this.watch = undefined;
    this.bridge.dispose();
    this.dictations?.dispose();
    this.readings?.dispose();
    this.host.handoffs?.closeShells?.();
    await this.server.close();
  }
  /** Listens now, and keeps up as Tailscale or the local network goes off, comes back or moves. */
  private async follow() {
    if (!this.watch) {
      this.watch = setInterval(() => void this.sync(), 10_000);
      this.watch.unref();
    }
    await this.sync();
  }
  /**
   * Listens while phone access is on: on this computer's Tailscale address,
   * or on every address when the local network is allowed too.
   */
  private sync() {
    this.syncing = this.syncing.then(async () => {
      const { enabled, lan } = this.devices.settings;
      const tailnet = enabled ? await this.tailnet() : undefined;
      const tail = tailnet?.status === "connected" ? tailnet.addresses : [];
      // Without Tailscale, only a pipe (`relay pipe`, over SSH or wsl.exe)
      // reaches it, through its loopback; no device can by an address.
      const pipesOnly = enabled && !lan && !tail.length;
      const host = !enabled
        ? undefined
        : lan
          ? "0.0.0.0"
          : (tail[0] ?? loopback);
      this.hosts =
        !host || pipesOnly
          ? []
          : lan
            ? [...this.lan(), ...tail].slice(0, maxHosts)
            : [host];
      if (host === this.server.host) return;
      await this.server.close();
      this.error = undefined;
      if (!host) return;
      try {
        await this.server.listen(host, !!lan);
      } catch (e) {
        this.error = errorMessage(e);
      }
    });
    return this.syncing;
  }
}
