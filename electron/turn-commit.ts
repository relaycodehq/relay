import { headOf } from "./handoff/git";

/** `git commit`, `git -C dir commit --amend`, one step of `git add -A && git commit`. */
const commitCommand = /\bgit\b[^\n;&|]*\scommit\b/;

/** Each folder's checked-out commit; undefined where there's none. */
export const headsOf = (roots: string[]) =>
  Promise.all(roots.map((root) => headOf(root).catch(() => undefined)));

/**
 * Follows one turn for whether it ended on the agent's own commit: it ran
 * `git commit`, edited nothing after it, and HEAD moved in one of `roots`,
 * a worktree thread's folder or the checkout it lands in. A command alone
 * can fail or only mention it, and in a shared checkout another thread may
 * commit meanwhile.
 */
export async function commitWatch(roots: string[]) {
  const before = await headsOf(roots);
  let committed = false,
    editedSince = false;
  return {
    command(label: string) {
      if (!commitCommand.test(label)) return;
      committed = true;
      editedSince = false;
    },
    edited() {
      if (committed) editedSince = true;
    },
    async ended() {
      if (!committed || editedSince) return false;
      const after = await headsOf(roots);
      return before.some((head, i) => head && after[i] && head !== after[i]);
    },
  };
}
