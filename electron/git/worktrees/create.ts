import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { currentBranch, git as gitIn } from "../git";
import { remoteOfBranch } from "../../../shared/branches";
import type { ChatWorktree, WorktreeStart } from "../../../shared/projects";
import { errorMessage } from "../../../shared/error-message";
import { bootstrap } from "./bootstrap";
import {
  git,
  type MadeWorktree,
  exists,
  hasBranch,
  commitOf,
  checkedOutAt,
  real,
  checkoutHead,
} from "./common";
import { slug, freeName, newBranchProblem, placeFor } from "./naming";

// Making a thread's worktree: off the checkout's commit, a branch, or another thread's.

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
 * checking it out is in the way, on a new branch off it. A remote start is
 * fetched first unless `fetch` is false, when `fetchStart` did already.
 */
export async function createWorktree(
  root: string,
  dir: string,
  name: string,
  previous?: ChatWorktree,
  fetch: { signal?: AbortSignal } | false = {},
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
    const problem = errorMessage(error);
    fell = { branch, problem, ...(off ? { off } : {}) };
    return undefined;
  };
  let offFrom = start && "off" in start ? start.off : undefined;
  let fetched = false;
  if (start && "on" in start) {
    let place = await carryOnPlace(root, start.on, fetch || undefined).catch(
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
    (await branchOff(root, offFrom, (!fetched && fetch) || undefined).catch(
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

/**
 * Brings the remote branch a worktree starts `on` or `off` up to date, if
 * it's a remote one. Fetching can take a while and does no harm twice, so
 * it runs before the repository's queue rather than holding it up.
 */
export async function fetchStart(
  root: string,
  start: WorktreeStart | undefined,
  signal?: AbortSignal,
) {
  const name =
    start &&
    ("on" in start ? start.on : "off" in start ? start.off : undefined);
  const remote = name && (await remoteOf(root, name));
  if (remote) await fetchBranch(root, remote, signal);
}

/**
 * The local branch `name` means: itself, or for a remote one listed as
 * `origin/…` its local twin when there is one, as `git switch` has it.
 */
export async function localBranchName(root: string, name: string) {
  const remote = await remoteOf(root, name);
  return remote && (await hasBranch(root, remote.branch))
    ? remote.branch
    : name;
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
 * The branch `name` is here, as carrying it on takes it: a local one, or a
 * remote's listed as `origin/…`, under its local name. `inCheckout` when the
 * project folder has that one checked out. Undefined for a name that's no
 * branch, and for a revision like `main~1`.
 */
export async function existingBranch(root: string, name: string) {
  const isName = await git(root, [
    "check-ref-format",
    `refs/heads/${name}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!isName) return undefined;
  const { sha, branch } = await resolveStart(root, name);
  if (!sha) return undefined;
  const at = await checkedOutAt(root, branch);
  const checkout = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  const inCheckout = !!at && (await real(at)) === (await real(checkout));
  return { branch, inCheckout };
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
export async function forkOff(root: string, branch: string) {
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
    const why = errorMessage(error);
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
