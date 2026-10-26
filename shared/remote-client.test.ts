import { afterEach, expect, it, vi } from "vitest";
import { slowRemoteCall } from "./remote";
import { RemoteClient } from "./remote-client";

afterEach(() => {
  vi.useRealTimers();
});

it("waits the slow time for a push, pull request or search a computer forwards, not for reading a file", () => {
  expect(slowRemoteCall("projectCall", ["p", "projectCreatePull", []])).toBe(
    true,
  );
  expect(slowRemoteCall("handoffCall", ["h", "projectGitAction", []])).toBe(
    true,
  );
  expect(slowRemoteCall("computerCall", ["installAgent", []])).toBe(true);
  expect(slowRemoteCall("receiveHandoff", ["h"])).toBe(true);
  expect(slowRemoteCall("handoffCall", ["h", "searchProjectText", []])).toBe(
    true,
  );
  expect(slowRemoteCall("projectCall", ["p", "replaceProjectText", []])).toBe(
    true,
  );
  expect(slowRemoteCall("projectCall", ["p", "projectFiles", []])).toBe(false);
});

/** A computer that refuses every connection at once, counting them. */
function refusing() {
  const dials: number[] = [];
  class Refused {
    binaryType = "";
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: (() => void) | null = null;

    constructor() {
      dials.push(Date.now());
      queueMicrotask(() => this.onerror?.());
    }

    send() {}
    close() {}
  }
  return { dials, WebSocket: Refused as unknown as typeof WebSocket };
}

const credentials = {
  hosts: ["127.0.0.1"],
  port: 1,
  key: Buffer.alloc(32, 7).toString("base64url"),
  name: "box",
  deviceId: "d",
  token: "t",
};

it("backs off up to maxRetryMs while reconnecting keeps failing, and starts over on wake", async () => {
  vi.useFakeTimers();
  const { dials, WebSocket } = refusing();
  const client = new RemoteClient({
    start: credentials,
    WebSocket,
    maxRetryMs: 60_000,
  });
  client.start();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  const gaps = dials.slice(1).map((at, i) => at - dials[i]!);
  expect(gaps.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 16000, 32000]);
  expect(new Set(gaps.slice(6))).toEqual(new Set([60_000]));

  const before = dials.length;
  client.wake();
  await vi.advanceTimersByTimeAsync(1100);
  expect(dials.length).toBe(before + 2);
  client.close();
});
