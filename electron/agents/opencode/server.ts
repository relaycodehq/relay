import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { findExecutable, spawnExecutable } from "../../executables";

/** A running `opencode serve`, reached over HTTP with Basic auth. */
export interface OpenCodeServer {
  url: string;
  auth: string;
  version: string;
}

/** 1.x serves the session API Relay speaks; 2.x replaced it with `/api/…`. */
const minimumVersion = [1, 14];
const bannerPattern = /opencode server listening on (http:\/\/\S+)/;

let server: Promise<OpenCodeServer> | undefined;
let child: ChildProcess | undefined;

/**
 * One server for all of Relay: requests name the directory they work in, and
 * each thread's permissions live on its own session. Started on first use,
 * and again if it exits.
 */
export function openCodeServer(): Promise<OpenCodeServer> {
  server ??= start().catch((error) => {
    server = undefined;
    throw error;
  });
  return server;
}

async function start(): Promise<OpenCodeServer> {
  const executable = await findExecutable("opencode");
  const password = randomBytes(24).toString("base64url");
  const process_ = spawnExecutable(
    executable,
    ["serve", "--hostname=127.0.0.1", "--port=0"],
    {
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own group, so stopping it also stops the commands it started.
      detached: process.platform !== "win32",
    },
  );
  child = process_;
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => fail(new Error("OpenCode's server did not start in time.")),
      30000,
    );
    const fail = (error: Error) => {
      clearTimeout(timer);
      stop(process_);
      reject(error);
    };
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000);
      const match = bannerPattern.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    process_.stdout?.on("data", read);
    process_.stderr?.on("data", read);
    process_.once("error", fail);
    process_.once("exit", (code) =>
      fail(
        new Error(
          `OpenCode's server stopped before it was ready (exit ${code}).${output.trim() ? ` ${output.trim().slice(-300)}` : ""}`,
        ),
      ),
    );
  });
  process_.once("exit", () => {
    if (child === process_) {
      child = undefined;
      server = undefined;
    }
  });
  const auth =
    "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  const health = await new Promise<{ version?: string } | null>((resolve) => {
    const req = request(
      `${url}/global/health`,
      { headers: { authorization: auth } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          try {
            resolve(response.statusCode === 200 ? JSON.parse(body) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });
  if (!health) {
    stop(process_);
    throw new Error(
      "This OpenCode doesn't serve the API Relay speaks. Relay works with OpenCode 1.14 or later in the 1.x line.",
    );
  }
  const { version } = health;
  const [major = 0, minor = 0] = (version ?? "").split(".").map(Number);
  if (
    major < minimumVersion[0] ||
    (major === minimumVersion[0] && minor < minimumVersion[1])
  ) {
    stop(process_);
    throw new Error(
      `OpenCode ${version ?? "(unknown version)"} is too old for Relay. Update it to 1.14 or later.`,
    );
  }
  return { url, auth, version: version ?? "" };
}

function stop(process_: ChildProcess) {
  if (process_.exitCode !== null || process_.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && process_.pid)
      process.kill(-process_.pid, "SIGTERM");
    else process_.kill("SIGTERM");
  } catch {
    process_.kill("SIGTERM");
  }
  const force = setTimeout(() => {
    try {
      if (process.platform !== "win32" && process_.pid)
        process.kill(-process_.pid, "SIGKILL");
      else process_.kill("SIGKILL");
    } catch {}
  }, 3000);
  force.unref();
  process_.once("exit", () => clearTimeout(force));
}

/** Stops the server, e.g. as Relay quits. */
export function stopOpenCodeServer() {
  const running = child;
  child = undefined;
  server = undefined;
  if (running) stop(running);
}
// A server left behind would keep running commands after Relay has gone.
process.once("exit", stopOpenCodeServer);
