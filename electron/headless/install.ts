import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { renameSoon } from "./archive";
import { lockPath } from "./lock";

/** A checked release replaces an install under the same lock on every path. */
export async function replaceInstallation(
  root: string,
  staged: string,
  version: string,
  current?: string,
) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Invalid Relay version.");
  const said = (await readFile(join(staged, "VERSION"), "utf8")).trim();
  if (said !== version || !existsSync(join(staged, "lib", "relay.cjs")))
    throw new Error("The download isn't a headless Relay; nothing changed.");
  // Resolve aliases before locking, including a symlinked installation parent.
  root = await realpath(root).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    const absolute = resolve(root);
    return join(await realpath(dirname(absolute)), basename(absolute));
  });
  const release = await lockPath(`${root}.update`);
  try {
    const installed = await readFile(join(root, "VERSION"), "utf8").catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return "";
        throw e;
      },
    );
    if (current !== undefined && installed.trim() !== current) {
      if (installed.trim() === version) return false;
      throw new Error("The installation changed; retry the update.");
    }
    const old = `${root}.old-${randomUUID()}`;
    const hadInstall = existsSync(root);
    if (hadInstall) await renameSoon(root, old);
    try {
      await renameSoon(staged, root);
    } catch (e) {
      if (hadInstall) await renameSoon(old, root);
      throw e;
    }
    // Cleanup can't turn a completed install into a failed update without a restart.
    await rm(old, { recursive: true, force: true }).catch((e) =>
      console.warn(`Relay was installed, but couldn't remove ${old}:`, e),
    );
    return true;
  } finally {
    await release();
  }
}
