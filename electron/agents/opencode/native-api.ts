import { execFile } from "node:child_process";
import { request } from "node:http";
import { promisify } from "node:util";
import { executableCommand, findExecutable } from "../../platform/executables";

const exec = promisify(execFile);

/**
 * OpenCode 2's shared local service. Rediscover on every operation: its owner
 * may have restarted it or replaced its password. Provider credentials stay
 * owned by OpenCode; keys and authorization codes never go in process args.
 */
export async function openCodeNativeApi(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: object,
): Promise<unknown> {
  const executable = await findExecutable("opencode");
  const cli = async (args: string[]) => {
    const line = executableCommand(executable, args);
    try {
      return (
        await exec(line.command, line.args, {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1 << 20,
          windowsHide: true,
        })
      ).stdout.trim();
    } catch {
      throw new Error(
        "Couldn't connect to OpenCode. Check its installation and try again.",
      );
    }
  };
  let address = await cli(["service", "status"]);
  if (address === "stopped") {
    // The CLI ensures a service exists and reuses one of another version.
    // Unlike `service start`, this does not replace an existing service.
    await cli(["api", "GET", "/api/info"]);
    address = await cli(["service", "status"]);
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("OpenCode didn't report its local service address.");
  }
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (url.hostname === "[::]") url.hostname = "[::1]";
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("OpenCode didn't report a local HTTP service.");
  const password = await cli(["service", "get", "password"]);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(path, url),
      {
        method,
        auth: `opencode:${password}`,
        headers:
          payload === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              },
        signal: AbortSignal.timeout(30_000),
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("error", () =>
          reject(new Error("OpenCode closed the connection. Try again.")),
        );
        res.on("data", (chunk: string) => {
          text += chunk;
          if (text.length > 4_000_000)
            req.destroy(new Error("OpenCode's response was too large."));
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          // Error bodies and child-process errors can echo submitted secrets.
          if (status < 200 || status >= 300)
            return reject(
              new Error(
                `OpenCode couldn't complete this connection request (HTTP ${status}). Try again.`,
              ),
            );
          try {
            resolve(text ? JSON.parse(text) : undefined);
          } catch {
            reject(
              new Error("OpenCode sent an unexpected connection response."),
            );
          }
        });
      },
    );
    req.on("error", () =>
      reject(new Error("Couldn't reach OpenCode's service. Try again.")),
    );
    req.end(payload);
  });
}
