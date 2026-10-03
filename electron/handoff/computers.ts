import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { PairedComputer } from "../../shared/handoff";
import { parsePairingUrl, type RemoteCredentials } from "../../shared/remote";
import { RemoteClient, type RemoteStatus } from "../../shared/remote-client";
import type { Store } from "../app/store";

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
}

export const computerName = () => hostname().replace(/\.local$/, "") || "Relay";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The computers this one hands threads to. Each keeps a bridge client
 * connected, reconnecting by itself across sleep and Tailscale coming and
 * going, the same client the phone app uses.
 */
export class Computers {
  private clients = new Map<
    string,
    { client: RemoteClient; detail?: string }
  >();
  private online = new Set<(id: string) => void>();
  constructor(
    private store: Store,
    private seal: (value: string) => Promise<string | null>,
    private unseal: (value: string) => Promise<string>,
    private options: { timeoutMs?: number; WebSocket?: typeof WebSocket } = {},
  ) {}
  private get saved() {
    return this.store.get().computers ?? [];
  }
  async start() {
    for (const computer of this.saved)
      await this.connect(computer).catch((e) =>
        console.warn(`Can't connect to ${computer.name}:`, e),
      );
  }
  close() {
    for (const { client } of this.clients.values()) client.close();
    this.clients.clear();
  }
  list(): PairedComputer[] {
    return this.saved.map((c) => {
      const entry = this.clients.get(c.id);
      return {
        id: c.id,
        name: c.name,
        status: entry?.client.status ?? "offline",
        ...(entry?.detail ? { detail: entry.detail } : {}),
        ...(c.hosts[0] ? { address: c.hosts[0] } : {}),
      };
    });
  }
  get(id: string) {
    const computer = this.saved.find((c) => c.id === id);
    if (!computer) throw new Error("That computer isn't paired anymore.");
    return computer;
  }
  status(id: string): RemoteStatus {
    return this.clients.get(id)?.client.status ?? "offline";
  }
  /** Called each time a computer comes online. */
  onOnline(listener: (id: string) => void) {
    this.online.add(listener);
    return () => this.online.delete(listener);
  }
  /** Pairs with the link the other computer shows; pairing the same one again replaces it. */
  async pair(text: string) {
    const link = parsePairingUrl(text);
    if (!link)
      throw new Error(
        "That isn't a Relay pairing link. Copy it from Settings → Computers on the other computer.",
      );
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
              `Couldn't reach ${link.name}. Both computers need to be on the same Tailscale network.`,
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
    };
    await this.store.update((s) => {
      s.computers = [
        ...(s.computers ?? []).filter((c) => c.key !== computer.key),
        computer,
      ];
    });
    this.drop(computer.id);
    await this.connect(computer);
    return this.list();
  }
  async forget(id: string) {
    this.drop(id);
    await this.store.update((s) => {
      s.computers = (s.computers ?? []).filter((c) => c.id !== id);
    });
    return this.list();
  }
  /** The computer's client once online, waiting a little for a reconnect. */
  async connected(id: string): Promise<RemoteClient> {
    const { name } = this.get(id);
    const entry = this.clients.get(id);
    if (!entry) throw new Error(`${name} isn't connected.`);
    entry.client.wake();
    for (const until = Date.now() + 15_000; Date.now() < until;) {
      if (entry.client.status === "online") return entry.client;
      if (entry.client.status === "denied")
        throw new Error(
          `${name} doesn't accept this computer anymore. Pair again.`,
        );
      await sleep(200);
    }
    throw new Error(`Can't reach ${name}. Is it on, and on Tailscale?`);
  }
  async setUnacknowledged(id: string, ids: string[]) {
    await this.store.update((s) => {
      const computer = s.computers?.find((c) => c.id === id);
      if (!computer) return;
      if (ids.length) computer.unacknowledged = ids;
      else delete computer.unacknowledged;
    });
  }
  private drop(id: string) {
    this.clients.get(id)?.client.close();
    this.clients.delete(id);
  }
  private async connect(computer: SavedComputer) {
    const token = computer.token.startsWith("plain:")
      ? computer.token.slice(6)
      : await this.unseal(computer.token);
    const entry: { client: RemoteClient; detail?: string } = {
      client: new RemoteClient({
        start: {
          hosts: computer.hosts,
          port: computer.port,
          key: computer.key,
          name: computer.name,
          deviceId: computer.deviceId,
          token,
        },
        WebSocket: this.options.WebSocket,
        timeoutMs: this.options.timeoutMs ?? 20_000,
        slowTimeoutMs: 6 * 60_000,
        onStatus: (status, detail) => {
          entry.detail = status === "online" ? undefined : detail;
          if (status === "online")
            for (const listener of this.online) listener(computer.id);
        },
      }),
    };
    this.clients.set(computer.id, entry);
    entry.client.start();
  }
}
