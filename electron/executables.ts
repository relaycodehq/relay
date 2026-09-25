import { access, readFile } from "node:fs/promises";
import { join, delimiter, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { pathReady } from "./shell-path";

const windows = process.platform === "win32";

function searchPaths() {
  const home = homedir();
  return [
    ...(process.env.PATH ?? "").split(delimiter),
    join(home, ".bun/bin"),
    join(home, ".local/bin"),
    join(home, ".opencode/bin"),
    ...(windows
      ? [
          process.env.APPDATA && join(process.env.APPDATA, "npm"),
          process.env.LOCALAPPDATA &&
            join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd"),
          process.env.ProgramFiles &&
            join(process.env.ProgramFiles, "Git", "cmd"),
          process.env.ProgramFiles && join(process.env.ProgramFiles, "nodejs"),
        ]
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]),
  ].filter((dir): dir is string => !!dir);
}

/**
 * npm installs Windows commands as `.cmd` shims, which Node cannot spawn
 * without a shell. Use the shim's real target instead: a native `.exe`, or a
 * JavaScript entry that `spawnExecutable` runs with Node.
 */
async function unwrapShim(path: string) {
  const text = await readFile(path, "utf8").catch(() => "");
  const target = /"%~?dp0%?\\([^"%]+\.(?:exe|js|cjs|mjs))"/i.exec(text)?.[1];
  return target ? join(dirname(path), target) : path;
}

export async function findExecutable(name: string) {
  await pathReady();
  const extensions = windows ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of searchPaths()) {
    for (const extension of extensions) {
      const full = join(dir, name + extension);
      try {
        await access(full, windows ? constants.F_OK : constants.X_OK);
      } catch {
        continue;
      }
      if (!windows || extension === ".exe") return full;
      if (extension === "") continue;
      const target = await unwrapShim(full);
      if (target !== full) return target;
    }
  }
  throw new Error(
    `${name} was not found. Install it and make sure it is on PATH.`,
  );
}

/** Runs a path from `findExecutable`, starting JavaScript entries with Node. */
export const spawnExecutable = ((
  file: string,
  args: readonly string[],
  options: object,
) =>
  /^\.[cm]?js$/i.test(extname(file))
    ? spawn("node", [file, ...args], options)
    : spawn(file, args, options)) as typeof spawn;
