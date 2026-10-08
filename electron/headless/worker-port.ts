// The worker's side of ./utility-process: `process.parentPort` and its
// message ports, over Node's IPC channel. Imported before the worker's own
// code, which reads `process.parentPort` as it loads.
import { EventEmitter } from "node:events";
import type { WorkerWire } from "./utility-process";

const send = (message: WorkerWire) => {
  if (process.connected) process.send!(message);
};

class WorkerPort extends EventEmitter {
  private started = false;
  private closed = false;
  private held: unknown[] = [];
  constructor(readonly id: number) {
    super();
  }
  postMessage(data: unknown) {
    if (!this.closed) send({ relay: "port", id: this.id, data });
  }
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
    this.end();
    send({ relay: "close", id: this.id });
  }
  /** Closed from either side. */
  end() {
    if (this.closed) return;
    this.closed = true;
    ports.delete(this.id);
    this.emit("close");
  }
}

const ports = new Map<number, WorkerPort>();

const parentPort = Object.assign(new EventEmitter(), {
  postMessage: (data: unknown) => send({ relay: "message", data, ports: [] }),
  start() {},
});

process.on("message", (message: WorkerWire) => {
  if (message.relay === "message") {
    const given = message.ports.map((id) => {
      const port = new WorkerPort(id);
      ports.set(id, port);
      return port;
    });
    parentPort.emit("message", { data: message.data, ports: given });
  } else if (message.relay === "port")
    ports.get(message.id)?.receive(message.data);
  else if (message.relay === "close") ports.get(message.id)?.end();
});
// Relay went away: nothing is left to work for.
process.on("disconnect", () => process.exit(0));

(process as unknown as { parentPort: typeof parentPort }).parentPort =
  parentPort;
