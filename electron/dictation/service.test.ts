import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker extends EventEmitter {
  killed = false;
  postMessage() {}

  kill() {
    this.killed = true;
  }
}

const workers: FakeWorker[] = [];

vi.mock("electron", () => ({
  utilityProcess: {
    fork: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  },
  MessageChannelMain: class {
    port1 = {};
    port2 = {};
  },
  systemPreferences: {},
}));

vi.mock("./apple", () => ({
  appleSpeechHelper: () => "helper",
  appleSpeechAvailable: () => false,
  serveAppleSpeech: () => {},
}));

vi.mock("../util/onnxruntime", () => ({
  onnxRuntimeInstalled: () => true,
  onnxRuntimeEntry: () => "ort",
}));

vi.mock("../util/model-files", () => ({
  modelComplete: async () => true,
  modelReceived: async () => 0,
  downloadModel: async () => {},
}));

const { Dictation } = await import("./service");

beforeEach(() => {
  vi.useFakeTimers();
  workers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Dictation", () => {
  it("doesn't unload the engine under a dictation still going", async () => {
    const dictation = new Dictation("/data", () => {});
    await vi.waitFor(() => expect(dictation.current.status).toBe("ready"));
    dictation.open();
    const worker = workers[0];
    worker.emit("message", { type: "busy", busy: true });

    // Another composer's mic is hovered, or a phone opens a port.
    dictation.warm();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(worker.killed).toBe(false);
  });

  it("unloads the engine a while after the last dictation", async () => {
    const dictation = new Dictation("/data", () => {});
    await vi.waitFor(() => expect(dictation.current.status).toBe("ready"));
    dictation.open();
    const worker = workers[0];
    worker.emit("message", { type: "busy", busy: true });
    dictation.warm();
    worker.emit("message", { type: "busy", busy: false });

    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(worker.killed).toBe(true);
  });
});
