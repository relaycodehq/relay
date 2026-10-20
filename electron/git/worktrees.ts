import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { currentBranch, git as gitIn, worktreeList } from "./git";
import { copyIncluded } from "./worktree-include";
import {
  apply,
  commitTree,
  parseNumstat,
  plan,
  revisionDiff,
  snapshotTree,
} from "./turn-changes";
import { branchNameProblem } from "../../shared/branch-names";
import { remoteOfBranch } from "../../shared/branches";
import type {
  ChatWorktree,
  TurnFileChange,
  WorktreeStart,
} from "../../shared/projects";

// A thread's worktree lives outside the project, under Relay's data folder, on
// a branch of its own made from the checkout's commit: `relay/…` after the
// thread, or the name the user gave it. It's an ordinary branch: commit, push
// and merge it like any other. Its changes are what it has that the branch it
// came from doesn't.

/** Worktree operations walk a whole checkout, so they get twice Git's usual time. */
const git = (root: string, args: string[], timeout = 30000) =>
  gitIn(root, args, timeout);
export type MadeWorktree = Required<
  Pick<ChatWorktree, "path" | "branch" | "head" | "start" | "base" | "setup">
> &
  Pick<
    ChatWorktree,
    | "from"
    | "named"
    | "wanted"
    | "included"
    | "existing"
    | "adopted"
    | "startedOff"
  >;

/** What a worktree held when it was removed, in case it's wanted back. */
const keptRef = (chatId: string) => `refs/relay/worktrees/${chatId}/kept`;
/** The checkout's edits as they moved into a thread's worktree. */
const movedRef = (chatId: string) => `refs/relay/worktrees/${chatId}/moved`;
/** What was copied into a thread's worktree when it started: where its own changes begin. */
export const copiedRef = (chatId: string) =>
  `refs/relay/worktrees/${chatId}/copied`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "thread";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const hasBranch = (root: string, branch: string) =>
  git(root, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );

/**
 * A folder name in `dir` that's free, and whose `relay/…` branch is too,
 * unless that's `own`: a thread cleaned up with its branch kept takes its
 * folder back when it carries on.
 */
async function freeName(root: string, dir: string, name: string, own?: string) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    const relay = `relay/${candidate}`;
    if (
      (relay === own || !(await hasBranch(root, relay))) &&
      !(await exists(join(dir, candidate)))
    )
      return candidate;
  }
}

async function freeFolder(dir: string, name: string) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`;
    if (!(await exists(join(dir, candidate)))) return candidate;
  }
}

/**
 * Moves a worktree the first message just made, before anything runs in it,
 * from the folder and `relay/…` branch named after the message to ones named
 * after the thread's `title`. Resolves to where it went; undefined when it
 * stays, already named after it or on a branch the user named.
 */
export async function retitleWorktree(
  root: string,
  worktree: ChatWorktree,
  title: string,
) {
  const { path, branch } = worktree;
  if (!path || worktree.named || branch !== `relay/${basename(path)}`) return;
  const name = slug(title);
  for (let n = 1; ; n++) {
    const leaf = n === 1 ? name : `${name}-${n}`;
    if (leaf === basename(path)) return;
    const to = join(dirname(path), leaf);
    if ((await hasBranch(root, `relay/${leaf}`)) || (await exists(to)))
      continue;
    await git(root, ["worktree", "move", path, to]);
    try {
      await git(root, ["branch", "-m", branch, `relay/${leaf}`]);
    } catch (error) {
      await git(root, ["worktree", "move", to, path]).catch(() => {});
      throw error;
    }
    return { path: to, branch: `relay/${leaf}` };
  }
}

/**
 * Why `branch` can't be made for a new worktree, if it can't: git wouldn't
 * take the name, or it, a branch above it or one below it already exists.
 */
export async function newBranchProblem(root: string, branch: string) {
  const format = branchNameProblem(branch);
  if (format) return format;
  if (
    await git(root, ["check-ref-format", `refs/heads/${branch}`]).then(
      () => false,
      () => true,
    )
  )
    return "Git doesn't take that as a branch name.";
  if (await hasBranch(root, branch)) return `${branch} already exists.`;
  const parts = branch.split("/");
  for (let i = 1; i < parts.length; i++) {
    const above = parts.slice(0, i).join("/");
    if (await hasBranch(root, above))
      return `There's a branch called ${above}, so ${branch} can't be made.`;
  }
  const below = (
    await git(root, [
      "for-each-ref",
      "--count=1",
      "--format=%(refname:short)",
      `refs/heads/${branch}/`,
    ])
  ).trim();
  if (below)
    return `There's a branch called ${below}, so ${branch} can't be made.`;
}

/** A branch Relay made for a thread: named after it, or by the user for it. */
const relayBranch = (worktree: ChatWorktree) =>
  !!worktree.path &&
  !!worktree.branch &&
  (worktree.branch === `relay/${basename(worktree.path)}` ||
    worktree.branch === worktree.named);

/** Where the worktree goes and on which branch: the one the user named, or `relay/…` after `name`. */
async function placeFor(
  root: string,
  folder: string,
  name: string,
  previous?: ChatWorktree,
) {
  const named = previous?.named;
  let wanted: ChatWorktree["wanted"];
  if (named) {
    const problem = await newBranchProblem(root, named);
    if (!problem) {
      const leaf = previous.path
        ? basename(previous.path)
        : slug(named.replace(/^relay\//, ""));
      return { leaf: await freeName(root, folder, leaf, named), branch: named };
    }
    // Taken since it was typed; the thread says so rather than not starting.
    if (!previous.path) wanted = { branch: named, problem };
  }
  const leaf =
    previous && relayBranch(previous) && previous.branch !== named
      ? await freeName(root, folder, basename(previous.path!))
      : await freeName(root, folder, slug(name));
  return { leaf, branch: `relay/${leaf}`, ...(wanted ? { wanted } : {}) };
}

/**
 * Makes a worktree on a new branch from the checkout's commit: the one the
 * user named for the thread, or `relay/…` after `name`, also when that one
 * can't be made by now, which `wanted` records. Uncommitted edits stay in the
 * checkout. What the checkout's `.worktreeinclude` names is copied in, and
 * `node_modules` is linked from the checkout when Git ignores it there, so the
 * project runs without installing. A thread making its worktree again takes
 * its old folder back when it's free, so the agent's session finds the same
 * working directory. A `startFrom` picked for the thread makes the branch off
 * another one instead, or carries on an existing branch: in the folder it's
 * checked out in already, else in a worktree of its own, else, when only
 * checking it out is in the way, on a new branch off it.
 */
export async function createWorktree(
  root: string,
  dir: string,
  name: string,
  previous?: ChatWorktree,
  signal?: AbortSignal,
): Promise<MadeWorktree> {
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  // A folder deleted by hand leaves Git's record of it behind.
  await git(root, ["worktree", "prune"]).catch(() => {});
  const start = previous?.startFrom;
  // A start gone since it was picked doesn't stop the thread: it goes off
  // the checkout's commit instead, and says so, like a name taken meanwhile.
  let fell: ChatWorktree["wanted"];
  const startFailed = (branch: string, off?: true) => (error: unknown) => {
    const problem = error instanceof Error ? error.message : String(error);
    fell = { branch, problem, ...(off ? { off } : {}) };
    return undefined;
  };
  let offFrom = start && "off" in start ? start.off : undefined;
  let fetched = false;
  if (start && "on" in start) {
    let place = await carryOnPlace(root, start.on, { signal }).catch(
      startFailed(start.on),
    );
    if (place && "carry" in place) {
      const carried = await carryOn(root, folder, start.on, place.carry).catch(
        startFailed(start.on),
      );
      if (carried) return carried;
      // Checked out elsewhere meanwhile, say: where it is now decides.
      place = await carryOnPlace(root, start.on).catch(() => undefined);
      if (place && "carry" in place) place = undefined;
    }
    if (place && "at" in place)
      return foundWorktree(root, place.at, place.branch);
    if (place && "off" in place) {
      offFrom = place.off;
      fetched = true;
      fell = { branch: start.on, problem: place.problem };
    }
    if (place && "missing" in place)
      fell = {
        branch: start.on,
        problem: `There's no branch ${start.on} anymore.`,
      };
  }
  const off =
    offFrom !== undefined &&
    (await branchOff(root, offFrom, fetched ? undefined : { signal }).catch(
      start && "off" in start
        ? startFailed(start.off, true)
        : startFailed(offFrom),
    ));
  const head = off ? off.sha : await checkoutHead(root);
  const from = off ? off.from : await currentBranch(root);
  const add = async () => {
    const place = await placeFor(root, folder, name, previous);
    const path = join(folder, place.leaf);
    await git(
      root,
      ["worktree", "add", "-q", "-b", place.branch, path, head],
      120000,
    );
    return { ...place, path };
  };
  // Two threads sent close together can both pass the name check; the
  // second then falls back the way a name taken earlier does.
  const made = await add().catch((error: unknown) => {
    if (!previous?.named) throw error;
    return add();
  });
  const { path, branch } = made;
  // Both can go: the note owes the user their own name's fate too.
  const wanted =
    fell && made.wanted
      ? {
          ...fell,
          problem: `${fell.problem} And not on ${made.wanted.branch}: ${made.wanted.problem}`,
        }
      : (fell ?? made.wanted);

  return {
    path,
    branch,
    head,
    start: head,
    base: head,
    ...(from ? { from } : {}),
    ...(off ? { startedOff: offFrom } : {}),
    ...(branch === previous?.named ? { named: branch } : {}),
    ...(wanted ? { wanted } : {}),
    ...(await bootstrap(root, root, path)),
  };
}

const commitOf = (root: string, ref: string) =>
  git(root, ["rev-parse", "-q", "--verify", `${ref}^{commit}`]).then(
    (s) => s.trim(),
    () => undefined,
  );

/**
 * The remote a branch listed as `origin/…` is on, when it's a remote one,
 * and the branch's name there, which a local one tracking it takes.
 */
async function remoteOf(root: string, name: string) {
  if (await hasBranch(root, name)) return undefined;
  const remotes = (await git(root, ["remote"])).split("\n").filter(Boolean);
  const remote = remoteOfBranch(name, remotes);
  return remote && { remote, branch: name.slice(remote.length + 1) };
}

/**
 * Brings a remote's branch up to date, as far as the network lets it; what's
 * there already serves otherwise, also once `signal` stops the wait.
 */
async function fetchBranch(
  root: string,
  { remote, branch }: { remote: string; branch: string },
  signal?: AbortSignal,
) {
  // The full ref, so the name is never an option or a refspec of its own.
  await gitIn(
    root,
    ["fetch", "-q", "--no-tags", "--", remote, `refs/heads/${branch}`],
    { timeout: 60000, signal },
  ).catch((error: unknown) => {
    if (signal?.aborted) return;
    console.warn(`[worktrees] could not fetch ${remote}/${branch}:`, error);
  });
}

/** The folder `branch` is checked out in, if any; Git allows it in one only. */
const checkedOutAt = async (root: string, branch: string) =>
  (await worktreeList(root)).find((w) => w.branch === branch && !w.prunable)
    ?.path;

/** Why the local branch a thread's worktree is on can't be opened in it again. */
export async function carryOnProblem(root: string, branch: string) {
  if (!(await hasBranch(root, branch))) return `There's no branch ${branch}.`;
  const at = await checkedOutAt(root, branch);
  return at ? `${branch} is checked out in ${at} already.` : undefined;
}

/** Whether local `branch` has everything commit `sha` has. */
const caughtUp = async (root: string, sha: string, branch: string) =>
  (await hasBranch(root, branch)) &&
  (await git(root, [
    "merge-base",
    "--is-ancestor",
    sha,
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false,
  ));

/** Where `path` really is, so two spellings of one folder compare equal. */
const real = (path: string) => realpath(path).catch(() => resolve(path));

/**
 * What a picked start `name` is: its commit, a remote one fetched first when
 * `fetch` asks, and the local branch a worktree on it works on, whether that
 * exists and, for a remote one, has everything the remote one has.
 */
async function resolveStart(
  root: string,
  name: string,
  fetch?: { signal?: AbortSignal },
) {
  const remote = await remoteOf(root, name);
  if (remote && fetch) await fetchBranch(root, remote, fetch.signal);
  const sha = await commitOf(
    root,
    remote ? `refs/remotes/${name}` : `refs/heads/${name}`,
  );
  const branch = remote ? remote.branch : name;
  const local = remote ? await hasBranch(root, branch) : !!sha;
  const caught =
    !!remote && local && !!sha && (await caughtUp(root, sha, branch));
  return { sha, branch, remote, local, caught };
}

type Resolved = Awaited<ReturnType<typeof resolveStart>>;
/**
 * Where carrying on `name` takes a thread: the folder its branch is checked
 * out in already, a worktree of its own on it (a remote one's on a local
 * branch tracking it), or a new branch off it, and why, when the project
 * folder has it checked out, its local twin is behind, or a local branch of
 * its name can't be made. Only a branch that's nowhere is `missing`. A
 * remote one is fetched first when `fetch` asks.
 */
async function carryOnPlace(
  root: string,
  name: string,
  fetch?: { signal?: AbortSignal },
): Promise<
  | { carry: Resolved }
  | { at: string; branch: string }
  | { off: string; problem: string }
  | { missing: true }
> {
  const resolved = await resolveStart(root, name, fetch);
  const { sha, branch, remote, local, caught } = resolved;
  if (!local && !sha) return { missing: true };
  const instead = `so the thread is on a new branch off ${name}.`;
  // The remote one was picked; a local twin missing some of it isn't that.
  if (remote && local && sha && !caught)
    return { off: name, problem: `${branch} here is behind it, ${instead}` };
  if (!local) {
    const clash = await newBranchProblem(root, branch);
    return clash
      ? { off: name, problem: `${clash.replace(/\.$/, "")}, ${instead}` }
      : { carry: resolved };
  }
  const at = await checkedOutAt(root, branch);
  if (!at) return { carry: resolved };
  const checkout = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  // Git checks a branch out in one folder only, and the project's is taken.
  if ((await real(at)) === (await real(checkout)))
    return {
      off: branch,
      problem: `The project folder has it checked out, ${instead}`,
    };
  return { at, branch };
}

/**
 * Why a new thread's worktree can't start where it was picked to, if it
 * can't: only a branch that's neither here nor on a remote. One that's
 * checked out already, or kept for another thread, is still carried on.
 */
export async function worktreeStartProblem(root: string, start: WorktreeStart) {
  // Joining another thread's worktree makes nothing new; the thread checks it.
  if ("thread" in start) return undefined;
  if ("off" in start)
    return (await resolveStart(root, start.off)).sha
      ? undefined
      : `There's no branch ${start.off}.`;
  return "missing" in (await carryOnPlace(root, start.on))
    ? `There's no branch ${start.on}.`
    : undefined;
}

/**
 * The commit a new branch off `name` starts at, a remote branch fetched
 * first when `fetch` asks, and the local branch its changes count against
 * when there is one.
 */
async function branchOff(
  root: string,
  name: string,
  fetch?: { signal?: AbortSignal },
) {
  const { sha, branch, remote, caught } = await resolveStart(root, name, fetch);
  if (!sha) throw new Error(`There's no branch ${name} to start from anymore.`);
  if (!remote) return { sha, from: name };
  // A local branch behind the remote one would count its new commits as the thread's.
  return { sha, from: caught ? branch : undefined };
}

/** Branch `branch`'s commit, and where it forks off the checkout's branch, which its changes count from. */
async function forkOff(root: string, branch: string) {
  const tip = (await commitOf(root, `refs/heads/${branch}`))!;
  const from = await currentBranch(root);
  const fork =
    (from &&
      (await git(root, ["merge-base", `refs/heads/${from}`, tip]).then(
        (s) => s.trim(),
        () => undefined,
      ))) ||
    tip;
  return { tip, fork, from };
}

/**
 * The folder `branch` is checked out in already, which Relay didn't make,
 * for a thread to carry the branch on in as it is.
 */
async function foundWorktree(
  root: string,
  path: string,
  branch: string,
): Promise<MadeWorktree> {
  const { tip, fork, from } = await forkOff(root, branch);
  return {
    path,
    branch,
    head: tip,
    start: fork,
    base: fork,
    ...(from ? { from } : {}),
    named: branch,
    existing: true,
    adopted: true,
    // Whoever made the folder set it up; Relay leaves it as it is.
    setup: "done",
  };
}

/**
 * A worktree on existing branch `name`, or on a local branch tracking it
 * when `name` is a remote one, for the thread to carry it on. Its changes
 * count from where it forks off the checkout's branch.
 */
async function carryOn(
  root: string,
  folder: string,
  name: string,
  { sha, branch, local }: Resolved,
): Promise<MadeWorktree> {
  const leaf = await freeName(
    root,
    folder,
    slug(branch.replace(/^relay\//, "")),
    branch,
  );
  const path = join(folder, leaf);
  // A branch made here goes again with a worktree that didn't come of it.
  // The folder goes only when this call made it: one there before the add
  // is another thread's that got to the name first.
  const before = await exists(path);
  const unmake = async () => {
    if (!before)
      await git(root, ["worktree", "remove", "--force", path]).catch(() => {});
    if (local) return;
    await git(root, ["worktree", "prune"]).catch(() => {});
    // At the remote's commit it holds nothing of anyone's, made here or not.
    if ((await commitOf(root, `refs/heads/${branch}`)) === sha)
      await git(root, ["branch", "-D", branch]).catch(() => {});
  };
  try {
    await git(
      root,
      local
        ? ["worktree", "add", "-q", path, branch]
        : ["worktree", "add", "-q", "--track", "-b", branch, path, name],
      120000,
    );
  } catch (error) {
    await unmake();
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't open ${branch} in a worktree: ${why}`);
  }
  // A half-made worktree would hold the branch and fail every retry.
  const ready = await bootstrap(root, root, path).catch(async (error) => {
    await unmake();
    throw error;
  });
  const { tip, fork, from } = await forkOff(root, branch);
  return {
    path,
    branch,
    head: tip,
    start: fork,
    base: fork,
    ...(from ? { from } : {}),
    named: branch,
    existing: true,
    ...ready,
  };
}

/** The checkout's uncommitted edits, untracked files included, against its commit. */
export async function uncommitted(root: string) {
  const head = (
    await git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).catch(
      () => {
        throw new Error("Make a first commit before working in a worktree.");
      },
    )
  ).trim();
  const snapshot = await snapshotTree(root);
  const raw = await git(root, [
    "diff",
    "--raw",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    head,
    snapshot,
  ]);
  // A nested repository or submodule is a commit id, not file contents, so
  // it stays in the checkout instead of moving.
  const nested: { path: string; mode: string; sha: string }[] = [];
  const entries = raw.split("\0");
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const [before, after, sha] = entries[i].slice(1).split(" ");
    if (before === "160000" || after === "160000")
      nested.push({ path: entries[i + 1], mode: before, sha });
  }
  const tree = nested.length
    ? await withoutNested(root, snapshot, nested)
    : snapshot;
  const numstat = await git(root, [
    "diff",
    "--numstat",
    "-z",
    "--no-textconv",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    head,
    tree,
  ]);
  return { head, tree, files: parseNumstat(numstat) };
}

/** `tree` with each nested path put back as `head` had it, or gone if it had none. */
async function withoutNested(
  root: string,
  tree: string,
  nested: { path: string; mode: string; sha: string }[],
) {
  const scratch = await mkdtemp(join(tmpdir(), "relay-nested-"));
  const env = { GIT_INDEX_FILE: join(scratch, "index") };
  try {
    await gitIn(root, ["read-tree", tree], { env });
    for (const { path, mode, sha } of nested)
      await gitIn(
        root,
        mode === "000000"
          ? ["update-index", "--force-remove", "--", path]
          : ["update-index", "--add", "--cacheinfo", `${mode},${sha},${path}`],
        { env },
      );
    return (await gitIn(root, ["write-tree"], { env })).trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Moves every uncommitted edit in the checkout into a new worktree, as
 * uncommitted edits there, and puts the checkout's files back to its commit.
 * What moved is kept under a ref first. Anything edited while moving stays in
 * the checkout where it merges; when it doesn't, nothing in the checkout changes.
 */
export async function moveIntoWorktree(
  root: string,
  dir: string,
  name: string,
  chatId: string,
): Promise<MadeWorktree> {
  const { head, tree, files } = await uncommitted(root);
  const made = await createWorktree(root, dir, name);
  const paths = files.map((f) => f.path);
  let steps: Awaited<ReturnType<typeof plan>>["steps"] = [];
  try {
    if (made.head !== head)
      throw new Error(
        "The project folder got a new commit while moving. Try again.",
      );
    if (paths.length) {
      // The fresh worktree's files become the snapshot's, unstaged like they were.
      await git(made.path, ["read-tree", "-u", "--reset", tree], 120000);
      await git(made.path, ["reset", "-q"]);
      await git(root, [
        "update-ref",
        movedRef(chatId),
        await commitTree(
          root,
          tree,
          head,
          "Relay: the project folder's edits as they moved into a worktree",
        ),
      ]);
      const planned = await plan(root, paths, tree, head, false);
      if (planned.conflicts.length)
        throw new Error(
          `${planned.conflicts.slice(0, 3).join(", ")}${planned.conflicts.length > 3 ? ` and ${planned.conflicts.length - 3} more` : ""} changed while moving. Try again.`,
        );
      steps = planned.steps;
    }
  } catch (e) {
    await git(root, ["worktree", "remove", "--force", made.path])
      .catch(() => rm(made.path, { recursive: true, force: true }))
      .then(() => git(root, ["branch", "-D", made.branch]))
      .catch(() => {});
    throw e;
  }
  // From here the worktree holds the edits, so it stays even if this fails.
  await apply(root, head, steps);
  // A staged edit would otherwise linger in the checkout's index.
  for (let i = 0; i < paths.length; i += 500)
    await git(root, ["reset", "-q", "--", ...paths.slice(i, i + 500)]);
  return made;
}

/**
 * A new worktree at `source`'s commit, its changes counted from `source`'s
 * branch, holding a copy of the edits `source` hasn't committed, unstaged like
 * they were there. `source` is a checkout or worktree; it stays as it was.
 * Of the ignored files, only what `source`'s `.worktreeinclude` names comes
 * along, and nested repositories don't. The copy is kept
 * under `copiedRef(chatId)`, so its work can be told apart from the copy's.
 */
export async function copyIntoWorktree(
  root: string,
  dir: string,
  name: string,
  source: string,
  chatId: string,
  branch?: string,
): Promise<{ worktree: MadeWorktree; copied: number }> {
  const { head, tree, files } = await uncommitted(source);
  const from =
    (await git(source, ["branch", "--show-current"])).trim() || undefined;
  const worktree = await adoptWorktree(root, dir, name, head, {
    from,
    start: head,
    includeFrom: source,
    ...(branch ? { branch } : {}),
  });
  if (files.length)
    try {
      await git(worktree.path, ["read-tree", "-u", "--reset", tree], 120000);
      await git(worktree.path, ["reset", "-q"]);
      await git(root, [
        "update-ref",
        copiedRef(chatId),
        await commitTree(
          root,
          tree,
          head,
          "Relay: the edits a thread's worktree began with",
        ),
      ]);
    } catch (e) {
      await git(root, ["worktree", "remove", "--force", worktree.path])
        .catch(() => rm(worktree.path, { recursive: true, force: true }))
        .then(() => git(root, ["branch", "-D", worktree.branch]))
        .catch(() => {});
      throw e;
    }
  return { worktree, copied: files.length };
}

/**
 * Why `worktree`, left by a thread that went back to another computer, can't
 * carry on at `tip` when the thread arrives again, if it can't: its branch
 * has commits `tip` lacks, or its folder holds work. Nothing in it is lost
 * moving up to `tip` otherwise.
 */
export async function cantCarryOn(
  root: string,
  worktree: ChatWorktree,
  tip: string,
) {
  const branch = worktree.branch!;
  const behind = await git(root, [
    "merge-base",
    "--is-ancestor",
    `refs/heads/${branch}`,
    tip,
  ]).then(
    () => true,
    () => false,
  );
  if (!behind) return `it has commits on ${branch} that never went back`;
  if (!(await worktreeExists(worktree))) return;
  const held = await worktreeHoldsWork(worktree.path!);
  if (held) return held;
  const on = (await git(worktree.path!, ["branch", "--show-current"])).trim();
  if (on !== branch) return `its folder isn't on ${branch} anymore`;
}

/**
 * A worktree for work that arrived from another computer: a new branch at
 * `commit`, counting its changes from `start` on `from`, as they did there,
 * when this repository has both. The branch keeps `branch`, its name there,
 * when it can be made here, and is `relay/…` after `name` otherwise. `over`
 * is the worktree an earlier trip left on `branch`, cleared by `cantCarryOn`:
 * its folder moves up to `commit` and carries on, ignored files and all.
 * A new folder gets the `.worktreeinclude` files of `includeFrom`, the
 * checkout unless given.
 */
export async function adoptWorktree(
  root: string,
  dir: string,
  name: string,
  commit: string,
  {
    from,
    start,
    branch: wanted,
    over,
    includeFrom = root,
  }: {
    from?: string;
    start?: string;
    branch?: string;
    over?: ChatWorktree;
    includeFrom?: string;
  } = {},
): Promise<MadeWorktree> {
  const local = from && (await commitOf(root, `refs/heads/${from}`));
  const current = (await git(root, ["branch", "--show-current"])).trim();
  const source = local ? from : current || undefined;
  const base =
    (start && (await commitOf(root, start))) ||
    (source &&
      (await git(root, ["merge-base", `refs/heads/${source}`, commit]).then(
        (s) => s.trim(),
        () => undefined,
      ))) ||
    commit;
  const folder = join(dir, slug(basename(root)));
  await mkdir(folder, { recursive: true });
  const kept = over?.branch === wanted ? over : undefined;
  if (kept && (await worktreeExists(kept))) {
    await git(kept.path!, ["merge", "--ff-only", "-q", commit], 120000);
    return {
      path: kept.path!,
      branch: wanted!,
      head: base,
      start: base,
      base,
      ...(source ? { from: source } : {}),
      named: wanted!,
      // The same folder: its setup and ignored files are still there.
      setup: kept.setup ?? "done",
    };
  }
  const named =
    kept || (wanted && !(await newBranchProblem(root, wanted)))
      ? wanted
      : undefined;
  const leaf = named
    ? await freeFolder(
        folder,
        kept?.path ? basename(kept.path) : slug(named.replace(/^relay\//, "")),
      )
    : await freeName(root, folder, slug(name));
  const path = join(folder, leaf);
  const branch = named ?? `relay/${leaf}`;
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(
    root,
    // A kept branch moves up to the commit; `cantCarryOn` made sure that loses nothing.
    ["worktree", "add", "-q", kept ? "-B" : "-b", branch, path, commit],
    120000,
  );
  return {
    path,
    branch,
    head: base,
    start: base,
    base,
    ...(source ? { from: source } : {}),
    ...(named ? { named } : {}),
    ...(await bootstrap(root, includeFrom, path)),
  };
}

/**
 * Readies a folder `git worktree add` just made: `.worktreeinclude` files
 * from `source`, then `node_modules` from the checkout `root` unless the
 * include brought its own. Setup is still to run in it.
 */
async function bootstrap(root: string, source: string, path: string) {
  const included = await copyIncluded(source, path);
  await linkModules(root, path);
  return {
    setup: "pending" as const,
    ...(included.length ? { included } : {}),
  };
}

async function linkModules(root: string, path: string) {
  const source = join(root, "node_modules");
  const info = await lstat(source).catch(() => null);
  if (
    !info?.isDirectory() ||
    (await lstat(join(path, "node_modules")).catch(() => null))
  )
    return;
  // Judged on the checkout's real folder: the usual `node_modules/` rule
  // matches folders only, never the link standing in for one.
  if (!(await ignoresModules(root))) return;
  const link = join(path, "node_modules");
  await symlink(source, link, "dir").catch(() => {});
  if (await ignoresModules(path)) return;
  // The repository's shared exclude keeps the link out of the thread's
  // changes; the checkout already ignores its folder, so nothing shows there.
  try {
    const file = resolve(
      path,
      (await gitIn(path, ["rev-parse", "--git-path", "info/exclude"])).trim(),
    );
    const before = await readFile(file, "utf8").catch(() => "");
    if (!before.split(/\r?\n/).includes("/node_modules")) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(
        file,
        `${before && !before.endsWith("\n") ? "\n" : ""}/node_modules\n`,
      );
    }
  } catch (e) {
    console.warn("[worktrees] could not exclude the node_modules link", e);
  }
  // A link Git still doesn't ignore would show up as the thread's own change.
  if (!(await ignoresModules(path))) await rm(link, { force: true });
}

const ignoresModules = (dir: string) =>
  // check-ignore rejects literal pathspec magic outright.
  gitIn(dir, ["check-ignore", "-q", "node_modules"], {
    env: { GIT_LITERAL_PATHSPECS: undefined },
  }).then(
    () => true,
    () => false,
  );

export const worktreeExists = (worktree: ChatWorktree) =>
  !!worktree.path && !worktree.removedAt && exists(worktree.path);

/**
 * What the worktree's changes count from: where its branch forks from the
 * branch it was made from, so merging that way makes them drop out. Worktrees
 * from before that started from a snapshot of the checkout's uncommitted
 * edits; they keep counting from it.
 */
async function forkPoint(worktree: ChatWorktree) {
  if (!worktree.from) return worktree.base!;
  return git(worktree.path!, [
    "merge-base",
    `refs/heads/${worktree.from}`,
    "HEAD",
  ]).then(
    (s) => s.trim(),
    () => worktree.start!,
  );
}

/** The worktree's tree now, and what it has that its branch's source doesn't, committed or not. */
export async function worktreeChanges(
  worktree: ChatWorktree,
): Promise<{ tree: string; files: TurnFileChange[] }> {
  const [tree, from] = await Promise.all([
    snapshotTree(worktree.path!),
    forkPoint(worktree),
  ]);
  const diff = await git(worktree.path!, [
    "diff",
    "--numstat",
    "-z",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    from,
    tree,
  ]);
  return { tree, files: parseNumstat(diff) };
}

export const worktreeDiff = async (worktree: ChatWorktree, path: string) =>
  revisionDiff(
    worktree.path!,
    await forkPoint(worktree),
    await snapshotTree(worktree.path!),
    path,
  );

/**
 * What removing the worktree would lose that Git couldn't give back, if
 * anything: edits not committed, files Git doesn't track yet (ignored ones
 * aside), or commits no branch, tag or remote branch holds, like ones made on
 * a detached HEAD. Refuses a folder that isn't a linked worktree.
 */
export async function worktreeHoldsWork(path: string) {
  // A main checkout keeps a `.git` folder; a linked worktree only a file pointing to it.
  if (!(await lstat(join(path, ".git")).catch(() => null))?.isFile())
    return "it isn't a linked worktree";
  if (await git(path, ["status", "--porcelain", "--untracked-files=normal"]))
    return "it has uncommitted changes";
  const stray = await git(path, [
    "rev-list",
    "-n1",
    "HEAD",
    "--not",
    "--branches",
    "--tags",
    "--remotes",
  ]);
  if (stray.trim()) return "it has commits on no branch";
}

/**
 * Brings back a worktree removed with its branch kept, at its old folder:
 * the branch as it was when it holds commits the checkout lacks, so the
 * thread carries on where it stopped; otherwise the branch moves up to the
 * checkout's commit, like a fresh worktree, unless it started off another
 * branch. Undefined when it can't: the branch is gone, its folder is taken,
 * or it's checked out elsewhere. A
 * branch the thread carried on takes a free folder beside its old one, and
 * one that can't be opened throws why, as it's never swapped for another.
 */
export async function reattachWorktree(
  root: string,
  previous: ChatWorktree,
): Promise<ChatWorktree | undefined> {
  const { branch, existing } = previous;
  let path = previous.path;
  if (!path || !branch || !relayBranch(previous)) return undefined;
  if (await exists(path)) {
    if (!existing) return undefined;
    path = join(
      dirname(path),
      await freeName(root, dirname(path), basename(path), branch),
    );
  }
  const kept = await git(root, [
    "rev-parse",
    "-q",
    "--verify",
    `refs/heads/${branch}^{commit}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!kept) return undefined;
  const head = await checkoutHead(root);
  const ahead = Number(
    await git(root, ["rev-list", "--count", `${head}..refs/heads/${branch}`]),
  );
  // The checkout's commit isn't where one carried on or started off belongs.
  const stays = ahead || existing || previous.startedOff;
  await git(root, ["worktree", "prune"]).catch(() => {});
  try {
    if (stays) await git(root, ["worktree", "add", "-q", path, branch], 120000);
    // Everything on it is in the checkout's commit, so moving it loses nothing.
    else
      await git(
        root,
        ["worktree", "add", "-q", "-B", branch, path, head],
        120000,
      );
  } catch (error) {
    if (!existing) return undefined;
    const why =
      (await carryOnProblem(root, branch)) ??
      (error instanceof Error ? error.message : String(error));
    throw new Error(`Couldn't open ${branch} in a worktree again: ${why}`);
  }
  // A fresh folder: its ignored files and setup are gone with the old one.
  const ready = await bootstrap(root, root, path);
  const {
    removedAt: _removed,
    cleanedUp: _cleaned,
    included: _included,
    // Free since removal, so maybe handed on; setup gives it a new one.
    portOffset: _offset,
    ...rest
  } = previous;
  if (stays) return { ...rest, path, ...ready };
  const from = (await git(root, ["branch", "--show-current"])).trim();
  return {
    path,
    branch,
    head,
    start: head,
    base: head,
    ...(from ? { from } : {}),
    ...(previous.named ? { named: previous.named } : {}),
    ...ready,
  };
}

/** Whether a deleted agent worktree's branch is still there to make it again from. */
export const branchKept = (root: string, branch: string) =>
  hasBranch(root, branch);

/**
 * Makes an agent's deleted worktree again in its old folder, on its branch,
 * with the `.worktreeinclude` files and `node_modules` a thread's own gets.
 * What it held uncommitted went with the folder.
 */
export async function recreateWorktree(
  root: string,
  path: string,
  branch: string,
) {
  if (!(await hasBranch(root, branch)))
    throw new Error(`Its branch ${branch} was deleted too.`);
  if (await exists(path)) throw new Error(`Something else is in ${path} now.`);
  await git(root, ["worktree", "prune"]).catch(() => {});
  await git(root, ["worktree", "add", "-q", path, branch], 120000);
  await bootstrap(root, root, path);
  const file = await readFile(join(path, ".git"), "utf8").catch(() => "");
  const gitdir = file.match(/^gitdir: (.+)$/m)?.[1];
  return {
    path,
    branch,
    ...(gitdir ? { gitdir: basename(gitdir.trim()) } : {}),
  };
}

const checkoutHead = (root: string) =>
  git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]).then(
    (s) => s.trim(),
    () => {
      throw new Error("Make a first commit before working in a worktree.");
    },
  );

/**
 * Removes the worktree, keeping a snapshot of what it held, and its branch
 * too unless `keepBranch` or the branch was there before the thread. A
 * folder Relay didn't make stays.
 */
export async function removeWorktree(
  root: string,
  chatId: string,
  worktree: ChatWorktree,
  { keepBranch = false } = {},
) {
  // Never Relay's to take, whoever asks.
  if (worktree.adopted) return;
  if (worktree.path && (await exists(worktree.path))) {
    const tree = await snapshotTree(worktree.path).catch(() => null);
    if (tree) {
      const kept = await commitTree(
        root,
        tree,
        worktree.base,
        "Relay: the worktree as it was removed",
      );
      await git(root, ["update-ref", keptRef(chatId), kept]);
    }
    await git(root, ["worktree", "remove", "--force", worktree.path]).catch(
      async () => {
        await rm(worktree.path!, { recursive: true, force: true });
        await git(root, ["worktree", "prune"]).catch(() => {});
      },
    );
  }
  if (worktree.branch && !keepBranch && !worktree.existing)
    await git(root, ["branch", "-D", worktree.branch]).catch(() => {});
}
