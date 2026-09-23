import type { TurnFileChange } from "../../shared/projects";

// Adapted from T3 Code's turnDiffTree: changed files as a folder tree, each
// folder carrying its files' totals, single-child folder chains merged.
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
type TurnTreeDirectory = Extract<TurnTreeNode, { kind: "directory" }>;

type Folder = {
  name: string;
  path: string;
  stat: DiffStat;
  folders: Map<string, Folder>;
  files: TurnTreeNode[];
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

export function sumStats(files: readonly TurnFileChange[]): DiffStat {
  return files.reduce(
    (sum, f) => ({
      additions: sum.additions + f.additions,
      deletions: sum.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function toNodes(folder: Folder): TurnTreeNode[] {
  const folders = [...folder.folders.values()].sort(byName).map((child) => {
    let node: TurnTreeDirectory = {
      kind: "directory",
      name: child.name,
      path: child.path,
      stat: child.stat,
      children: toNodes(child),
    };
    // `src` holding only `components` reads as one `src/components` row.
    for (
      let only = node.children[0];
      node.children.length === 1 && only?.kind === "directory";
      only = node.children[0]
    )
      node = { ...only, name: `${node.name}/${only.name}` };
    return node;
  });
  return [...folders, ...[...folder.files].sort(byName)];
}

export function buildTurnTree(
  files: readonly TurnFileChange[],
): TurnTreeNode[] {
  const root: Folder = {
    name: "",
    path: "",
    stat: { additions: 0, deletions: 0 },
    folders: new Map(),
    files: [],
  };
  for (const change of files) {
    const segments = change.path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    let folder = root;
    const ancestors = [root];
    for (const segment of segments) {
      let next = folder.folders.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: folder.path ? `${folder.path}/${segment}` : segment,
          stat: { additions: 0, deletions: 0 },
          folders: new Map(),
          files: [],
        };
        folder.folders.set(segment, next);
      }
      folder = next;
      ancestors.push(folder);
    }
    folder.files.push({ kind: "file", name, path: change.path, change });
    for (const a of ancestors) {
      a.stat.additions += change.additions;
      a.stat.deletions += change.deletions;
    }
  }
  return toNodes(root);
}

/** 1234 → 1.2k, like T3's compact diff counts. */
export function compactCount(value: number) {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return value < 1_000_000
    ? `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`
    : `${Math.round(value / 1_000_000)}m`;
}
