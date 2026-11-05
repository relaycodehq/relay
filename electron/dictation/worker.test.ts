import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import type { WorkerNotice } from "./worker";

class FakePort extends EventEmitter {
  sent: unknown[] = [];

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  start() {}
}

const parent = new FakePort();
(process as unknown as { parentPort: FakePort }).parentPort = parent;

vi.mock("./parakeet", () => ({
  loadParakeet: async () => ({ decode: async () => "" }),
}));

vi.mock("./voice-detector", () => ({
  loadSilero: async () => () => async () => [],
}));

await import("./worker");

it("ends a session whose page closed without cancelling, so the engine can unload", async () => {
  parent.emit("message", {
    data: { type: "load", dir: "/models", ort: "node:path", threads: 1 },
    ports: [],
  });
  const page = new FakePort();
  parent.emit("message", { data: { type: "port" }, ports: [page] });
  page.emit("message", { data: { type: "start", id: 1 } });
  await vi.waitFor(() =>
    expect(parent.sent).toContainEqual({ type: "loaded" }),
  );

  page.emit("close");

  const busy = parent.sent.filter(
    (notice): notice is Extract<WorkerNotice, { type: "busy" }> =>
      (notice as WorkerNotice).type === "busy",
  );
  expect(busy.at(-1)).toEqual({ type: "busy", busy: false });
});
