import { afterEach, expect, it, vi } from "vitest";
import { HostRequests } from "./request";
import type { FetchRequest } from "./host";

const url = "https://git.example.com/api/test";
const options = { tooLarge: "Too much data." };
const headers = { Authorization: "token sample", Accept: "application/json" };

afterEach(() => vi.useRealTimers());

function pending() {
  const signals: AbortSignal[] = [];
  const fetch: FetchRequest = (_url, init) => {
    const signal = init.signal!;
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
  };
  return { requests: new HostRequests(fetch), signals };
}

it("cancels only the caller's request when its signal aborts", async () => {
  const { requests, signals } = pending();
  const caller = new AbortController();
  const one = expect(
    requests.request(url, { ...options, signal: caller.signal }, (send) =>
      send(headers),
    ),
  ).rejects.toThrow("Request cancelled or timed out. Please retry.");
  const two = expect(
    requests.request(url, options, (send) => send(headers)),
  ).rejects.toThrow("Request cancelled or timed out. Please retry.");
  caller.abort();
  await one;
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  requests.dispose();
  await two;
});

it("times out after 30 seconds and removes its timer", async () => {
  vi.useFakeTimers();
  const { requests, signals } = pending();
  const result = expect(
    requests.request(url, options, (send) => send(headers)),
  ).rejects.toThrow("Request cancelled or timed out. Please retry.");
  await vi.advanceTimersByTimeAsync(29_999);
  expect(signals[0]!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await result;
  expect(signals[0]!.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("disposes every active request, leaving completed ones alone", async () => {
  vi.useFakeTimers();
  let completed!: AbortSignal;
  const { requests, signals } = pending();
  const active = [1, 2].map(() =>
    expect(
      requests.request(url, options, (send) => send(headers)),
    ).rejects.toThrow(/cancelled/),
  );
  const done = new HostRequests(async (_url, init) => {
    completed = init.signal!;
    return Response.json({ ok: true });
  });
  await done.request(url, options, (send) => send(headers));
  expect(vi.getTimerCount()).toBe(2);
  requests.dispose();
  done.dispose();
  await Promise.all(active);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(completed.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("normalizes cancellation while reading a response body too", async () => {
  const caller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => (started = resolve));
  const requests = new HostRequests(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          pull() {
            started();
          },
          start(controller) {
            init.signal!.addEventListener("abort", () =>
              controller.error(init.signal!.reason),
            );
          },
        }),
      ),
  );
  const result = expect(
    requests.request(url, { ...options, signal: caller.signal }, (send) =>
      send(headers),
    ),
  ).rejects.toThrow(/cancelled/);
  await reading;
  caller.abort();
  await result;
});

it.each([true, false])(
  "refuses an oversized body, with content length %s",
  async (length) => {
    const cancel = vi.fn();
    const requests = new HostRequests(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("oversized"));
            },
            cancel,
          }),
          { headers: length ? { "content-length": "9" } : {} },
        ),
    );
    await expect(
      requests.request(url, { ...options, limit: 4 }, (send) => send(headers)),
    ).rejects.toThrow("Too much data.");
    expect(cancel).toHaveBeenCalledOnce();
  },
);

it("returns null for an empty JSON body and preserves response headers", async () => {
  const requests = new HostRequests(
    async () =>
      new Response(null, {
        status: 204,
        headers: { "x-request-id": "sample" },
      }),
  );
  const result = await requests.request(url, options, (send) => send(headers));
  expect(result.data).toBeNull();
  expect(result.headers.get("x-request-id")).toBe("sample");
});

it("cleans up after invalid JSON or a provider error and preserves their messages", async () => {
  vi.useFakeTimers();
  const requests = new HostRequests(async () => new Response("invalid json"));
  await expect(
    requests.request(url, options, (send) => send(headers)),
  ).rejects.toBeInstanceOf(SyntaxError);
  await expect(
    requests.request(url, options, async () => {
      throw new Error("Provider refused.");
    }),
  ).rejects.toThrow("Provider refused.");
  expect(vi.getTimerCount()).toBe(0);
});
