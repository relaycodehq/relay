import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CodexRequestError,
  withCodexTransport,
  type CodexTransport,
} from "./codex-transport";

// A Codex that exited or closed its input: every write fails like a dead pipe.
function closedCodex() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new Writable({
      write: (_chunk, _encoding, done) =>
        done(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
    }),
  });
  return child as any;
}

/** A Codex on the other end of two pipes: `heard()` is the next line we wrote, `say` writes to us. */
function fakeCodex() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
  });
  const written = createInterface({ input: stdin })[Symbol.asyncIterator]();
  return {
    child: child as any,
    stdout,
    heard: async () => JSON.parse((await written.next()).value),
    say: (message: unknown) =>
      stdout.write(
        typeof message === "string" ? message : JSON.stringify(message) + "\n",
      ),
  };
}

/** Opens a transport on `codex`; the run stays open until `close()`. */
function connect(
  codex: ReturnType<typeof fakeCodex>,
  onRequest?: (method: string, params: any) => Promise<unknown>,
) {
  const notifications: [string, unknown][] = [];
  const onError = vi.fn<(error: Error) => void>();
  let close!: () => void;
  const open = new Promise<void>((resolve) => (close = resolve));
  let wire!: CodexTransport;
  const connected = new Promise<void>((ready) => {
    void withCodexTransport(
      codex.child,
      (method, params) => notifications.push([method, params]),
      onError,
      async (transport) => {
        wire = transport;
        ready();
        await open;
      },
      onRequest,
    ).catch(() => {});
  });
  return connected.then(() => ({ wire, notifications, onError, close }));
}

it("reports a closed Codex input instead of throwing it", async () => {
  const child = closedCodex();
  const closed = new Promise<Error>((resolve) => {
    const exchange = withCodexTransport(
      child,
      () => {},
      resolve,
      (wire) => wire.request("initialize", {}),
    );
    void exchange.catch(() => {});
  });
  expect((await closed).message).toContain("EPIPE");
  child.stdout.end();
});

it("passes the run's own error through untouched", async () => {
  const failure = new Error("thread/start went sideways");
  const codex = fakeCodex();
  const outcome = withCodexTransport(
    codex.child,
    () => {},
    () => {},
    () => Promise.reject(failure),
  );
  await expect(outcome).rejects.toBe(failure);
  await expect(outcome).rejects.toThrow("thread/start went sideways");
});

it("matches answers to their requests whatever order they come in", async () => {
  const codex = fakeCodex();
  const { wire, close } = await connect(codex);
  const first = wire.request("model/list", { page: 1 });
  const second = wire.request("account/read", undefined);
  const a = await codex.heard();
  const b = await codex.heard();
  expect(a).toEqual({ id: 1, method: "model/list", params: { page: 1 } });
  expect(b).toEqual({ id: 2, method: "account/read" });
  codex.say({ id: b.id, result: { account: "me" } });
  codex.say({ id: String(a.id), result: { models: ["gpt"] } });
  expect(await first).toEqual({ models: ["gpt"] });
  expect(await second).toEqual({ account: "me" });
  close();
});

it("puts a notification back together from single bytes", async () => {
  const codex = fakeCodex();
  const { notifications, onError, close } = await connect(codex);
  const params = { delta: "Žluťoučký kůň 😅" };
  const bytes = Buffer.from(
    JSON.stringify({ method: "item/agentMessage/delta", params }) + "\r\n",
  );
  for (const byte of bytes) codex.stdout.write(Buffer.of(byte));
  await vi.waitFor(() => expect(notifications).toHaveLength(1));
  expect(notifications[0]).toEqual(["item/agentMessage/delta", params]);
  expect(onError).not.toHaveBeenCalled();
  close();
});

describe("requests from Codex", () => {
  it("declines approvals and refuses unknown methods when nobody handles them", async () => {
    const codex = fakeCodex();
    const { close } = await connect(codex);
    codex.say({
      id: "approve-1",
      method: "item/commandExecution/requestApproval",
      params: {},
    });
    expect(await codex.heard()).toEqual({
      id: "approve-1",
      result: { decision: "decline" },
    });
    codex.say({ id: 7, method: "something/new" });
    expect(await codex.heard()).toEqual({
      id: 7,
      error: { code: -32601, message: "Method not found: something/new" },
    });
    close();
  });

  it("answers with the handler's result, or its failure as an internal error", async () => {
    const codex = fakeCodex();
    const { close } = await connect(codex, async (method) => {
      if (method === "fail") throw new Error("no such tool");
      return { ok: method };
    });
    codex.say({ id: 1, method: "fail" });
    expect(await codex.heard()).toEqual({
      id: 1,
      error: { code: -32603, message: "no such tool" },
    });
    codex.say({ id: 2, method: "tool/call" });
    expect(await codex.heard()).toEqual({ id: 2, result: { ok: "tool/call" } });
    close();
  });

  it("turns away requests past the 32 already in hand, without blocking reads", async () => {
    const codex = fakeCodex();
    const handler = vi.fn(() => new Promise<unknown>(() => {}));
    const { notifications, close } = await connect(codex, handler);
    for (let id = 1; id <= 33; id++) codex.say({ id, method: "slow" });
    codex.say({ method: "still/reading" });
    expect(await codex.heard()).toEqual({
      id: 33,
      error: {
        code: -32001,
        message: "Too many Codex requests are already active.",
      },
    });
    expect(handler).toHaveBeenCalledTimes(32);
    expect(notifications).toEqual([["still/reading", {}]]);
    close();
  });
});

it("gives up on an unanswered request after 20 seconds and ignores the late answer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const codex = fakeCodex();
    const { wire, onError, close } = await connect(codex);
    const pending = wire.request("thread/start", {});
    const { id } = await codex.heard();
    vi.advanceTimersByTime(20_000);
    await expect(pending).rejects.toThrow("didn't answer thread/start");
    codex.say({ id, result: {} });
    const next = wire.request("account/read", {});
    codex.say({ id: (await codex.heard()).id, result: { account: "me" } });
    expect(await next).toEqual({ account: "me" });
    expect(onError).not.toHaveBeenCalled();
    close();
  } finally {
    vi.useRealTimers();
  }
});

it("fails what is still waiting when the run ends, without reporting it", async () => {
  const codex = fakeCodex();
  const onError = vi.fn();
  let left!: Promise<unknown>;
  await withCodexTransport(
    codex.child,
    () => {},
    onError,
    async (wire) => {
      left = wire.request("thread/start", {});
    },
  );
  await expect(left).rejects.toThrow("closed");
  expect(onError).not.toHaveBeenCalled();
});

describe("a broken connection", () => {
  const breaks: [
    string,
    (codex: ReturnType<typeof fakeCodex>) => void,
    string,
  ][] = [
    ["a line that isn't JSON", (c) => c.say("{not json\n"), "isn't JSON"],
    ["Codex closing its output", (c) => c.stdout.end(), "connection closed"],
    [
      "a line over 4 MiB",
      (c) => c.say("x".repeat(4 * 1024 * 1024 + 1)),
      "exceeds 4 MiB",
    ],
  ];

  it.each(breaks)(
    "fails the pending request and reports once on %s",
    async (_, breakIt, reason) => {
      const codex = fakeCodex();
      const { wire, onError, close } = await connect(codex);
      const pending = wire.request("thread/start", {});
      await codex.heard();
      breakIt(codex);
      await expect(pending).rejects.toThrow(reason);
      // A second failure must not report again.
      codex.stdout.destroy(new Error("read ECONNRESET"));
      await new Promise((settled) => setImmediate(settled));
      await expect(wire.request("turn/start", {})).rejects.toThrow(reason);
      await expect(wire.notify("initialized")).rejects.toThrow(reason);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].message).toContain(reason);
      close();
    },
  );
});

it("rejects an error answer with CodexRequestError", async () => {
  const codex = fakeCodex();
  const { wire, close } = await connect(codex);
  const pending = wire.request("account/rateLimits/read", {});
  const { id } = await codex.heard();
  const data = { codexErrorInfo: "unauthorized" };
  codex.say({ id, error: { code: -32000, message: "401 Unauthorized", data } });
  const error = await pending.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CodexRequestError);
  expect(error).toMatchObject({
    code: -32000,
    message: "401 Unauthorized",
    errorMessage: "401 Unauthorized",
    data,
    method: "account/rateLimits/read",
  });
  close();
});
