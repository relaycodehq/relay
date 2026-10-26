import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  executableCommand,
  findExecutable,
  runExecutable,
  spawnExecutable,
} from "../platform/executables";
import { terminate } from "../platform/terminate";
import type { InstallDeps } from "./install";
import type { ResolveDeps } from "./resolve";

const windows = process.platform === "win32";

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Where `go install` puts programs, which a GUI app's PATH rarely has. */
function goBins() {
  return [
    process.env.GOBIN,
    process.env.GOPATH && join(process.env.GOPATH, "bin"),
    join(homedir(), "go", "bin"),
  ].filter((dir): dir is string => !!dir);
}

/** A program on PATH or in the folders Relay looks in for CLIs, plus Go's. */
export async function findProgram(name: string) {
  try {
    return await findExecutable(name);
  } catch {
    for (const dir of goBins()) {
      const file = join(dir, windows ? `${name}.exe` : name);
      if (await exists(file)) return file;
    }
  }
}

export const probe: InstallDeps["probe"] = async (file, args) => {
  const run = await runExecutable(file, args, 5000).catch(() => undefined);
  return run?.code === 0;
};

export const runProgram: InstallDeps["run"] = (file, args, cwd, timeout) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawnExecutable(file, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => terminate(child), timeout);
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: e.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

export const findNpm = async () =>
  (await findProgram("npm")) ?? Promise.reject(new Error("npm"));

export const resolvePlatform: Pick<
  ResolveDeps,
  "find" | "probe" | "command" | "node"
> = {
  find: findProgram,
  probe,
  command: (file, args) => executableCommand(file, args),
  // Electron's own binary runs a script as plain Node; under Node it's a no-op.
  node: { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } },
};

/** Starts a server with its pipes; Windows gets no console window. */
export function spawnServer(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}
