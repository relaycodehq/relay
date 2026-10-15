import { git } from "./git";
import { gitOperation, serializeRepo } from "./working-tree";
import { localTwin } from "../../shared/branches";
import type { BranchAction, BranchList } from "../../shared/branches";
/** The branches work usually merges into: origin's HEAD, then the usual names. */
export async function baseCandidates(root: string) {
  const originHead = (
    await git(root, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).catch(() => "")
  )
    .trim()
    .replace(/^origin\//, "");
  return [
    ...new Set(
      [originHead, "main", "master", "trunk", "develop"].filter(Boolean),
    ),
  ];
}
/**
 * Remotes whose base branch shares no history with HEAD: another repository,
 * like the pre-rewrite copy of this one. Judged by the base alone, so an
 * orphan gh-pages doesn't disown the whole remote.
 */
async function unrelatedRemotes(
  root: string,
  refs: string[],
  bases: string[],
): Promise<Set<string>> {
  const remotes = (await git(root, ["remote"]).catch(() => ""))
    .split("\n")
    .filter(Boolean);
  const unrelated = await Promise.all(
    remotes.map(async (remote) => {
      const base = bases
        .map((b) => `refs/remotes/${remote}/${b}`)
        .find((ref) => refs.includes(ref));
      if (!base) return null;
      const shared = await git(root, ["merge-base", "HEAD", base]).then(
        () => true,
        () => false,
      );
      return shared ? null : remote;
    }),
  );
  return new Set(unrelated.filter((r) => r !== null));
}
export async function branches(root: string): Promise<BranchList> {
  const [current, head, refs, bases] = await Promise.all([
    git(root, ["branch", "--show-current"]),
    // A repository with no commits yet has no HEAD to resolve.
    git(root, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => ""),
    git(root, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%00%(symref)%00%(worktreepath)",
      "refs/heads/",
      "refs/remotes/",
    ]),
    baseCandidates(root),
  ]);
  const rows = refs
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((row) => row.split("\0"));
  // Nothing committed yet shares history with no one, so no remote is foreign.
  const elsewhere = head.trim()
    ? await unrelatedRemotes(
        root,
        rows.map(([ref]) => ref),
        bases,
      )
    : new Set<string>();
  return {
    current: current.trim(),
    head: head.trim(),
    bases,
    branches: rows
      .flatMap(([ref, symbolic, worktree]) => {
        if (symbolic) return [];
        const remote = ref.startsWith("refs/remotes/");
        const name = ref.slice(remote ? 13 : 11);
        return [
          {
            ref,
            name,
            remote,
            worktree: !!worktree,
            current: !remote && name === current.trim(),
            unrelated:
              remote && [...elsewhere].some((r) => name.startsWith(`${r}/`)),
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) ||
          Number(a.remote) - Number(b.remote),
      ),
  };
}
export async function changeBranch(root: string, action: BranchAction) {
  return serializeRepo(root, async () => {
    const state = await branches(root);
    if (state.head !== action.head || state.current !== action.current)
      throw new Error(
        "The checkout changed. Refresh the branch list and try again.",
      );
    if (await gitOperation(root))
      throw new Error(
        "Finish the current merge or rebase before switching branches.",
      );
    if (action.kind === "create") {
      if (action.name.startsWith("-")) throw new Error("Invalid branch name.");
      await git(root, ["check-ref-format", "refs/heads/" + action.name]);
      await git(root, ["switch", "-c", action.name]);
    } else {
      const target = state.branches.find((b) => b.ref === action.name);
      if (!target)
        throw new Error("This branch no longer exists. Refresh and try again.");
      // A remote whose local branch exists means that branch, like `git switch`.
      const branch = localTwin(state.branches, target) ?? target;
      if (branch.current) return state;
      if (branch.worktree)
        throw new Error("This branch is checked out in another worktree.");
      if (branch.remote) {
        const local = branch.name.slice(branch.name.indexOf("/") + 1);
        await git(root, ["switch", "--track", "-c", local, branch.ref]);
      } else await git(root, ["switch", "--no-guess", "--", branch.name]);
    }
    return branches(root);
  });
}
