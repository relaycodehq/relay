import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it } from "vitest";
import { withCodexTransport } from "./codex-transport";

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
