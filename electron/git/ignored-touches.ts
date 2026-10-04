// Gitignored files an agent's file tools wrote. Git's status and the turn
// snapshots never see them, so an edit to `.env.local` would go unnoticed.
// Each turn keeps the loose ignored files as they were when it started; a
// file under an ignored folder (`node_modules/`, `src/generated/`) is too
// costly to keep and has no copy from before. The list sits in the checkout's
// Git folder and clears at the next commit, like the tracked changes do.
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { git } from "./git";
import { ignoreRules } from "./working-tree";
import { keyedQueue } from "../util/keyed-queue";
import { digest } from "../util/hash";
import { NotText, decodeText, readWorkingFile } from "./working-files";
import type { AgentProvider } from "../../shared/agents";
import type { FilePair } from "../../shared/types";
import type { IgnoredTouch } from "../../shared/working-tree";

/** What a turn kept at its start; reading more would slow every turn down. */
const keepFiles = 500,
  keepBytes = 8 * 1024 * 1024,
  fileBytes = 512 * 1024,
  maxTouches = 200;

export interface IgnoredStart {
  /** Loose ignored files that existed, with their text when kept. */
  files: Map<string, string | null>;
  /** Ignored folders, listed whole. */
  folders: string[];
}

interface Stored extends IgnoredTouch {
  /** The file before the agent's first write, when `before` is "kept". */
  text?: string;
}
interface Store {
  head: string;
  touches: Stored[];
}

const queue = keyedQueue();
const storePaths = new Map<string, Promise<string>>();
function storePath(root: string) {
  let path = storePaths.get(root);
  if (!path) {
    path = git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "relay/ignored-touches.json",
    ]).then((out) => out.trim());
    path.catch(() => storePaths.delete(root));
    storePaths.set(root, path);
  }
  return path;
}

const headOf = (root: string) =>
  git(root, ["rev-parse", "-q", "--verify", "HEAD"]).then(
    (out) => out.trim(),
    () => "",
  );

async function load(root: string): Promise<Store | null> {
  const raw = await readFile(await storePath(root), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const store = JSON.parse(raw) as Store;
    return Array.isArray(store.touches) ? store : null;
  } catch {
    return null;
  }
}

async function save(root: string, store: Store) {
  const file = await storePath(root);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(store));
  await rename(temp, file);
}

/** The loose ignored files as a turn starts, read before the agent can write. */
export async function keepIgnored(root: string): Promise<IgnoredStart> {
  const listed = (
    await git(root, [
      "ls-files",
      "-z",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const folders = listed.filter((p) => p.endsWith("/"));
  const files = new Map<string, string | null>();
  let budget = keepBytes;
  for (const path of listed.filter((p) => !p.endsWith("/"))) {
    files.set(path, null);
    if (files.size > keepFiles) continue;
    const info = await lstat(join(root, path)).catch(() => null);
    if (!info?.isFile() || info.size > fileBytes || info.size > budget)
      continue;
    try {
      const text = decodeText(await readFile(join(root, path)));
      budget -= info.size;
      files.set(path, text);
    } catch (e) {
      if (!(e instanceof NotText)) throw e;
    }
  }
  return { files, folders };
}

/** Paths the agent wrote, relative to `root` and in Git's form; others are dropped. */
function inside(root: string, paths: string[]) {
  const out = new Set<string>();
  for (const path of paths) {
    const rel = relative(root, resolve(root, path));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel))
      out.add(rel.split(sep).join("/"));
  }
  return [...out];
}

const sameText = async (root: string, path: string, text: string) =>
  (await readFile(join(root, path), "utf8").catch(() => null)) === text;

/** Adds the ignored files among `edited` to the checkout's list once a turn ends. */
export function recordIgnored(
  root: string,
  start: IgnoredStart | null,
  edited: string[],
  agent: AgentProvider,
) {
  const paths = inside(root, edited);
  if (!paths.length) return Promise.resolve();
  return queue(root, async () => {
    const rules = await ignoreRules(root, paths);
    // A file added despite its rule is tracked: Git shows its changes already.
    const tracked = rules.size
      ? await git(root, ["ls-files", "-z", "--", ...rules.keys()])
      : "";
    for (const path of tracked.split("\0")) rules.delete(path);
    if (!rules.size) return;
    const head = await headOf(root);
    const stored = await load(root);
    const touches = stored?.head === head ? stored.touches : [];
    for (const path of rules.keys()) {
      const earlier = touches.findIndex((t) => t.path === path);
      // The first write's copy stays the base when a later turn writes again.
      const kept = earlier >= 0 ? touches.splice(earlier, 1)[0] : null;
      const had = start?.files.get(path);
      const touch: Stored = kept
        ? { ...kept, agent }
        : !start
          ? { path, agent, before: "unknown" }
          : typeof had === "string"
            ? { path, agent, before: "kept", text: had }
            : had === null ||
                start.folders.some((folder) => path.startsWith(folder))
              ? { path, agent, before: "unknown" }
              : { path, agent, before: "none" };
      touch.rule = rules.get(path);
      // An edit the agent took back leaves nothing to show.
      if (touch.before === "kept" && (await sameText(root, path, touch.text!)))
        continue;
      touches.push(touch);
    }
    await save(root, { head, touches: touches.slice(-maxTouches) });
  });
}

/** The checkout's list, empty once HEAD moved past it; `stamp` changes with the files. */
export async function ignoredTouches(root: string, head: string) {
  const store = await load(root).catch(() => null);
  if (!store || store.head !== head || !store.touches.length)
    return { touches: [] as IgnoredTouch[], stamp: "" };
  const touches = store.touches.map(
    ({ text: _, ...touch }): IgnoredTouch => touch,
  );
  const stats = await Promise.all(
    touches.map((t) =>
      lstat(join(root, t.path)).then(
        (s) => [t.path, s.size, s.mtimeMs],
        () => [t.path, null],
      ),
    ),
  );
  return { touches, stamp: digest(JSON.stringify([touches, stats])) };
}

/** One listed file now, against how it was before the agent's first write. */
export async function ignoredDiff(
  root: string,
  path: string,
): Promise<FilePair> {
  const store = await load(root);
  const touch = store?.touches.find((t) => t.path === path);
  if (!touch || store!.head !== (await headOf(root)))
    throw new Error("Relay no longer lists this ignored file.");
  const now = await readWorkingFile(root, path).catch((e) => {
    if (e instanceof NotText) return "binary" as const;
    throw e;
  });
  if (now === "binary") return { old: null, next: null, binary: true };
  const text = touch.text;
  return {
    old:
      text === undefined
        ? null
        : { name: path, contents: text, cacheKey: digest(text) },
    next: now
      ? { name: path, contents: now.contents, cacheKey: now.hash }
      : null,
    binary: false,
  };
}

/** Takes files off the list, all of them without `paths`. */
export function dismissIgnored(root: string, paths?: string[]) {
  return queue(root, async () => {
    const store = await load(root);
    if (!store) return;
    store.touches = paths
      ? store.touches.filter((t) => !paths.includes(t.path))
      : [];
    await save(root, store);
  });
}
