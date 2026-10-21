import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  checkoutChanged,
  isStaged,
  type GitAction,
  type WorkingChange,
  type WorkingTree,
} from "../../shared/working-tree";
import { chunks } from "../util/chunks";
import { git, gitBytes } from "./git";
import {
  fetchUpstream,
  pushDestination,
  serializeRepo,
  workingTree,
} from "./working-tree";

type Kind = Exclude<GitAction["kind"], "fetch">;
interface Act<K extends Kind> {
  root: string;
  action: Extract<GitAction, { kind: K }>;
  /** The checkout as the user saw it when they asked. */
  state: WorkingTree;
  trash?: (file: string) => Promise<void>;
}

/**
 * Runs a Git action the Changes pane asked for, refusing it when the
 * checkout moved since the view it was asked from. Returns the checkout after.
 */
export async function performGitAction(
  root: string,
  action: GitAction,
  /** Moves a file to the system Trash; discarding refuses to run without it. */
  trash?: (file: string) => Promise<void>,
) {
  return serializeRepo(root, async () => {
    if (action.kind === "fetch") {
      // Background refresh of the upstream so "behind" reflects the remote,
      // every few minutes: the branch and its upstream decide whether to
      // fetch, and the whole tree is read once, after it.
      const [branch, upstream] = await Promise.all([
        git(root, ["branch", "--show-current"]),
        upstreamOf(root),
      ]);
      if (upstream) await fetchUpstream(root, branch.trim());
      return workingTree(root);
    }
    const state = await workingTree(root);
    if (action.revision !== state.revision)
      throw new Error(
        `${checkoutChanged} Review the refreshed changes and try again.`,
      );
    const run = actions[action.kind] as (act: Act<Kind>) => Promise<void>;
    await run({ root, action, state, trash });
    return workingTree(root);
  });
}

const actions: { [K in Kind]: (act: Act<K>) => Promise<void> } = {
  stage: ({ root, action, state }) =>
    addOrReset(root, state, action.paths, "stage"),
  unstage: ({ root, action, state }) => {
    // Resetting a conflicted path drops its conflict mark but keeps the markers in the file.
    if (
      action.paths.some(
        (p) => state.changes.find((c) => c.path === p)?.conflict,
      )
    )
      throw new Error(
        "This file has merge conflicts. Resolve them, then stage the result.",
      );
    return addOrReset(root, state, action.paths, "unstage");
  },
  discard,
  ignore,
  async commit({ root, action, state }) {
    onBranch(state);
    if (action.paths) {
      // Both sides of a rename, so its old path is committed as removed.
      const paths = withPreviousPaths(state.changes, action.paths, () => true);
      // Only files Git doesn't know yet need adding; `commit --only` takes
      // tracked ones as they are, deleted or renamed away included.
      const untracked = paths.filter(
        (p) => state.changes.find((c) => c.path === p)?.index === "?",
      );
      if (untracked.length) await git(root, ["add", "--", ...untracked]);
      await git(
        root,
        ["commit", "--only", "-m", action.message, "--", ...paths],
        120000,
      );
      return;
    }
    if (!state.changes.some(isStaged))
      throw new Error("Stage the changes you want to commit first.");
    await git(root, ["commit", "-m", action.message], 120000);
  },
  async pull({ root, state }) {
    onBranch(state);
    if (!state.upstream)
      throw new Error("This branch has no upstream to pull from.");
    await fetchUpstream(root, state.branch);
    // An unborn branch has nothing of its own to diverge with.
    const ahead = state.head
      ? Number(
          (
            await git(root, ["rev-list", "--count", "@{upstream}..HEAD"])
          ).trim(),
        )
      : 0;
    if (ahead > 0)
      throw new Error(
        "This branch has diverged from its upstream. Rebase or merge it yourself first.",
      );
    // Fast-forward only: never create a merge commit or rebase behind the user's back.
    await git(root, ["merge", "--ff-only", "--quiet", "@{upstream}"], 120000);
  },
  push: ({ root, state }) => {
    onBranch(state);
    return push(root, state.branch);
  },
};

/** Commits, pulls and pushes need a branch checked out with nothing half done. */
function onBranch(state: WorkingTree) {
  if (state.operation)
    throw new Error(
      "Finish the current Git operation on a branch before committing or pushing here.",
    );
  if (!state.branch)
    throw new Error(
      "This folder is on a detached HEAD. Check out a branch here before committing or pushing.",
    );
  if (state.changes.some((c) => c.conflict))
    throw new Error("Resolve and stage all merge conflicts first.");
}

async function addOrReset(
  root: string,
  state: WorkingTree,
  paths: string[],
  kind: "stage" | "unstage",
) {
  const allPaths = withPreviousPaths(
    state.changes,
    paths,
    (c) => kind === "unstage" || /[RC]/.test(c.worktree),
  );
  // Bounded chunks avoid argv limits; use literal paths even for names containing Git magic.
  for (const part of chunks(allPaths, 100))
    await git(
      root,
      kind === "stage"
        ? ["add", "--", ...part]
        : ["reset", "-q", "HEAD", "--", ...part],
    );
}

async function discard({ root, action, state, trash }: Act<"discard">) {
  if (!trash) throw new Error("Discarding needs the system Trash.");
  if (
    action.paths.some((p) => {
      const c = state.changes.find((c) => c.path === p);
      return !c || c.conflict || c.index === "?";
    })
  )
    throw new Error(
      "Only tracked files without conflicts can be discarded. Move untracked files to the Trash instead.",
    );
  const staged = action.area === "staged";
  const paths = withPreviousPaths(
    state.changes,
    action.paths,
    (c) => staged || /[RC]/.test(c.worktree),
  );
  await keepCopies(root, state.changes, action.paths, trash, staged);
  for (const part of chunks(paths, 100))
    await git(
      root,
      staged
        ? state.head
          ? [
              "restore",
              "--source=HEAD",
              "--staged",
              "--worktree",
              "--",
              ...part,
            ]
          : // Nothing to restore from yet: every staged file is new.
            ["rm", "-q", "-f", "--", ...part]
        : ["restore", "--worktree", "--", ...part],
    );
}

async function ignore({ root, action, state }: Act<"ignore">) {
  if (
    action.paths.some(
      (p) => state.changes.find((c) => c.path === p)?.index !== "?",
    )
  )
    throw new Error("Only untracked files can be ignored.");
  // A .gitignore rule is one line, so it can't name such a file.
  if (action.paths.some((p) => /[\r\n]/.test(p)))
    throw new Error("Git can’t ignore a file with a line break in its name.");
  const file =
    action.file === "gitignore"
      ? join(root, ".gitignore")
      : resolve(
          root,
          (await git(root, ["rev-parse", "--git-path", "info/exclude"])).trim(),
        );
  await mkdir(dirname(file), { recursive: true });
  const before = await readFile(file, "utf8").catch(() => "");
  await appendFile(
    file,
    (before && !before.endsWith("\n") ? "\n" : "") +
      action.paths.map(ignorePattern).join("\n") +
      "\n",
  );
}

async function push(root: string, branch: string) {
  const target = await pushDestination(root, branch);
  if (!target)
    throw new Error("Configure a Git push remote for this branch first.");
  try {
    await git(
      root,
      [
        "push",
        "--porcelain",
        // A branch fetching from one remote and pushing to another keeps tracking the first.
        ...(target.tracks ? ["--set-upstream"] : []),
        target.remote,
        `HEAD:${target.ref}`,
      ],
      120000,
    );
  } catch (e) {
    if (
      !(e instanceof Error) ||
      !/\[rejected\].*\((fetch first|non-fast-forward)\)/.test(e.message)
    )
      throw e;
    // A local status refresh can't discover remote commits. Fetch before
    // reporting the failure so callers' refreshes offer Pull or Rebase.
    try {
      await git(root, ["fetch", "--prune", "--quiet", target.remote], 60000);
    } catch {
      // Keep the push failure if the remote also refuses the refresh.
      throw e;
    }
    const fresh = await workingTree(root);
    if (fresh.upstream !== target.label || !fresh.behind) throw e;
    throw new Error(
      `Remote has new commits. ${fresh.ahead ? "Rebase onto" : "Pull from"} ${target.label}, then push again.`,
    );
  }
}

/** The branch HEAD tracks, as `origin/main`; null when it tracks none. */
const upstreamOf = (root: string) =>
  git(root, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]).then(
    (out) => out.trim() || null,
    () => null,
  );

function withPreviousPaths(
  changes: WorkingChange[],
  paths: string[],
  includePrevious: (c: WorkingChange) => boolean,
) {
  return [
    ...new Set(
      paths.flatMap((path) => {
        const c = changes.find((c) => c.path === path);
        if (!c)
          throw new Error("That file is no longer changed. Refresh first.");
        return c.previousPath && includePrevious(c)
          ? [path, c.previousPath]
          : [path];
      }),
    ),
  ];
}
/**
 * Hands a copy of each file on disk to `trash`, so a discard can be undone;
 * discarding staged changes also hands over a staged version that differs
 * from the one on disk, as "name (staged).ext".
 */
async function keepCopies(
  root: string,
  changes: WorkingChange[],
  paths: string[],
  trash: (file: string) => Promise<void>,
  staged: boolean,
) {
  const keep = async (name: string, write: (copy: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "relay-discard-"));
    try {
      const copy = join(dir, name);
      await write(copy);
      await trash(copy);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  for (const path of paths) {
    const source = join(root, path);
    const stat = await lstat(source).catch(() => null);
    if (stat?.isFile())
      await keep(basename(path), (copy) => copyFile(source, copy));
    const change = changes.find((c) => c.path === path);
    if (!staged || !change || !/[MARCT]/.test(change.index)) continue;
    if (change.worktree === " ") continue;
    const size = Number(
      await git(root, ["cat-file", "-s", `:0:${path}`]).catch(() => NaN),
    );
    if (!Number.isFinite(size)) continue;
    const blob = await gitBytes(root, ["cat-file", "blob", `:0:${path}`], size);
    const ext = extname(path);
    await keep(`${basename(path, ext)} (staged)${ext}`, (copy) =>
      writeFile(copy, blob),
    );
  }
}
/** A pattern matching just this path from the repository root. */
function ignorePattern(path: string) {
  return "/" + path.replace(/[\\*?[]/g, "\\$&").replace(/ $/, "\\ ");
}
