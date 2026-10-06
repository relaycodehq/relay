import type { TurnFileChange } from "../../../shared/projects";

// Changed files as a folder tree: each folder carries its files' totals, and
// a chain of folders that each hold only the next reads as one row.
export interface DiffStat {
  additions: number;
  deletions: number;
}
export type TurnTreeNode =
  | {
      kind: "directory";
      name: string;
      path: string;
      stat: DiffStat;
      children: TurnTreeNode[];
    }
  | { kind: "file"; name: string; path: string; change: TurnFileChange };
type FileNode = Extract<TurnTreeNode, { kind: "file" }>;

/** A folder while the tree is gathered, keyed by its path in the map that holds it. */
interface Gathered {
  name: string;
  stat: DiffStat;
  /** Paths of the folders inside, in the order the changes first named them. */
  subfolders: string[];
  files: FileNode[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

const addTo = (stat: DiffStat, change: DiffStat) => {
  stat.additions += change.additions;
  stat.deletions += change.deletions;
};

export function sumStats(files: readonly TurnFileChange[]): DiffStat {
  const total = { additions: 0, deletions: 0 };
  for (const file of files) addTo(total, file);
  return total;
}

const gathered = (name: string): Gathered => ({
  name,
  stat: { additions: 0, deletions: 0 },
  subfolders: [],
  files: [],
});

/** Every folder the changes touch, by path, with "" for the root. */
function gather(files: readonly TurnFileChange[]) {
  const folders = new Map([["", gathered("")]]);
  for (const change of files) {
    const segments = change.path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    let path = "";
    let folder = folders.get(path)!;
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let inner = folders.get(path);
      if (!inner) {
        folders.set(path, (inner = gathered(segment)));
        folder.subfolders.push(path);
      }
      addTo(inner.stat, change);
      folder = inner;
    }
    folder.files.push({ kind: "file", name, path: change.path, change });
  }
  return folders;
}

function nodesIn(folders: Map<string, Gathered>, path: string): TurnTreeNode[] {
  const folder = folders.get(path)!;
  // Ordered by their own names, before any chain below them is folded in.
  const subfolders = folder.subfolders
    .map((sub) => ({ path: sub, name: folders.get(sub)!.name }))
    .sort(byName)
    .map((sub) => folderNode(folders, sub.path));
  return [...subfolders, ...[...folder.files].sort(byName)];
}

function folderNode(
  folders: Map<string, Gathered>,
  path: string,
): TurnTreeNode {
  let folder = folders.get(path)!;
  let name = folder.name;
  // `src` holding only `components` reads as one `src/components` row.
  while (folder.subfolders.length === 1 && !folder.files.length) {
    path = folder.subfolders[0];
    folder = folders.get(path)!;
    name += `/${folder.name}`;
  }
  return {
    kind: "directory",
    name,
    path,
    stat: folder.stat,
    children: nodesIn(folders, path),
  };
}

export function buildTurnTree(
  files: readonly TurnFileChange[],
): TurnTreeNode[] {
  return nodesIn(gather(files), "");
}

/** 1234 → "1.2k", 25_600 → "26k", 3_400_000 → "3m". */
export function compactCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    // One decimal while it still says something, without a trailing ".0".
    const shown =
      thousands < 10 ? Number(thousands.toFixed(1)) : Math.round(thousands);
    return `${shown}k`;
  }
  return `${Math.round(value / 1_000_000)}m`;
}
