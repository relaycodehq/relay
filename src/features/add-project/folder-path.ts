/** Display paths using the selected computer's home, including Windows paths. */
export function folderLabel(path: string, home?: string) {
  const normalized = path.replaceAll("\\", "/");
  const base = home?.replaceAll("\\", "/").replace(/\/$/, "");
  return base && (normalized === base || normalized.startsWith(`${base}/`))
    ? `~${normalized.slice(base.length)}`
    : normalized;
}

export function parentFolder(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalized === "~" || normalized === "" || /^[a-z]:$/i.test(normalized))
    return path;
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return "~";
  const parent = normalized.slice(0, cut);
  return !parent ? "/" : /^[a-z]:$/i.test(parent) ? `${parent}/` : parent;
}
