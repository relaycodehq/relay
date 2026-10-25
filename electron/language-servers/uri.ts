import { posix, win32 } from "node:path";

/** How paths and `file:` URIs are written on one kind of computer. */
export function pathsFor(platform: NodeJS.Platform = process.platform) {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;

  const absolute = (root: string, file: string) =>
    path.isAbsolute(file) ? path.normalize(file) : path.join(root, file);

  /** Equal for paths that name one file: Windows ignores case and slash direction. */
  const sameKey = (file: string) =>
    windows ? path.normalize(file).toLowerCase() : path.normalize(file);

  return {
    absolute,
    key: sameKey,

    /** The URI a server knows `file` by; a relative one is inside `root`. */
    toUri(root: string, file: string) {
      const full = absolute(root, file);
      if (windows) {
        const unc = /^\\\\([^\\]+)\\(.*)$/.exec(full);
        if (unc)
          return `file://${unc[1]}/${encodePath(unc[2].replace(/\\/g, "/"))}`;
        return `file:///${encodePath(full.replace(/\\/g, "/"))}`;
      }
      return `file://${encodePath(full)}`;
    },

    /** The file a `file:` URI names; undefined for any other scheme. */
    fromUri(uri: string) {
      const match = /^file:\/\/([^/]*)(\/[^?#]*)?/i.exec(uri);
      if (!match) return undefined;
      let name: string;
      try {
        name = decodeURIComponent(match[2] ?? "/");
      } catch {
        return undefined;
      }
      if (!windows) return name;
      if (match[1] && match[1].toLowerCase() !== "localhost")
        return `\\\\${match[1]}${name.replace(/\//g, "\\")}`;
      return name.replace(/^\/(?=[A-Za-z]:)/, "").replace(/\//g, "\\");
    },

    /**
     * `file` as the editor names it: relative to `root` with `/` when inside,
     * the absolute path as is when outside. A server may name a file by its
     * real path when the folder is reached through a link (`/tmp` on macOS);
     * the `aliases` are the other names of the folder.
     */
    toWorkspacePath(root: string, file: string, aliases: string[] = []) {
      for (const base of [root, ...aliases]) {
        const rel = path.relative(base, file);
        if (
          rel !== "" &&
          rel !== ".." &&
          !rel.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(rel)
        )
          return { path: rel.split(path.sep).join("/"), outside: false };
      }
      return { path: file, outside: true };
    },
  };
}

export type Paths = ReturnType<typeof pathsFor>;

/** Percent-encodes a path's characters a URI can't hold, keeping `/` and a drive's `:`. */
function encodePath(file: string) {
  return file
    .split("/")
    .map((part, i) =>
      i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part),
    )
    .join("/");
}
