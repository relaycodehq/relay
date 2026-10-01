// The sessions agents keep between turns. With an agent host they run there,
// so they outlive a restart of Relay, and the next Relay takes them back.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { HostedChild } from "../agent-host/child";
import type { AgentHosts, FoundSession } from "../agent-host/client";
import type { ProcessSpec } from "../agent-host/protocol";

let hosts: AgentHosts | undefined;
/** Every agent's sessions run in the agent host from now on, so they outlive a restart of Relay. */
export function hostAgents(agentHosts: AgentHosts | undefined) {
  hosts = agentHosts;
}

/**
 * Runs `open` in the agent host. Undefined when there is none or it fails,
 * for the caller to run `agent` in Relay instead.
 */
export async function inAgentHost<T>(
  agent: string,
  open: (hosts: AgentHosts) => Promise<T>,
): Promise<T | undefined> {
  if (!hosts) return undefined;
  try {
    return await open(hosts);
  } catch (error) {
    console.warn(
      `The agent host is unavailable; ${agent} runs in Relay:`,
      error,
    );
    return undefined;
  }
}

/**
 * The sessions the host kept running for `provider`. Claude's keep no
 * `provider`, and a host that names no `kind` only ran Claude.
 */
export async function foundSessions(
  provider: string,
  kind: "claude" | "process",
): Promise<FoundSession[]> {
  if (!hosts) return [];
  return (await hosts.discover()).filter(
    ({ info }) =>
      (info.kind ?? "claude") === kind &&
      ((info.meta as { provider?: string } | undefined)?.provider ??
        "claude") === provider,
  );
}

/** A session one turn at a time holds; `closed` once its process is gone. */
export interface Lease {
  busy: boolean;
  readonly closed: boolean;
}

/** One agent's sessions, by the key of the thread they belong to. */
export class HostedSessions<Session> {
  private live = new Map<string, Session>();
  /** Keys whose session is still starting, and whether it was closed meanwhile. */
  private starting = new Map<string, { closed: boolean }>();

  constructor(
    private agent: {
      /** As its hosted sessions name it. */
      provider: string;
      /** As messages name it. */
      name: string;
      kind: "claude" | "process";
      close: (session: Session) => unknown;
    },
  ) {}

  get(key: string) {
    return this.live.get(key);
  }
  set(key: string, session: Session) {
    this.live.set(key, session);
  }
  delete(key: string) {
    return this.live.delete(key);
  }
  values() {
    return this.live.values();
  }

  /**
   * The session for a turn under `key`, started again if it closed. Without
   * a key, a session of the turn's own that nobody keeps.
   */
  async acquire(
    this: HostedSessions<Session & Lease>,
    key: string | undefined,
    start: () => Promise<Session & Lease>,
  ): Promise<Session & Lease> {
    const lease = (session: Session & Lease) => {
      session.busy = true;
      return session;
    };
    if (!key) return lease(await start());
    const current = this.live.get(key);
    if (this.starting.has(key) || current?.busy)
      throw new Error(
        `This ${this.agent.name} session is already running a turn.`,
      );
    if (current && !current.closed) return lease(current);
    const starting = { closed: false };
    this.starting.set(key, starting);
    try {
      const session = await start();
      if (starting.closed) {
        await this.agent.close(session);
        throw new Error(`This ${this.agent.name} session was closed.`);
      }
      this.live.set(key, session);
      return lease(session);
    } finally {
      this.starting.delete(key);
    }
  }

  /** Runs `spec` in the agent host under `key`, keeping `meta` with it; in Relay without a key or a host. */
  async spawn(
    key: string | undefined,
    meta: unknown,
    spec: ProcessSpec,
    local: () => ChildProcessWithoutNullStreams,
  ): Promise<ChildProcessWithoutNullStreams | HostedChild> {
    const running = key
      ? await inAgentHost(this.agent.name, (hosts) =>
          hosts.openProcess({ key, meta, process: spec }),
        )
      : undefined;
    if (!running) return local();
    const child = new HostedChild(running);
    child.release();
    return child;
  }

  /** Lets go of the session kept under `key`, ending it. */
  async close(key: string) {
    const starting = this.starting.get(key);
    if (starting) starting.closed = true;
    const session = this.live.get(key);
    this.live.delete(key);
    if (session) await this.agent.close(session);
  }

  /** Relay is restarting: what the host runs carries on, the rest ends with Relay. */
  detach() {
    this.live.clear();
  }

  /** Relay is quitting: every session ends. */
  dispose() {
    const all = [...this.live.values()];
    this.live.clear();
    for (const session of all) void this.agent.close(session);
  }

  /**
   * Takes back the sessions the agent host kept running while Relay
   * restarted. Those `take` makes nothing of, those under keys `owns`
   * rejects, and a second one under a key, end.
   */
  async reattach(
    owns: (key: string) => boolean,
    take: (found: FoundSession) => Session | undefined,
  ): Promise<{ key: string; open: boolean }[]> {
    const back: { key: string; open: boolean }[] = [];
    for (const found of await foundSessions(
      this.agent.provider,
      this.agent.kind,
    )) {
      const { key, open } = found.info;
      const session =
        owns(key) && !this.live.has(key) && !this.starting.has(key)
          ? take(found)
          : undefined;
      if (!session) {
        found.close();
        continue;
      }
      this.live.set(key, session);
      back.push({ key, open });
    }
    return back;
  }
}
