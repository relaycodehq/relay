// A minimal JSON-RPC client for a language server over stdio (LSP framing).
import { spawn } from "node:child_process";
export function connect(exe, args, cwd, onExit) {
  const child = spawn(exe, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let buffer = Buffer.alloc(0),
    id = 0,
    stderr = "",
    exited;
  const write = (message) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    child.stdin.write(
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  };
  const receive = (m) => {
    if (m.method && m.id != null) {
      // The server asks for editor settings and dynamic registrations; decline
      // both so it uses its defaults and watches files itself.
      write({
        id: m.id,
        result:
          m.method === "workspace/configuration"
            ? m.params.items.map(() => null)
            : null,
      });
      return;
    }
    const request = pending.get(m.id);
    if (!request) return;
    pending.delete(m.id);
    clearTimeout(request.timer);
    if (m.error) request.reject(new Error(m.error.message));
    else request.resolve(m.result);
  };
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const header = buffer.indexOf("\r\n\r\n");
      if (header < 0) return;
      const length = Number(
        /Content-Length: *(\d+)/i.exec(
          buffer.subarray(0, header).toString(),
        )?.[1],
      );
      if (!Number.isFinite(length)) {
        fail("The language server sent an invalid response");
        child.kill();
        return;
      }
      if (buffer.length < header + 4 + length) return;
      const body = buffer.subarray(header + 4, header + 4 + length);
      buffer = buffer.subarray(header + 4 + length);
      receive(JSON.parse(body.toString("utf8")));
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  child.stdin.on("error", () => {});
  const fail = (reason) => {
    if (exited) return;
    exited = new Error(
      `${reason}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`,
    );
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(exited);
    }
    pending.clear();
    onExit(exited);
  };
  child.on("error", (e) => fail(`Could not run ${exe} (${e.message})`));
  child.on("exit", (code, signal) =>
    fail(`The language server exited (${code ?? signal})`),
  );
  return {
    request(method, params, timeout = 60000) {
      if (exited) return Promise.reject(exited);
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`${method} timed out`));
        }, timeout);
        pending.set(requestId, { resolve, reject, timer });
        write({ id: requestId, method, params });
      });
    },
    notify(method, params) {
      if (!exited) write({ method, params });
    },
    close() {
      exited ??= new Error("Closed");
      child.kill();
    },
  };
}
