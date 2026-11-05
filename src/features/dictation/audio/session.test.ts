// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mount } from "../../../../tests/unit/hook-harness";
import type {
  DictationEvent,
  DictationRequest,
} from "../../../../shared/dictation";
import {
  cancelDictation,
  dictationSnapshot,
  startDictation,
  stopDictation,
  useDictationModel,
} from "./session";

vi.mock("../../../lib/api", () => ({
  api: {
    dictationMicrophone: vi.fn(async () => true),
    connectDictation: vi.fn(async () => true),
    onDictationState: vi.fn(),
    dictationState: vi.fn(async () => ({
      status: "ready",
      engine: "parakeet",
      apple: false,
      parakeet: { status: "ready" },
    })),
  },
}));

vi.mock("./capture", () => ({
  startCapture: vi.fn(async () => ({
    analyser: {},
    stop: async () => {},
  })),
}));

vi.mock("./microphones", () => ({ dictationMicrophone: () => "" }));

(window as unknown as { relay: object }).relay = {};

afterEach(() => cancelDictation());

class FakePort {
  sent: DictationRequest[] = [];
  closed = false;
  onmessage: unknown;

  postMessage(request: DictationRequest) {
    this.sent.push(request);
  }

  close() {
    this.closed = true;
  }
}

function deliver(port: FakePort) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: "relay:dictation-port",
      source: window,
      ports: [port as unknown as MessagePort],
    }),
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const target = () => ({ begin() {}, update() {}, end() {} });

it("gives a dictation started right after a cancelled one its own port", async () => {
  mount(() => useDictationModel());
  await settle();

  const cancelled = startDictation(target(), "composer");
  await settle();
  cancelDictation();
  const next = startDictation(target(), "composer");
  await settle();

  const cancelledPort = new FakePort();
  const nextPort = new FakePort();
  deliver(cancelledPort);
  deliver(nextPort);
  await Promise.all([cancelled, next]);

  expect(dictationSnapshot().phase).toBe("listening");
  const live = [cancelledPort, nextPort].filter((port) => !port.closed);
  expect(live).toHaveLength(1);
  expect(live[0].sent[0]).toMatchObject({ type: "start" });
  expect(live[0].sent[0].id).toBeGreaterThan(cancelledPort.sent[0].id);
});

function answerStop(port: FakePort, text: string) {
  const stop = port.sent.find((request) => request.type === "stop");
  if (!stop) throw new Error("no stop was sent");
  (port.onmessage as (event: { data: DictationEvent }) => void)({
    data: { type: "final", id: stop.id, text },
  });
}

it("finishes a dictation stopped while it was starting, and says the words stayed", async () => {
  mount(() => useDictationModel());
  await settle();
  const ended = vi.fn();
  const target = { begin() {}, update() {}, end: ended };

  const started = startDictation(target, "composer");
  await settle();
  const stopped = stopDictation();
  const port = new FakePort();
  deliver(port);
  await started;
  await settle();
  answerStop(port, "hello");

  await expect(stopped).resolves.toBe(true);
  expect(ended).toHaveBeenCalledExactlyOnceWith("hello");
  expect(dictationSnapshot().phase).toBe("idle");
});

it("tells a second stop while finishing that the words stayed", async () => {
  mount(() => useDictationModel());
  await settle();

  const started = startDictation(target(), "composer");
  await settle();
  const port = new FakePort();
  deliver(port);
  await started;
  const first = stopDictation();
  await settle();
  const second = stopDictation();
  answerStop(port, "hello");

  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
});

it("tells a stop while starting that nothing stayed when the start is cancelled", async () => {
  mount(() => useDictationModel());
  await settle();

  const started = startDictation(target(), "composer");
  await settle();
  const stopped = stopDictation();
  cancelDictation();
  deliver(new FakePort());
  await started;

  await expect(stopped).resolves.toBe(false);
});
