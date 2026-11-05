// A process the agent host runs for Relay, as Relay reads and drives it.
import type { ClientMessage, Entry, SessionInfo } from "./protocol";

/** What a hosted process needs of the connection to its host. */
export interface ProcessLink {
  send(message: ClientMessage): void;
  call(
    session: string,
    method: string,
    args: unknown[],
    timeout?: number,
  ): Promise<unknown>;
  forget(id: string): void;
}

export interface ProcessReader {
  replayed?: (entries: Entry[]) => void;
  entry: (entry: Entry) => void;
}

/**
 * A process the host runs for Relay, e.g. Codex's app server: its output
 * lines come off the host's log, and what Relay writes goes to its input.
 * Picked up after a restart, the log comes first, marked as replayed.
 */
export class HostedProcess {
  private reader?: ProcessReader;
  private replay: Entry[] = [];
  private live: Entry[] = [];
  private replaying: boolean;
  private closed = false;

  constructor(
    private connection: ProcessLink,
    private id: string,
    /** What the host said about it, when picked up after a restart. */
    readonly info?: SessionInfo,
  ) {
    this.replaying = !!info;
  }

  /** Hands over the replayed log in one piece, once it's all in, then each entry as it comes. */
  read(reader: ProcessReader) {
    this.reader = reader;
    if (!this.replaying && this.info) reader.replayed?.(this.replay.splice(0));
    for (const entry of this.live.splice(0)) reader.entry(entry);
  }

  entry(entry: Entry) {
    // Mid-replay the endpoint stays: "attached" still has to find it.
    if (entry.kind === "end" && !this.replaying)
      this.connection.forget(this.id);
    if (this.replaying) this.replay.push(entry);
    else if (this.reader) this.reader.entry(entry);
    else this.live.push(entry);
  }

  attached() {
    if (!this.replaying) return;
    this.replaying = false;
    if (this.replay.some((e) => e.kind === "end"))
      this.connection.forget(this.id);
    this.reader?.replayed?.(this.replay.splice(0));
  }

  write(line: string) {
    if (!this.closed)
      this.connection.send({ t: "push", session: this.id, message: line });
  }

  /** A turn starts or ends; `turn` names one of several a shared process runs. */
  mark(mark: "start" | "end", options: { at?: number; turn?: string } = {}) {
    if (!this.closed)
      this.connection.send({ t: "mark", session: this.id, mark, ...options });
  }

  /** What the next Relay reads about this process, replacing what it had. */
  keep(meta: unknown) {
    if (!this.closed)
      this.connection.send({ t: "meta", session: this.id, meta });
  }

  /** The process's pid on the host's machine; hosts before it don't say. */
  pid(): Promise<number | undefined> {
    return this.connection
      .call(this.id, "pid", [], 5000)
      .then((pid) => (typeof pid === "number" ? pid : undefined))
      .catch(() => undefined);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connection.send({ t: "close", session: this.id });
    this.connection.forget(this.id);
  }
}
