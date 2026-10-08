// Electron's utility processes and message ports, made of Node's own child
// processes for a headless Relay: the speech workers run unchanged, with
// ./worker-port giving them `process.parentPort` on the other side. Messages
// go by structured clone, so the audio's Float32Arrays cross as they are.
import { fork, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/** What crosses the IPC channel; `relay` keeps it apart from anything else. */
export type WorkerWire =
  | { relay: "message"; data: unknown; ports: number[] }
  | { relay: "port"; id: number; data: unknown }
  | { relay: "close"; id: number };

/**
 * One end of a channel. Until it's handed to a worker its messages go to
 * its peer in this process; after, they go over the worker's IPC. Like
 * Electron's, it holds what arrives until `start()`.
 */
export class HeadlessMessagePort extends EventEmitter {
  peer!: HeadlessMessagePort;
  /** Set once handed to a worker: the end there answers to `id`. */
  remote?: { worker: HeadlessUtilityProcess; id: number };
  private started = false;
  private closed = false;
  private held: unknown[] = [];

  postMessage(data: unknown) {
    if (this.closed) return;
    const peer = this.peer;
    if (peer.remote)
      peer.remote.worker.send({ relay: "port", id: peer.remote.id, data });
    else peer.receive(data);
  }

  /** A message for this end, from its peer here or from the worker. */
  receive(data: unknown) {
    if (this.closed) return;
    if (!this.started) this.held.push(data);
    else setImmediate(() => this.emit("message", { data, ports: [] }));
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const data of this.held.splice(0)) this.receive(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    if (peer.remote) {
      peer.remote.worker.send({ relay: "close", id: peer.remote.id });
      peer.remote.worker.forget(peer.remote.id);
    } else peer.close();
    this.emit("close");
  }
}

export class HeadlessMessageChannel {
  readonly port1 = new HeadlessMessagePort();
  readonly port2 = new HeadlessMessagePort();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

let nextPort = 1;

/** A worker in a Node child process, answering as Electron's UtilityProcess does. */
export class HeadlessUtilityProcess extends EventEmitter {
  private child: ChildProcess;
  /** The ends kept here of ports handed to the worker, by the id the worker knows. */
  private ports = new Map<number, HeadlessMessagePort>();

  constructor(modulePath: string, args: string[] = []) {
    super();
    this.child = fork(modulePath, args, {
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
      // The daemon's own flags (an inspector, say) aren't the worker's.
      execArgv: [],
    });
    this.child.on("message", (message: WorkerWire) => {
      if (message.relay === "message") this.emit("message", message.data);
      else if (message.relay === "port")
        this.ports.get(message.id)?.receive(message.data);
      else if (message.relay === "close") {
        const port = this.ports.get(message.id);
        this.ports.delete(message.id);
        port?.close();
      }
    });
    this.child.on("exit", (code) => {
      for (const port of this.ports.values()) port.close();
      this.ports.clear();
      this.emit("exit", code ?? 1);
    });
    // A failed spawn surfaces as an exit, as Electron's does.
    this.child.on("error", (error) => {
      console.error("A worker couldn't start:", error);
    });
  }

  get pid() {
    return this.child.pid;
  }

  postMessage(data: unknown, transfer: HeadlessMessagePort[] = []) {
    const ids = transfer.map((port) => {
      const id = nextPort++;
      port.remote = { worker: this, id };
      this.ports.set(id, port.peer);
      return id;
    });
    this.send({ relay: "message", data, ports: ids });
  }

  send(message: WorkerWire) {
    if (this.child.connected) this.child.send(message);
  }

  forget(id: number) {
    this.ports.delete(id);
  }

  kill() {
    return this.child.kill();
  }
}
