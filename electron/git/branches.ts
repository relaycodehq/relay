import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { git } from "./git";
import { gitOperation, serializeRepo } from "./working-tree";
import { localTwin } from "../../shared/branches";
import type {
  BranchAction,
  BranchCount,
  BranchCounts,
  BranchList,
} from "../../shared/branches";
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
      [originHead, "main", "master", "trunk", "develop", "dev"].filter(Boolean),
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
/**
 * Nothing was ever committed to local branch `name`: its reflog only records
 * it being made or renamed. Without a reflog that's unknown, so false.
 */
async function neverCommitted(commonDir: string, name: string) {
  const log = await readFile(
    join(commonDir, "logs", "refs", "heads", name),
    "utf8",
  ).catch(() => "");
  const entries = log
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(line.indexOf("\t") + 1));
  return (
    entries.length > 0 &&
    entries.every((e) => /^branch: (created|renamed)/i.test(e))
  );
}

/**
 * Where each branch stands against the bases. Ahead and behind count against
 * every base that exists, locally and on origin; a branch takes whichever it's
 * closest to, so work merged into any of them, on either side, reads as merged.
 * `aheadBehind` off counts the way git before 2.41 has to, for its tests.
 */
export async function branchCounts(
  root: string,
  aheadBehind = true,
): Promise<BranchCounts> {
  const [refs, bases, commonDir] = await Promise.all([
    git(root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads/",
      "refs/remotes/origin/",
    ]),
    baseCandidates(root),
    git(root, ["rev-parse", "--git-common-dir"]).then(
      (dir) => resolve(root, dir.trim()),
      () => "",
    ),
  ]);
  const existing = refs.split("\n");
  const compareTo = bases.flatMap((base) =>
    [`refs/heads/${base}`, `refs/remotes/origin/${base}`]
      .filter((ref) => existing.includes(ref))
      .map((ref) => ({ ref, base })),
  );
  const list = (counts: string) =>
    git(root, [
      "for-each-ref",
      `--format=%(refname)%00%(symref)%00%(worktreepath)%00%(objectname)%00%(committerdate:unix)${counts}`,
      "refs/heads/",
      "refs/remotes/",
    ]);
  const counts = compareTo
    .map(({ ref }) => `%00%(ahead-behind:${ref})`)
    .join("");
  // %(ahead-behind) arrived in git 2.41. Older ones, like the Apple Git
  // macOS ships, still tell what each base has merged, just not by how much.
  const counted =
    counts && aheadBehind ? await list(counts).catch(() => null) : null;
  const [out, merged] = await Promise.all([
    counted ?? list(""),
    counted || !compareTo.length
      ? []
      : Promise.all(
          compareTo.map(async ({ ref }) =>
            (
              await git(root, [
                "for-each-ref",
                "--format=%(refname)",
                `--merged=${ref}`,
                "refs/heads/",
                "refs/remotes/",
              ])
            ).split("\n"),
          ),
        ),
  ]);
  const mergedInto = (ref: string) => {
    const i = merged.findIndex((refs) => refs.includes(ref));
    return i < 0 ? undefined : { ahead: 0, against: compareTo[i].base };
  };
  const rows = out.trimEnd().split("\n").filter(Boolean);
  const entries = await Promise.all(
    rows.map(async (row): Promise<[string, BranchCount] | null> => {
      const [ref, symref, worktree, sha, date, ...pairs] = row.split("\0");
      if (symref) return null;
      const remote = ref.startsWith("refs/remotes/");
      const name = ref.slice(remote ? 13 : 11);
      const closest:
        Pick<BranchCount, "ahead" | "behind" | "against"> | undefined = counted
        ? pairs
            .map((p, i) => {
              const [ahead, behind] = p.split(" ").map(Number);
              return { ahead, behind, against: compareTo[i].base };
            })
            .filter(
              (c) => Number.isFinite(c.ahead) && Number.isFinite(c.behind),
            )
            .sort((x, y) => x.ahead - y.ahead || x.behind - y.behind)[0]
        : mergedInto(ref);
      // A worktree's branch the bases already have may just be new.
      const noCommits =
        !remote &&
        !!worktree &&
        closest?.ahead === 0 &&
        !bases.includes(name) &&
        !!commonDir &&
        (await neverCommitted(commonDir, name));
      return [
        name,
        {
          sha,
          date: Number(date) * 1000,
          ...closest,
          ...(noCommits ? { noCommits } : {}),
        },
      ];
    }),
  );
  return {
    compared: [...new Set(compareTo.map((c) => c.base))],
    branches: Object.fromEntries(entries.filter((e) => e !== null)),
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
