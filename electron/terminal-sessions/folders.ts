import { win32 } from "node:path";

/** Codex uses namespaced Windows paths in SQLite and ordinary paths in rollouts. */
function windowsFolder(value: string) {
  const plain = value
    .replaceAll("/", "\\")
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/, "");
  const absolute = /^[a-z]:\\/i.test(plain) || plain.startsWith("\\\\");
  if (!absolute) return;
  const normalized = win32.normalize(plain);
  const root = win32.parse(normalized).root;
  return normalized.length > root.length
    ? normalized.replace(/\\$/, "")
    : normalized;
}

export function sessionFolderMatches(roots: Set<string>, cwd: string) {
  const key = windowsFolder(cwd)?.toLowerCase() ?? cwd;
  return [...roots].some(
    (root) => (windowsFolder(root)?.toLowerCase() ?? root) === key,
  );
}

/** Keep the SQL lookup bounded to this folder's equivalent spellings. */
export function sessionFolderQuery(roots: Set<string>) {
  const paths = new Set<string>();
  let allWindows = true;
  for (const root of roots) {
    paths.add(root);
    const normalized = windowsFolder(root);
    if (!normalized) {
      allWindows = false;
      continue;
    }
    for (const path of [normalized, win32.toNamespacedPath(normalized)]) {
      paths.add(path);
      paths.add(path.replaceAll("\\", "/"));
    }
  }
  return {
    paths: [...paths],
    collation: allWindows ? "NOCASE" : "BINARY",
  };
}
