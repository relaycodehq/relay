import type { Lease } from "./hosted-sessions";
import type { JsonRpcConnection } from "./json-rpc";

/** One agent process a thread keeps between turns, leased to a turn at a time. */
export abstract class HostedAgent<
  Connection extends JsonRpcConnection,
  Inflight,
> implements Lease
{
  busy = false;
  /** The turn a restart cut off, for an `adopt` turn to show. */
  inflight?: Inflight;

  constructor(readonly connection: Connection) {}

  get closed() {
    return this.connection.closed;
  }

  /** What the next Relay reads about this process. */
  abstract keep(): void;

  close() {
    this.connection.close();
  }

  /** Runs `initialize` on a new process, ending it when that fails. */
  async start(initialize: (agent: this) => Promise<unknown>) {
    try {
      await initialize(this);
    } catch (error) {
      this.close();
      throw error;
    }
    this.keep();
    return this;
  }

  /** The turn is over: the process keeps its session for the next, unless it was a private one. */
  settle(kept: boolean) {
    this.inflight = undefined;
    this.busy = false;
    if (!kept) return this.close();
    this.connection.mark("end");
    this.keep();
  }
}
