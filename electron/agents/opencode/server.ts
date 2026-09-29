import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import {
  executableCommand,
  findExecutable,
  spawnExecutable,
} from "../../executables";
import type { AgentHosts, HostedProcess } from "../../agent-host/client";

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
/** The server the agent host runs, when it does: it outlives a restart of Relay. */
let hosted: HostedProcess | undefined;
let hosts: AgentHosts | undefined;
export function useOpenCodeHosts(agentHosts: AgentHosts) {
  hosts = agentHosts;
}
/** What the hosted server keeps for the next Relay: where it listens, and its password. */
type OpenCodeMeta = {
  provider: "opencode";
  password: string;
  url?: string;
};

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
  const args = ["serve", "--hostname=127.0.0.1", "--port=0"];
  const env = { ...process.env, OPENCODE_SERVER_PASSWORD: password };
  const url = hosts
    ? await startHosted(executable, args, env, password).catch((error) => {
        console.warn(
          "The agent host is unavailable; OpenCode runs in Relay:",
          error,
        );
        return startLocal(executable, args, env);
      })
    : await startLocal(executable, args, env);
  const auth = basic(password);
  const health = await healthOf(url, auth);
  if (!health) {
    stopOpenCodeServer();
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
    stopOpenCodeServer();
    throw new Error(
      `OpenCode ${version ?? "(unknown version)"} is too old for Relay. Update it to 1.14 or later.`,
    );
  }
  hosted?.keep({ provider: "opencode", password, url } satisfies OpenCodeMeta);
  return { url, auth, version: version ?? "" };
}

const basic = (password: string) =>
  "Basic " + Buffer.from(`opencode:${password}`).toString("base64");

/** Starts the server in the agent host and reads where it listens off its log. */
async function startHosted(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  password: string,
) {
  const running = await hosts!.openProcess({
    key: "opencode:server",
    meta: { provider: "opencode", password } satisfies OpenCodeMeta,
    process: {
      ...executableCommand(executable, args),
      cwd: process.cwd(),
      env: env as Record<string, string>,
      // Its own group, so stopping it also stops the commands it started.
      group: true,
    },
  });
  hosted = running;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      stopOpenCodeServer();
      reject(new Error("OpenCode's server did not start in time."));
    }, 30000);
    follow(running, (entry) => {
      if (entry.kind === "line") {
        const match = bannerPattern.exec(entry.text);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      } else if (entry.kind === "end") {
        clearTimeout(timer);
        reject(
          new Error(
            `OpenCode's server stopped before it was ready. ${entry.failure ?? ""}`.trim(),
          ),
        );
      }
    });
  });
}

/** Reads a hosted server's log for as long as it runs; its end ends the server. */
function follow(
  running: HostedProcess,
  also?: (entry: import("../../agent-host/protocol").Entry) => void,
) {
  running.read({
    entry: (entry) => {
      also?.(entry);
      if (entry.kind === "end" && hosted === running) {
        hosted = undefined;
        server = undefined;
      }
    },
  });
}

async function startLocal(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  const process_ = spawnExecutable(executable, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Its own group, so stopping it also stops the commands it started.
    detached: process.platform !== "win32",
  });
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
  return url;
}

function healthOf(url: string, auth: string) {
  return new Promise<{ version?: string } | null>((resolve) => {
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
  hosted?.close();
  hosted = undefined;
  stopLocal();
}
function stopLocal() {
  const running = child;
  child = undefined;
  server = undefined;
  if (running) stop(running);
}
// A server left behind in Relay's own process tree would keep running
// commands after Relay has gone; the host's one is meant to carry on.
process.once("exit", stopLocal);

/** Relay is restarting: the hosted server carries on, and is found again after. */
export function detachOpenCodeServer() {
  hosted = undefined;
  stopLocal();
}

/** Marks a thread's turn on the hosted server, so a restart knows it was running. */
export function markOpenCodeTurn(key: string, mark: "start" | "end") {
  hosted?.mark(mark, { turn: key });
}

/**
 * Takes back the server the agent host kept running while Relay restarted,
 * and names the threads whose turns were running on it then.
 */
export async function reattachOpenCodeServer(
  owns: (key: string) => boolean,
): Promise<{ key: string; open: boolean }[]> {
  if (!hosts) return [];
  const back: { key: string; open: boolean }[] = [];
  for (const found of await hosts.discover()) {
    const meta = found.info.meta as OpenCodeMeta | undefined;
    if (meta?.provider !== "opencode") continue;
    const auth = basic(meta.password ?? "");
    const health =
      !server && meta.url ? await healthOf(meta.url, auth) : undefined;
    if (!health || !meta.url) {
      found.close();
      continue;
    }
    const running = found.attachProcess();
    hosted = running;
    follow(running);
    server = Promise.resolve({
      url: meta.url,
      auth,
      version: health.version ?? "",
    });
    for (const key of Object.keys(found.info.turns ?? {}))
      if (owns(key)) back.push({ key, open: true });
      else markOpenCodeTurn(key, "end");
  }
  return back;
}
