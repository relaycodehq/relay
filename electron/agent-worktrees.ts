import { relative, isAbsolute } from "node:path";
import { run } from "./turn-changes";
import type { AgentActivity, AgentWorktree } from "../shared/projects";

// Agents sometimes make their own git worktree from a shell command and work
// there. Relay didn't make it, so without this the thread still reads as
// working in the checkout while its changes land somewhere else.

type Live = Map<string, { branch?: string }>;

/** The repository's worktrees still on disk, other than `root` and those under `skip`. */
async function liveWorktrees(root: string, skip: string): Promise<Live> {
  const live: Live = new Map();
  const out = await run(root, ["worktree", "list", "--porcelain"]);
  for (const block of out.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines
      .find((l) => l.startsWith("worktree "))
      ?.slice("worktree ".length);
    if (!path || lines.some((l) => l.startsWith("prunable"))) continue;
    const inside = relative(skip, path);
    if (!inside.startsWith("..") && !isAbsolute(inside)) continue;
    const branch = lines
      .find((l) => l.startsWith("branch "))
      ?.slice("branch ".length)
      .replace(/^refs\/heads\//, "");
    live.set(path, branch ? { branch } : {});
  }
  // The first entry is the main checkout; `root` may be it or a worktree.
  const main = out.match(/^worktree (.+)$/m)?.[1];
  if (main) live.delete(main);
  live.delete(root);
  return live;
}

/**
 * Follows a turn's commands and reports the worktrees its agent made or
 * removed. Only commands that mention worktrees are checked, and ones cut
 * off before the end, since the label may have lost that part.
 */
export function watchAgentWorktrees(
  root: string,
  relayWorktrees: string,
  recorded: () => AgentWorktree[],
  onChange: (worktrees: AgentWorktree[]) => void | Promise<void>,
) {
  const before = liveWorktrees(root, relayWorktrees).catch(() => null);
  let queue = Promise.resolve();
  const check = async () => {
    const known = await before;
    if (!known) return;
    const live = await liveWorktrees(root, relayWorktrees);
    const kept = recorded().filter((w) => live.has(w.path));
    const made = [...live]
      .filter(
        ([path]) => !known.has(path) && !kept.some((w) => w.path === path),
      )
      .map(([path, { branch }]) => ({
        path,
        ...(branch ? { branch } : {}),
        at: Date.now(),
      }));
    for (const [path, value] of live) known.set(path, value);
    const next = [...kept, ...made];
    if (next.length !== recorded().length || made.length) await onChange(next);
  };
  return (activity: AgentActivity) => {
    if (activity.kind !== "command" || activity.status === "running") return;
    if (!/worktree/i.test(activity.label) && activity.label.length < 500)
      return;
    queue = queue.then(check).catch(() => {});
  };
}
