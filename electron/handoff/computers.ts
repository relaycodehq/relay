import { randomUUID } from "node:crypto";
import {
  inSetup,
  liveAway,
  type ComputerRoute,
  type PairedComputer,
} from "../../shared/handoff";
import {
  parsePairingUrl,
  type RemoteCredentials,
  type RemoteEvent,
} from "../../shared/remote";
import { RemoteClient, type RemoteStatus } from "../../shared/remote-client";
import type { Store } from "../app/store";
import type { SavedComputer } from "../app/store-types";
import { computerName } from "../platform/computer-name";
import {
  pairingLink,
  PipeShim,
  routeCommand,
  routeName,
  runningWslDistros,
} from "./pipe-route";
import type { WslHolders } from "./wsl-holder";

export type { SavedComputer };
export { computerName };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * How long a call waits for a computer to come online. A WSL distribution's
 * first start after Windows boots can take far longer than waking it later.
 */
const onlineWait = (route?: ComputerRoute) =>
  route?.kind === "wsl" ? 60_000 : 15_000;
/**
 * Over SSH a reconnect that keeps failing waits up to this between tries, so
 * a host down for hours isn't knocked on every 15s (fail2ban bans for less).
 */
const sshRetryMs = 5 * 60_000;

interface Entry {
  client: RemoteClient;
  detail?: string;
  shim?: PipeShim;
}

/**
 * The computers this one hands threads to. Each keeps a bridge client
 * connected, reconnecting by itself across sleep and Tailscale coming and
 * going, the same client the phone app uses; one reached over SSH or into
 * WSL connects through a pipe (`PipeShim`).
 */
export class Computers {
  private clients = new Map<string, Entry>();
  /** Connects under way, one per computer, so callers at once share it. */
  private connecting = new Map<string, Promise<void>>();
  /**
   * Which connect a computer is the latest's; `drop` takes it away, and a
   * connect finding it gone or replaced gives up what it built.
   */
  private connects = new Map<string, symbol>();
  /** Relay is restarting: WSL distributions stay held through it. */
  private detached = false;
  /** WSL distributions WSL stopped, by computer id; see `stopped`. */
  private stoppedIds = new Set<string>();
  private online = new Set<(id: string) => void>();
  private offline = new Set<(id: string) => void>();
  private events = new Set<(id: string, event: RemoteEvent) => void>();
  constructor(
    private store: Store,
    private seal: (value: string) => Promise<string | null>,
    private unseal: (value: string) => Promise<string>,
    private options: {
      timeoutMs?: number;
      WebSocket?: typeof WebSocket;
      /** What keeps a WSL distribution up while this Relay works in it. */
      holders?: Pick<
        WslHolders,
        "hold" | "release" | "heldDistros" | "releaseAll" | "onStopped"
      >;
      /** What runs `relay` where a route goes; tests stand in for ssh and wsl.exe. */
      routeCommand?: typeof routeCommand;
      /** The WSL distributions running now; tests stand in for wsl.exe. */
      runningDistros?: () => Promise<Set<string>>;
    } = {},
  ) {
    options.holders?.onStopped((distro) => this.stopped(distro));
  }
  private get saved() {
    return this.store.get().computers ?? [];
  }
  /**
   * Connects to every computer, but a WSL distribution only once something
   * needs it, so it isn't woken for nothing; one still held from before a
   * restart connects at once, and so does one still running with threads
   * of this computer's on it, as after a Quit.
   */
  async start() {
    const held = (await this.options.holders?.heldDistros()) ?? new Set();
    const resting = this.saved.filter(
      (c) =>
        c.route?.kind === "wsl" &&
        !held.has(c.route.distro) &&
        this.workingOn(c.id),
    );
    const running = resting.length
      ? await (this.options.runningDistros ?? runningWslDistros)()
      : new Set<string>();
    for (const computer of this.saved) {
      const { route } = computer;
      if (
        route?.kind === "wsl" &&
        !held.has(route.distro) &&
        !(running.has(route.distro) && resting.includes(computer))
      )
        continue;
      await this.connectOnce(computer).catch((e) =>
        console.warn(`Can't connect to ${computer.name}:`, e),
      );
    }
  }
  /** Whether threads from here run or wait on a setup on the computer. */
  private workingOn(id: string) {
    return (this.store.get().chats ?? []).some(
      (c) => c.sentTo?.computerId === id && (liveAway(c) || inSetup(c)),
    );
  }
  /** `detach`: Relay restarts, and WSL distributions stay held through it. */
  close({ detach = false }: { detach?: boolean } = {}) {
    this.detached = detach;
    for (const { client, shim } of this.clients.values()) {
      client.close();
      shim?.close();
    }
    this.clients.clear();
    this.connecting.clear();
    this.connects.clear();
    if (!detach) this.options.holders?.releaseAll();
  }
  list(): PairedComputer[] {
    return this.saved.map((c) => {
      const entry = this.clients.get(c.id);
      const status = entry?.client.status ?? "offline";
      const address = c.route
        ? routeName(c.route)
        : (entry?.client.route?.host ?? c.hosts[0]);
      // Over a pipe, the command says best why it couldn't connect.
      const detail = this.stoppedIds.has(c.id)
        ? "WSL stopped it."
        : (status !== "online" && entry?.shim?.failure) || entry?.detail;
      return {
        id: c.id,
        name: c.name,
        status,
        ...(detail ? { detail } : {}),
        ...(address ? { address } : {}),
        ...(c.route ? { route: c.route } : {}),
        ...(this.asleep(c.id) ? { asleep: true as const } : {}),
        ...(this.stoppedIds.has(c.id) ? { stopped: true as const } : {}),
      };
    });
  }
  get(id: string) {
    const computer = this.saved.find((c) => c.id === id);
    if (!computer) throw new Error("That computer isn't paired anymore.");
    return computer;
  }
  /** A WSL distribution nothing has woken yet counts as online: `connected` wakes it. */
  status(id: string): RemoteStatus {
    if (this.asleep(id)) return "online";
    return this.clients.get(id)?.client.status ?? "offline";
  }
  /** Called each time a computer comes online. */
  onOnline(listener: (id: string) => void) {
    this.online.add(listener);
    return () => this.online.delete(listener);
  }
  /** Called each time a computer that was online drops. */
  onOffline(listener: (id: string) => void) {
    this.offline.add(listener);
    return () => this.offline.delete(listener);
  }
  /** What a computer says by itself: how live handoffs on it move. */
  onEvent(listener: (id: string, event: RemoteEvent) => void) {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }
  /** Pairs with the link the other computer shows; pairing the same one again replaces it. */
  async pair(text: string) {
    const link = parsePairingUrl(text);
    if (!link)
      throw new Error(
        "That isn't a Relay pairing link. Copy it from Settings → Computers on the other computer.",
      );
    return this.pairWith(link);
  }
  /**
   * Pairs with the Relay a route reaches, over SSH or into WSL: it asks
   * there for a pairing code, and pairs through a pipe.
   */
  async pairOver(route: ComputerRoute, signal?: AbortSignal) {
    const link = parsePairingUrl(
      await pairingLink(route, this.options.routeCommand, signal),
    );
    if (!link)
      throw new Error(`Relay over ${routeName(route)} gave no pairing code.`);
    if (signal?.aborted) throw new Error("Stopped.");
    const shim = new PipeShim(route, this.options.routeCommand);
    try {
      const port = await shim.listen();
      return await this.pairWith(
        { ...link, hosts: ["127.0.0.1"], port },
        route,
      );
    } finally {
      shim.close();
    }
  }
  private async pairWith(
    link: NonNullable<ReturnType<typeof parsePairingUrl>>,
    route?: ComputerRoute,
  ) {
    const credentials = await new Promise<RemoteCredentials>(
      (resolve, reject) => {
        const client = new RemoteClient({
          start: { link, device: computerName(), kind: "computer" },
          WebSocket: this.options.WebSocket,
          timeoutMs: this.options.timeoutMs ?? 20_000,
          onPaired: (paired) => {
            clearTimeout(timer);
            client.close();
            resolve(paired);
          },
          onStatus: (status, detail) => {
            if (status !== "denied") return;
            clearTimeout(timer);
            client.close();
            reject(new Error(detail ?? "The other computer refused."));
          },
        });
        const timer = setTimeout(() => {
          client.close();
          reject(
            new Error(
              route
                ? `Couldn't reach ${link.name} over ${routeName(route)}.`
                : `Couldn't reach ${link.name}. Both computers need to be on the same network or Tailscale.`,
            ),
          );
        }, 30_000);
        client.start();
      },
    );
    const existing = this.saved.find((c) => c.key === credentials.key);
    const computer: SavedComputer = {
      id: existing?.id ?? randomUUID(),
      name: credentials.name,
      hosts: credentials.hosts,
      port: credentials.port,
      key: credentials.key,
      deviceId: credentials.deviceId,
      token:
        (await this.seal(credentials.token)) ?? `plain:${credentials.token}`,
      ...(route ? { route } : {}),
    };
    await this.store.update((s) => {
      s.computers = [
        ...(s.computers ?? []).filter((c) => c.key !== computer.key),
        computer,
      ];
    });
    this.drop(computer.id);
    await this.connectOnce(computer);
    return this.list();
  }
  async forget(id: string) {
    this.drop(id);
    this.stoppedIds.delete(id);
    await this.store.update((s) => {
      s.computers = (s.computers ?? []).filter((c) => c.id !== id);
    });
    return this.list();
  }
  /**
   * Whether the computer is a WSL distribution nothing has woken yet: it
   * connects on its first call.
   */
  asleep(id: string) {
    return (
      !this.clients.has(id) &&
      !this.stoppedIds.has(id) &&
      this.saved.find((c) => c.id === id)?.route?.kind === "wsl"
    );
  }
  /** Starts a distribution WSL stopped again: the user asked for it. */
  async wake(id: string) {
    this.stoppedIds.delete(id);
    await this.connected(id);
    return this.list();
  }
  /** The computer's client once online, waiting a little for a reconnect. */
  async connected(id: string): Promise<RemoteClient> {
    const computer = this.get(id);
    const { name, route } = computer;
    if (this.stoppedIds.has(id))
      throw new Error(`WSL stopped ${name}. Reconnect to start it again.`);
    if (this.asleep(id)) await this.connectOnce(computer);
    const entry = this.clients.get(id);
    if (!entry) throw new Error(`${name} isn't connected.`);
    entry.client.wake();
    for (const until = Date.now() + onlineWait(route); Date.now() < until;) {
      if (entry.client.status === "online") return entry.client;
      if (entry.client.status === "denied")
        throw new Error(
          `${name} doesn't accept this computer anymore. Pair again.`,
        );
      await sleep(200);
    }
    if (route) {
      const why = entry.shim?.failure ?? entry.detail;
      throw new Error(
        `Can't reach ${name} over ${routeName(route)}.${why ? ` ${why}` : ""}`,
      );
    }
    throw new Error(
      `Can't reach ${name}. Is it on, and on this network or Tailscale?`,
    );
  }
  /** The handoff ids whose word to this computer didn't get through yet. */
  async setPending(
    id: string,
    kind: "unacknowledged" | "abandoned",
    update: (ids: string[]) => string[],
  ) {
    await this.store.update((s) => {
      const computer = s.computers?.find((c) => c.id === id);
      if (!computer) return;
      const ids = update(computer[kind] ?? []);
      if (ids.length) computer[kind] = ids;
      else delete computer[kind];
    });
  }
  /**
   * WSL stopped the distribution, `wsl --shutdown` say. Reconnecting, or the
   * next call from a window still showing one of its projects, would start
   * it again at once: it stays stopped until the user wakes it.
   */
  private stopped(distro: string) {
    for (const computer of this.saved)
      if (
        computer.route?.kind === "wsl" &&
        computer.route.distro === distro &&
        (this.clients.has(computer.id) || this.connecting.has(computer.id))
      ) {
        this.stoppedIds.add(computer.id);
        this.drop(computer.id);
      }
  }
  private drop(id: string) {
    const entry = this.clients.get(id);
    entry?.client.close();
    entry?.shim?.close();
    this.clients.delete(id);
    this.connecting.delete(id);
    this.connects.delete(id);
    const route = this.saved.find((c) => c.id === id)?.route;
    if (route?.kind === "wsl") this.options.holders?.release(route.distro);
  }
  private connectOnce(computer: SavedComputer) {
    const { id } = computer;
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const connecting = this.connect(computer).finally(() => {
      if (this.connecting.get(id) === connecting) this.connecting.delete(id);
    });
    this.connecting.set(id, connecting);
    return connecting;
  }
  private async connect(computer: SavedComputer) {
    const { id, route } = computer;
    const ticket = Symbol(id);
    this.connects.set(id, ticket);
    const current = () => this.connects.get(id) === ticket;
    let wasOnline = false;
    this.stoppedIds.delete(id);
    // Over a pipe, the client connects to it on this computer's loopback.
    let shim: PipeShim | undefined;
    const giveUp = () => {
      shim?.close();
      if (current()) this.connects.delete(id);
      // A newer connect holds the distribution now; a dropped or failed one, nothing.
      if (route?.kind === "wsl" && !this.connects.has(id) && !this.detached)
        this.options.holders?.release(route.distro);
    };
    let token: string;
    let port: number;
    try {
      token = computer.token.startsWith("plain:")
        ? computer.token.slice(6)
        : await this.unseal(computer.token);
      if (route?.kind === "wsl" && current())
        await this.options.holders?.hold(route.distro);
      if (route && current())
        shim = new PipeShim(route, this.options.routeCommand);
      port = shim ? await shim.listen() : computer.port;
    } catch (e) {
      const failed = current();
      giveUp();
      if (failed) throw e;
      return;
    }
    // Dropped meanwhile: forgotten, re-paired or Relay closing.
    if (!current()) return giveUp();
    const entry: Entry = {
      shim,
      client: new RemoteClient({
        start: {
          hosts: shim ? ["127.0.0.1"] : computer.hosts,
          port,
          key: computer.key,
          name: computer.name,
          deviceId: computer.deviceId,
          token,
        },
        WebSocket: this.options.WebSocket,
        timeoutMs: this.options.timeoutMs ?? 20_000,
        slowTimeoutMs: 6 * 60_000,
        ...(route?.kind === "ssh" ? { maxRetryMs: sshRetryMs } : {}),
        onStatus: (status, detail) => {
          entry.detail = status === "online" ? undefined : detail;
          if (status === "online")
            for (const listener of this.online) listener(id);
          else if (wasOnline)
            for (const listener of this.offline) listener(id);
          wasOnline = status === "online";
        },
        onEvent: (event) => {
          for (const listener of this.events) listener(id, event);
        },
        // Where the other computer listens now, for the next connect; a
        // pipe's end stays where it is.
        onCredentials: ({ hosts, name }) =>
          void this.store
            .update((s) => {
              const saved = s.computers?.find((c) => c.id === id);
              if (saved) Object.assign(saved, route ? { name } : { hosts, name });
            })
            .catch((e) =>
              console.warn(`Couldn't keep ${computer.name}'s addresses:`, e),
            ),
      }),
    };
    this.clients.set(id, entry);
    entry.client.start();
  }
}
