/** What Relay tells the processes in a thread's worktree; see project-chats/worktree-commands. */
export const WORKTREE_VARS = [
  "RELAY_PORT_OFFSET",
  "RELAY_WORKTREE",
  "RELAY_PROJECT_ROOT",
  "RELAY_BRANCH",
] as const;

/**
 * `base` with the thread's worktree variables, and never the ones Relay
 * itself started with: a Relay run from a worktree would hand its own offset
 * to threads working in the checkout.
 */
export function withWorktreeEnv(
  base: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const env = { ...base };
  for (const name of WORKTREE_VARS) delete env[name];
  return { ...env, ...extra };
}
