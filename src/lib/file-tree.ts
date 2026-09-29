import type { DirEntry, DirListing } from "../../shared/project-files";

export const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export const joinPath = (dir: string, name: string) =>
  dir ? `${dir}/${name}` : name;

/** The folders above a path, outermost first: `a/b/c` is under `a` and `a/b`. */
export function ancestors(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) ((value /= 1024), unit++);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  kind: DirEntry["kind"];
  ignored: boolean;
  open: boolean;
  /** An open folder whose listing hasn't arrived. */
  loading: boolean;
}

/** The visible rows: each open folder's entries right under it. */
export function treeRows(
  listing: (dir: string) => DirListing | undefined,
  expanded: ReadonlySet<string>,
) {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of listing(dir)?.entries ?? []) {
      const path = joinPath(dir, entry.name);
      const open = entry.kind === "dir" && expanded.has(path);
      rows.push({
        path,
        name: entry.name,
        depth,
        kind: entry.kind,
        ignored: entry.ignored,
        open,
        loading: open && !listing(path),
      });
      if (open) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}
