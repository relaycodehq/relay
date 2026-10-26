// The change as a folder tree, for moving folders between passes. The
// passes are edited as the files each holds, then written back as the
// biggest folders wholly in each, so a moved folder takes its files out of
// whichever pass named a folder above it.
import {
  covers,
  readLines,
  type ChangedFile,
  type ReviewPass,
} from "../../../../shared/review-passes";

export interface Folder {
  /** Ends in `/`; "" for the top of the change. */
  path: string;
  name: string;
  lines: number;
  files: { path: string; lines: number }[];
  folders: Folder[];
}

/** Each pass's files, in pass order; a pass emptied by a move stays, empty. */
export type PassFiles = string[][];

const folder = (path: string, name: string): Folder => ({
  path,
  name,
  lines: 0,
  files: [],
  folders: [],
});

/** The folders the reviewers read, sorted by path; lockfiles and fixtures aren't in it. */
export function changeTree(files: readonly ChangedFile[]): Folder {
  const top = folder("", "");
  for (const file of files) {
    const lines = readLines(file);
    if (!lines) continue;
    let node = top;
    node.lines += lines;
    for (const name of file.path.split("/").slice(0, -1)) {
      let next = node.folders.find((f) => f.name === name);
      if (!next) {
        next = folder(`${node.path}${name}/`, name);
        node.folders.push(next);
      }
      next.lines += lines;
      node = next;
    }
    node.files.push({ path: file.path, lines });
  }
  sortTree(top);
  return top;
}

function sortTree(node: Folder) {
  node.folders.sort((a, b) => (a.path < b.path ? -1 : 1));
  node.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  node.folders.forEach(sortTree);
}

export function filesUnder(node: Folder): string[] {
  return [
    ...node.files.map((f) => f.path),
    ...node.folders.flatMap(filesUnder),
  ];
}

/** Which files each pass reviews; an empty pass holds none. */
export function filesByPass(
  passes: ReviewPass[],
  top: Folder,
): PassFiles {
  const all = filesUnder(top);
  return passes.map((pass, i) =>
    pass.length ? all.filter((path) => covers(passes, i, path)) : [],
  );
}

/** Each pass as the biggest folders, or files, wholly in it. */
export function passesFrom(byPass: PassFiles, top: Folder): ReviewPass[] {
  const passOf = new Map<string, number>();
  byPass.forEach((files, i) => files.forEach((path) => passOf.set(path, i)));
  const passes: ReviewPass[] = byPass.map(() => []);
  const onlyPass = (node: Folder) => {
    const seen = new Set(filesUnder(node).map((path) => passOf.get(path)));
    return seen.size === 1 ? [...seen][0] : undefined;
  };
  const walk = (node: Folder) => {
    const whole = node.path ? onlyPass(node) : undefined;
    if (whole !== undefined) return void passes[whole]!.push(node.path);
    for (const file of node.files) {
      const pass = passOf.get(file.path);
      if (pass !== undefined) passes[pass]!.push(file.path);
    }
    node.folders.forEach(walk);
  };
  walk(top);
  return passes;
}

/** Moves files into pass `to`, or into a new last pass. */
export function moveToPass(
  byPass: PassFiles,
  files: string[],
  to: number | "new",
): PassFiles {
  const moving = new Set(files);
  const next = byPass.map((pass) => pass.filter((path) => !moving.has(path)));
  if (to === "new") next.push(files);
  else next[to] = [...next[to]!, ...files];
  return next;
}

/** How a row's files sit in each pass: all of them, some, or none. */
export type Share = "all" | "some" | "none";

export function sharesOf(files: string[], byPass: PassFiles): Share[] {
  const mine = new Set(files);
  return byPass.map((pass) => {
    const held = pass.filter((path) => mine.has(path)).length;
    if (!held) return "none";
    return held === files.length ? "all" : "some";
  });
}

export interface TreeRow {
  /** The folder's or file's path, unique in the tree. */
  path: string;
  depth: number;
  /** A folder with nothing but one folder in it shares a row with it: "app/src/". */
  label: string;
  lines: number;
  files: string[];
  folder?: Folder;
  open: boolean;
}

/** A folder holding nothing but one folder, down to the folder that holds more. */
function throughOnlyChildren(node: Folder) {
  const names = [node.name];
  while (!node.files.length && node.folders.length === 1) {
    node = node.folders[0]!;
    names.push(node.name);
  }
  const label =
    names.length > 4
      ? `${names[0]}/…/${names.slice(-2).join("/")}/`
      : `${names.join("/")}/`;
  return { node, label };
}

/**
 * The rows the tree shows: folders first, then files, under each open
 * folder. A folder split across passes is open until it's closed, so where
 * it's cut shows.
 */
export function treeRows(
  top: Folder,
  byPass: PassFiles,
  opened: Record<string, boolean>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parent: Folder, depth: number) => {
    for (const child of parent.folders) {
      const { node, label } = throughOnlyChildren(child);
      const files = filesUnder(node);
      const split = sharesOf(files, byPass).some((s) => s === "some");
      const open = opened[node.path] ?? split;
      rows.push({ path: node.path, depth, label, lines: node.lines, files, folder: node, open });
      if (open) walk(node, depth + 1);
    }
    for (const file of parent.files)
      rows.push({
        path: file.path,
        depth,
        label: file.path.split("/").at(-1)!,
        lines: file.lines,
        files: [file.path],
        open: false,
      });
  };
  walk(top, 0);
  return rows;
}

/** The passes a review runs: the empty ones dropped, none when one holds everything. */
export function runnablePasses(passes: ReviewPass[]): ReviewPass[] {
  const held = passes.filter((pass) => pass.length);
  return held.length > 1 ? held : [];
}
