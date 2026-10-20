import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, it, vi } from "vitest";
import { AcpConnection, AcpRequestError } from "./acp/connection";
import { MuseConnection, MuseRequestError } from "./muse/connection";

function processStreams() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const sent: Record<string, unknown>[] = [];
  child.stdin.on("data", (chunk) => sent.push(JSON.parse(chunk.toString())));
  return {
    child: child as unknown as ChildProcessWithoutNullStreams & {
      stdout: PassThrough;
      stderr: PassThrough;
    },
    sent,
    receive: (value: unknown) =>
      child.stdout.write(JSON.stringify(value) + "\n"),
  };
}

for (const provider of ["acp", "muse"] as const) {
  const connect = (child: ChildProcessWithoutNullStreams) =>
    provider === "acp"
      ? new AcpConnection(child, "Test agent")
      : new MuseConnection(child);

  it(`${provider}: matches replies and retains provider errors`, async () => {
    const { child, sent, receive } = processStreams();
    const connection = connect(child);
    const result = connection.request("session/start", { prompt: "Hello" });
    expect(sent[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "session/start",
    });
    receive({ id: 1, result: { session: "one" } });
    await expect(result).resolves.toEqual({ session: "one" });
    const rejected = connection.request("session/next", {});
    const failure = expect(rejected).rejects.toMatchObject({
      code: 401,
      message: "Sign in",
      method: "session/next",
      ...(provider === "muse" ? { kind: "authentication" } : {}),
    });
    receive({
      id: 2,
      error: {
        code: 401,
        message: "Sign in",
        data: { kind: "authentication" },
      },
    });
    await failure;
    await expect(rejected).rejects.toBeInstanceOf(
      provider === "acp" ? AcpRequestError : MuseRequestError,
    );
    child.stdout.end();
  });

  it(`${provider}: replays early replies and continues request numbering`, async () => {
    const { child, sent, receive } = processStreams();
    const connection = connect(child);
    receive({ id: 41, result: "Finished while away" });
    await expect(connection.wait(41)).resolves.toBe("Finished while away");
    connection.continueAfter(41);
    connection.continueAfter(3);
    const next = connection.request("session/next", {});
    expect(sent[0].id).toBe(42);
    receive({ id: 42, result: "Next" });
    await expect(next).resolves.toBe("Next");
    child.stdout.end();
  });

  it(`${provider}: rejects pending and new requests once the process closes`, async () => {
    const { child, sent } = processStreams();
    const connection = connect(child);
    const onClose = vi.fn();
    connection.onClose = onClose;
    child.stderr.write("An explanatory error");
    const pending = expect(
      connection.request("session/start", {}),
    ).rejects.toThrow("An explanatory error");
    child.stdout.end();
    await pending;
    await expect(connection.request("session/next", {})).rejects.toThrow(
      "stopped",
    );
    await expect(connection.wait(99)).rejects.toThrow("stopped");
    expect(sent).toHaveLength(1);
    expect(onClose).toHaveBeenCalledOnce();
  });
}

it("keeps ACP permissions and Muse's unsupported-request response separate", () => {
  const acp = processStreams();
  new AcpConnection(acp.child, "ACP");
  acp.receive({
    id: "permission",
    method: "session/request_permission",
    params: {},
  });
  expect(acp.sent[0]).toMatchObject({
    id: "permission",
    result: { outcome: { outcome: "cancelled" } },
  });
  const muse = processStreams();
  new MuseConnection(muse.child);
  muse.receive({
    id: "unsupported",
    method: "session/request_permission",
    params: {},
  });
  expect(muse.sent[0]).toMatchObject({
    id: "unsupported",
    error: { code: -32601 },
  });
  acp.child.stdout.end();
  muse.child.stdout.end();
});
