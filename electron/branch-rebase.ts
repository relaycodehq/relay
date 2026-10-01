import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import { fetchUpstream, serializeRepo, workingTree } from "./working-tree";
import {
  checkoutChanged,
  type Commit,
  type RebaseResult,
} from "../shared/working-tree";

async function commits(root: string, range: string): Promise<Commit[]> {
  return (await git(root, ["log", "-30", "--format=%h %s", range]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((r) => ({
      sha: r.slice(0, r.indexOf(" ")),
      subject: r.slice(r.indexOf(" ") + 1),
    }));
}
/**
 * Replays the commits `tip` has and `onto` doesn't onto `onto`, in a
 * throwaway worktree so no folder moves: the new tip, or the files the first
 * clash stopped on.
 */
export async function replayOnto(
  root: string,
  tip: string,
  onto: string,
): Promise<{ sha: string } | { conflicts: string[] }> {
  if ((await git(root, ["rev-list", "--merges", `${onto}..${tip}`])).trim())
    throw new Error(
      "The commits to replay include a merge, which a rebase would flatten. Rebase or merge them yourself.",
    );
  const dir = await mkdtemp(join(tmpdir(), "relay-rebase-"));
  try {
    await git(root, ["worktree", "add", "--detach", "--quiet", dir, tip]);
    try {
      // Config, not flags, so a Git older than these options ignores them.
      await git(
        dir,
        [
          "-c",
          "rebase.updateRefs=false",
          "-c",
          "rebase.autoSquash=false",
          "rebase",
          "--quiet",
          onto,
        ],
        120000,
      );
    } catch (e) {
      const conflicts = (
        await git(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(
          () => "",
        )
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      if (!conflicts.length) throw e;
      return { conflicts };
    }
    return { sha: (await git(dir, ["rev-parse", "HEAD"])).trim() };
  } finally {
    await git(root, ["worktree", "remove", "--force", dir]).catch(() =>
      rm(dir, { recursive: true, force: true }),
    );
    await git(root, ["worktree", "prune"]).catch(() => {});
  }
}

/**
 * Moves the checked-out branch from `head` to `to` in one step. A two-tree
 * merge, unlike `reset --keep`, keeps what's staged; uncommitted work stays,
 * and Git refuses rather than overwrite an edit to a file the move changes.
 */
export async function moveCheckout(
  root: string,
  head: string,
  to: string,
  reason: string,
) {
  if ((await git(root, ["rev-parse", "HEAD"])).trim() !== head)
    throw new Error(`${checkoutChanged} Look at the branch again and retry.`);
  await git(root, ["read-tree", "-m", "-u", head, to], 120000).catch(
    (e: Error) => {
      throw new Error(
        /not uptodate|would be overwritten/.test(e.message)
          ? `Uncommitted edits there touch files this would change. Commit or stash them, then try again.\n\n${e.message}`
          : e.message,
      );
    },
  );
  await git(root, ["update-ref", "-m", `${reason} (Relay)`, "HEAD", to, head]);
}

/**
 * Replays the branch's own commits onto its upstream without touching this
 * folder until they all apply, then moves the branch there.
 */
export function rebaseOnUpstream(
  root: string,
  head: string,
): Promise<RebaseResult> {
  return serializeRepo(root, async () => {
    const before = await workingTree(root);
    // The head, not the whole revision: edits elsewhere in the folder don't matter here.
    if (before.head !== head)
      throw new Error(`${checkoutChanged} Look at the branch again and retry.`);
    if (!before.branch || !before.upstream)
      throw new Error("This branch has no upstream to rebase onto.");
    if (before.operation)
      throw new Error("Finish the current Git operation first.");
    await fetchUpstream(root, before.branch);
    const state = await workingTree(root);
    if (!state.behind) return { rebased: true, tree: state };
    const upstream = state.upstream!;
    const onto = (await git(root, ["rev-parse", "@{upstream}"])).trim();
    const replayed = state.ahead
      ? await replayOnto(root, head, onto)
      : { sha: onto };
    if ("conflicts" in replayed) {
      const [incoming, outgoing] = await Promise.all([
        commits(root, `${head}..${onto}`),
        commits(root, `${onto}..${head}`),
      ]);
      return {
        rebased: false,
        tree: state,
        upstream,
        incoming,
        outgoing,
        conflicts: replayed.conflicts,
      };
    }
    await moveCheckout(root, head, replayed.sha, `rebase: onto ${upstream}`);
    return { rebased: true, tree: await workingTree(root) };
  });
}
