import { randomUUID } from "node:crypto";
import { rmSync, rmdirSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const owned = new Map<string, string>();
process.once("exit", () => {
  for (const [directory, marker] of owned) {
    try {
      rmSync(join(directory, marker), { force: true });
      rmdirSync(directory);
    } catch {
      /* A replacement owner always leaves its directory nonempty. */
    }
  }
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function occupied(path: string) {
  return Object.assign(new Error(`Another Relay process holds ${path}.`), {
    code: "ELOCKED",
  });
}

/**
 * Publish a nonempty directory atomically: contenders never see half an owner.
 * A stale contender removes only the marker it read. rmdir cannot delete a
 * new owner's nonempty directory, even if stale cleanup resumes much later.
 */
export async function lockPath(path: string) {
  const directory = `${resolve(path)}.lock`;
  const marker = `${process.pid}-${randomUUID()}`;
  const candidate = `${directory}-${randomUUID()}`;
  await mkdir(candidate, { mode: 0o700 });
  try {
    await writeFile(join(candidate, marker), "", { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(candidate, directory);
        break;
      } catch (e) {
        if (
          !["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(
            (e as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw e;
        if (attempt >= 8) throw occupied(directory);
      }
      let entries: string[];
      try {
        const info = await lstat(directory);
        if (
          !info.isDirectory() ||
          (process.platform !== "win32" && info.uid !== process.getuid!())
        )
          throw occupied(directory);
        entries = await readdir(directory);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      for (const entry of entries) {
        const pid = /^(\d+)-[0-9a-f-]{36}$/.exec(entry)?.[1];
        if (!pid || alive(Number(pid))) throw occupied(directory);
      }
      // Never recursively delete a lock: another owner may have replaced it.
      for (const entry of entries)
        await rm(join(directory, entry), { force: true });
      await rmdir(directory).catch((e: NodeJS.ErrnoException) => {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code ?? "")) throw e;
      });
    }
    owned.set(directory, marker);
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    owned.delete(directory);
    await rm(join(directory, marker), { force: true });
    await rmdir(directory).catch((e: NodeJS.ErrnoException) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code ?? "")) throw e;
    });
  };
}
