/** Display paths using the selected computer's home, including Windows paths. */
export function folderLabel(path: string, home?: string) {
  const normalized = path.replaceAll("\\", "/");
  const base = home?.replaceAll("\\", "/").replace(/\/$/, "");
  return base && (normalized === base || normalized.startsWith(`${base}/`))
    ? `~${normalized.slice(base.length)}`
    : normalized;
}

/** A typed `~` path as the folder it stands for, once that computer's home is known. */
export function fromHomeFolder(path: string, home?: string) {
  return home && /^~(?:[\\/]|$)/.test(path)
    ? home.replace(/[\\/]$/, "") + path.slice(1)
    : path;
}

/** The folder above `path`; a root (`/`, `C:/`, `~`, `\\server\share`) is its own. */
export function parentFolder(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  if (
    normalized === "~" ||
    normalized === "" ||
    /^[a-z]:$/i.test(normalized) ||
    /^\/\/[^/]+(?:\/[^/]+)?$/.test(normalized)
  )
    return path;
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return "~";
  const parent = normalized.slice(0, cut);
  return !parent ? "/" : /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}
