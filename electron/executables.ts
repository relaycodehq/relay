import { access } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";
export async function findExecutable(name: string) {
  const paths = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".bun/bin"),
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  for (const dir of paths) {
    if (!dir) continue;
    const full = join(dir, name);
    try {
      await access(full, constants.X_OK);
      return full;
    } catch {}
  }
  throw new Error(
    `${name} was not found. Install it and make sure it is on PATH.`,
  );
}
