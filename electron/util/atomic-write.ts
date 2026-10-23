import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  /** The new file's mode; defaults to owner-only. */
  mode?: number;
  /** Keep the mode of the file it replaces, falling back to `mode`. */
  keepMode?: boolean;
  /** Make the folder first, with this mode, or the default with `true`. */
  mkdir?: number | true;
  /** Flush the data to disk before the rename, for files that must survive a power cut. */
  sync?: boolean;
}

/**
 * Writes `data` to `path` whole: into a file beside it, then renamed over it,
 * so a crash leaves the old file or the new one, never half of either.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
) {
  const folder = dirname(path);
  if (options.mkdir !== undefined)
    await mkdir(folder, {
      recursive: true,
      ...(options.mkdir === true ? {} : { mode: options.mkdir }),
    });
  let mode = options.mode ?? 0o600;
  if (options.keepMode)
    mode = await stat(path).then(
      (s) => s.mode & 0o777,
      () => mode,
    );
  // Unique per call, so writers that overlap never share a temporary file.
  const temp = join(folder, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data, { mode, flag: "wx" });
    if (options.sync) {
      const handle = await open(temp, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    // The mode a file is created with is cut by the umask; chmod's isn't.
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (e) {
    await rm(temp, { force: true }).catch(() => {});
    throw e;
  }
}
