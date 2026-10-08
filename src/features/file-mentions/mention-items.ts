import {
  changeKind,
  type ChangeKind,
  type WorkingChange,
} from "../../../shared/working-tree";
import { rankPaths } from "./file-match";

/** `@` and what follows it up to the caret, when that is a mention being typed. */
export function mentionTrigger(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  // After a space or an opening bracket or quote, so `me@host` stays text.
  const match = /(^|[\s([{"'])@([^\s@`]*)$/.exec(before);
  if (!match) return null;
  const start = match.index + match[1].length;
  return { query: match[2], start, end: cursor };
}

/** A file, or a folder ending in `/`, offered for a mention. */
export interface MentionItem {
  path: string;
  dir: boolean;
  /** Which characters of `path` the query matched. */
  positions: number[];
  change?: ChangeKind;
  /** Files under a folder; uncommitted ones among them. */
  count?: { files: number; changed: number };
  /** Starts a group with this heading. */
  section?: string;
}

interface Entry {
  files: number;
  changed: number;
}
/** Each folder's direct entries, `""` being the root; folders end in `/`. */
export type FileTree = Map<string, Map<string, Entry>>;

export function fileTree(files: string[], changed: Set<string>): FileTree {
  const tree: FileTree = new Map([["", new Map()]]);
  for (const file of files) {
    let dir = "";
    for (let at = 0; ;) {
      const slash = file.indexOf("/", at);
      const name = slash < 0 ? file.slice(at) : file.slice(at, slash + 1);
      const level = tree.get(dir)!;
      const entry = level.get(name) ?? { files: 0, changed: 0 };
      entry.files++;
      if (changed.has(file)) entry.changed++;
      level.set(name, entry);
      if (slash < 0) break;
      dir += name;
      if (!tree.has(dir)) tree.set(dir, new Map());
      at = slash + 1;
    }
  }
  return tree;
}

export const changesByPath = (changes: WorkingChange[] = []) =>
  new Map(
    changes.map((c) => [
      c.path,
      changeKind(c.worktree !== " " ? c.worktree : c.index, c.conflict),
    ]),
  );

const byFolderThenName = (a: MentionItem, b: MentionItem) =>
  Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path);

/** One folder's entries as items, folders first. */
function level(tree: FileTree, dir: string, changes: Map<string, ChangeKind>) {
  return [...(tree.get(dir) ?? [])]
    .map(([name, entry]): MentionItem => {
      const path = dir + name;
      const isDir = name.endsWith("/");
      return {
        path,
        dir: isDir,
        positions: [],
        change: isDir ? undefined : changes.get(path),
        count: isDir ? entry : undefined,
      };
    })
    .sort(byFolderThenName);
}

const withSection = (items: MentionItem[], section: string) =>
  items.map((item, i) => (i ? item : { ...item, section }));

/**
 * With nothing typed, what is uncommitted and then the top folder; with a
 * folder's path, that folder; otherwise every file and folder ranked against
 * the query.
 */
export function listItems(
  query: string,
  files: string[],
  folders: string[],
  tree: FileTree,
  changes: Map<string, ChangeKind>,
  limit = 50,
): MentionItem[] {
  if (!query) {
    const changed = [...changes]
      .filter(([, kind]) => kind !== "deleted")
      .slice(0, 8)
      .map(([path, change]): MentionItem => ({
        path,
        dir: false,
        positions: [],
        change,
      }));
    return [
      ...withSection(changed, "Uncommitted"),
      ...withSection(level(tree, "", changes), "Project"),
    ].slice(0, limit);
  }
  if (query.endsWith("/") && tree.has(query))
    return level(tree, query, changes).slice(0, limit);
  return rankPaths([...files, ...folders], query, limit).map((m) => {
    const dir = m.path.endsWith("/");
    return {
      path: m.path,
      dir,
      positions: m.positions,
      change: dir ? undefined : changes.get(m.path),
      count: dir ? tree.get(m.path) && countUnder(tree, m.path) : undefined,
    };
  });
}

function countUnder(tree: FileTree, dir: string) {
  const slash = dir.lastIndexOf("/", dir.length - 2) + 1;
  return tree.get(dir.slice(0, slash))?.get(dir.slice(slash));
}
