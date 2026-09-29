import { writeFile } from "node:fs/promises";
import { basename, delimiter } from "node:path";

/**
 * Relay only trusts a CLI that says its version, and moves on to the next one
 * on PATH otherwise, so a stand-in that stayed silent would lose to the real
 * CLI on a machine that has one.
 */
const answersVersion =
  'if (process.argv.slice(2).includes("--version")) {\n  console.log("1.0.0");\n  process.exit(0);\n}\n';

/**
 * Installs a stand-in command at `path` that runs `script` with Node. On
 * macOS and Linux that's the script itself with a shebang. Windows can't run
 * those, so there it's `<path>.js`, which Relay and the Claude SDK start with Node, plus a
 * `.cmd` shim pointing at it for a PATH lookup to find. A shebang line
 * already on `script` is replaced. Returns the file to run.
 */
export async function fakeCli(path: string, script: string | Buffer) {
  const source = answersVersion + String(script).replace(/^#!.*\n/, "");
  if (process.platform !== "win32") {
    await writeFile(path, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    return path;
  }
  await writeFile(`${path}.js`, source);
  await writeFile(`${path}.cmd`, `@node "%~dp0\\${basename(path)}.js" %*\r\n`);
  return `${path}.js`;
}

/** `env`'s PATH with `bin` first, under the key `env` already uses ("Path" on Windows). */
export function pathWith(env: Record<string, string>, bin: string) {
  const key =
    Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return { [key]: bin + delimiter + (env[key] ?? "") };
}
