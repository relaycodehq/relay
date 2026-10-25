import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  encodeMessage,
  isCancelled,
  MessageParser,
  RpcConnection,
  RpcError,
} from "./rpc";

const frame = (message: object) => encodeMessage(message);

describe("MessageParser", () => {
  const first = { id: 1, result: { text: "héllo → 世界 😀" } };
  const second = { method: "window/logMessage", params: { message: "x" } };

  it("reads messages whole, many in one chunk", () => {
    const parser = new MessageParser();
    const out = parser.push(Buffer.concat([frame(first), frame(second)]));
    expect(out).toEqual([
      { jsonrpc: "2.0", ...first },
      { jsonrpc: "2.0", ...second },
    ]);
  });

  it("reads them when chunks end anywhere, even inside a character", () => {
    const bytes = Buffer.concat([frame(first), frame(second)]);
    for (let cut = 1; cut < bytes.length; cut++) {
      const parser = new MessageParser();
      const out = [
        ...parser.push(bytes.subarray(0, cut)),
        ...parser.push(bytes.subarray(cut)),
      ];
      expect(out).toHaveLength(2);
    }
  });

  it("reads one byte at a time", () => {
    const parser = new MessageParser();
    const out: unknown[] = [];
    for (const byte of frame(first))
      out.push(...parser.push(Buffer.from([byte])));
    expect(out).toEqual([{ jsonrpc: "2.0", ...first }]);
  });

  it("counts the length in bytes, not characters", () => {
    const parser = new MessageParser();
    const [message] = parser.push(frame({ id: 1, result: "😀😀😀" }));
    expect(message).toMatchObject({ result: "😀😀😀" });
  });

  it("accepts other headers and any header case", () => {
    const body = JSON.stringify({ id: 3 });
    const parser = new MessageParser();
    const out = parser.push(
      Buffer.from(
        `content-type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
      ),
    );
    expect(out).toEqual([{ id: 3 }]);
  });

  it("skips a body that isn't JSON and carries on", () => {
    const parser = new MessageParser();
    const bad = Buffer.from("Content-Length: 3\r\n\r\n{{{");
    expect(parser.push(Buffer.concat([bad, frame(second)]))).toEqual([
      { jsonrpc: "2.0", ...second },
    ]);
  });

  it("throws for a header without a length or one that never ends", () => {
    expect(() =>
      new MessageParser().push(Buffer.from("Foo: bar\r\n\r\n")),
    ).toThrow(/Content-Length/);
    expect(() =>
      new MessageParser().push(Buffer.from("x".repeat(9000))),
    ).toThrow(/no end/);
  });
});

function connect(
  request: (method: string, params: unknown) => unknown = vi.fn(() => null),
) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const sent: any[] = [];
  const parser = new MessageParser();
  toServer.on("data", (chunk) => sent.push(...parser.push(chunk)));
  const notification = vi.fn();
  const broken = vi.fn();
  const conn = new RpcConnection(
    { stdin: toServer, stdout: fromServer },
    { request, notification, broken },
  );
  const reply = (message: object) => fromServer.write(frame(message));
  const tick = () => new Promise((r) => setImmediate(r));
  return { conn, sent, reply, notification, broken, fromServer, tick, request };
}

describe("RpcConnection", () => {
  it("matches replies to requests by id", async () => {
    const { conn, sent, reply, tick } = connect();
    const a = conn.request("a", { x: 1 });
    const b = conn.request("b", null);
    await tick();
    expect(sent.map((m) => [m.id, m.method])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    reply({ id: 2, result: "second" });
    reply({ id: 1, result: "first" });
    await expect(a).resolves.toBe("first");
    await expect(b).resolves.toBe("second");
  });

  it("rejects with the server's error and its code", async () => {
    const { conn, reply, tick } = connect();
    const p = conn.request("a", null);
    await tick();
    reply({ id: 1, error: { code: -32801, message: "content modified" } });
    const error = await p.catch((e) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(isCancelled(error)).toBe(true);
    expect(isCancelled(new RpcError("x", -32603))).toBe(false);
  });

  it("times out, telling the server to cancel", async () => {
    const { conn, sent, tick } = connect();
    await expect(conn.request("slow", null, 20)).rejects.toThrow(/timed out/);
    await tick();
    expect(sent.at(-1)).toMatchObject({
      method: "$/cancelRequest",
      params: { id: 1 },
    });
  });

  it("answers a request from the server, and an error when the handler throws", async () => {
    const request = vi.fn((method: string) => {
      if (method === "boom") throw new RpcError("no", -32601);
      return { ok: true };
    });
    const { sent, reply, tick } = connect(request);
    reply({ id: 7, method: "ask", params: { a: 1 } });
    reply({ id: "s", method: "boom" });
    await tick();
    await tick();
    expect(sent).toContainEqual(
      expect.objectContaining({ id: 7, result: { ok: true } }),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        id: "s",
        error: { code: -32601, message: "no" },
      }),
    );
  });

  it("hands notifications on", async () => {
    const { reply, notification, tick } = connect();
    reply({ method: "$/progress", params: { token: 1 } });
    await tick();
    expect(notification).toHaveBeenCalledWith("$/progress", { token: 1 });
  });

  it("rejects what is waiting when the pipe ends, and everything after", async () => {
    const { conn, fromServer, broken, tick } = connect();
    const p = conn.request("a", null);
    await tick();
    fromServer.end();
    await expect(p).rejects.toThrow(/ended/);
    await expect(conn.request("b", null)).rejects.toThrow(/ended/);
    expect(broken).toHaveBeenCalledOnce();
  });

  it("breaks on a framing error", async () => {
    const { conn, fromServer, broken, tick } = connect();
    const p = conn.request("a", null);
    p.catch(() => {});
    fromServer.write("Garbage: 1\r\n\r\n");
    await tick();
    expect(broken).toHaveBeenCalledOnce();
    await expect(p).rejects.toThrow(/Content-Length/);
  });

  it("closing rejects quietly", async () => {
    const { conn, broken, tick } = connect();
    const p = conn.request("a", null);
    await tick();
    conn.close();
    await expect(p).rejects.toThrow(/closed/);
    expect(broken).not.toHaveBeenCalled();
  });
});
