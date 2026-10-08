import { readFile } from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";
import { git } from "../git/git";
import type {
  AgentActivity,
  AgentWorktree,
  ProjectChat,
} from "../../shared/projects";

// Agents sometimes make their own git worktree from a shell command and work
// there. Relay didn't make it, so without this the thread still reads as
// working in the checkout while its changes land somewhere else.
//
// Threads run side by side on one repository, so a worktree that merely
// appeared during a turn may be another thread's. Only the command that made
// it says whose it is.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a command is a `git worktree add` naming `path`, by its folder name since agents write it relative or without macOS's /private. */
export function addsWorktree(command: string, path: string) {
  const target = new RegExp(
    `(^|[\\s/'"=])${escape(basename(path))}($|[\\s/'";&|)])`,
  );
  // Search output and other statements mentioning a path aren't creation evidence.
  const adds =
    /\bgit(?:\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)|--(?:git-dir|work-tree)=[^\s;&|]+))*\s+worktree\s+add\s+/g;
  return [...command.matchAll(adds)].some((match) => {
    const args =
      command
        .slice(match.index! + match[0].length)
        .match(/"[^"]*"|'[^']*'|[^\s"';&|]+|[;&|]/g) ?? [];
    let options = true;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (/^[;&|]$/.test(arg)) return false;
      if (options && arg === "--") {
        options = false;
        continue;
      }
      if (options && ["-b", "-B", "--reason"].includes(arg)) {
        i++;
        continue;
      }
      if (options && arg.startsWith("-")) continue;
      // The first positional argument is the folder; branch names aren't ownership evidence.
      return target.test(arg.replace(/^(['"])(.*)\1$/, "$2"));
    }
    return false;
  });
}

/** The recorded worktrees one of the thread's own commands made; older saves credited any that appeared meanwhile. */
export function ownAgentWorktrees(chat: ProjectChat) {
  const commands = chat.messages.flatMap((m) =>
    (m.trace ?? []).flatMap((e) =>
      e.kind === "activity" && e.activity.kind === "command"
        ? [e.activity.label]
        : [],
    ),
  );
  return (chat.agentWorktrees ?? []).filter((w) =>
    commands.some(
      (c) => addsWorktree(c, w.path) || (w.gitdir && addsWorktree(c, w.gitdir)),
    ),
  );
}

type Live = Map<string, { branch?: string; gitdir?: string }>;

/** The repository's worktrees still on disk, other than `root` and those under `skip`. */
async function liveWorktrees(root: string, skip: string): Promise<Live> {
  const live: Live = new Map();
  const out = await git(root, ["worktree", "list", "--porcelain"]);
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
  // `worktree repair` keeps this identity even when the folder was renamed.
  await Promise.all(
    [...live].map(async ([path, value]) => {
      const file = await readFile(join(path, ".git"), "utf8").catch(() => "");
      const dir = file.match(/^gitdir: (.+)$/m)?.[1];
      if (dir) value.gitdir = basename(dir.trim());
    }),
  );
  return live;
}

function reconcile(
  live: Live,
  recorded: AgentWorktree[],
  commands: { label: string; at: number }[],
  before?: Live,
) {
  const next: AgentWorktree[] = [];
  for (const [path, value] of live) {
    const old = recorded.find(
      (w) => w.path === path || (value.gitdir && w.gitdir === value.gitdir),
    );
    if (!old && before?.has(path)) continue;
    const made = commands.find(
      (c) =>
        addsWorktree(c.label, path) ||
        (value.gitdir && addsWorktree(c.label, value.gitdir)),
    );
    if (!old && !made) continue;
    const { branch: _branch, ...kept } = old ?? {};
    next.push({ ...kept, path, ...value, at: old?.at ?? made!.at });
  }
  return next.sort((a, b) => a.at - b.at);
}

/** Backfills missed creation events, including a worktree recovered at another path. */
export async function recoverAgentWorktrees(
  root: string,
  relayWorktrees: string,
  chat: ProjectChat,
) {
  const commands = chat.messages.flatMap((m) =>
    (m.trace ?? []).flatMap((e) =>
      e.kind === "activity" &&
      e.activity.kind === "command" &&
      e.activity.status === "complete" &&
      /\bworktree\s+add\b/.test(e.activity.label)
        ? [{ label: e.activity.label, at: m.created }]
        : [],
    ),
  );
  if (!commands.length && !chat.agentWorktrees?.length) return [];
  return reconcile(
    await liveWorktrees(root, relayWorktrees),
    chat.agentWorktrees ?? [],
    commands,
  );
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
  const check = async (command: string) => {
    const known = await before;
    if (!known) return;
    const live = await liveWorktrees(root, relayWorktrees);
    const next = reconcile(
      live,
      recorded(),
      [{ label: command, at: Date.now() }],
      known,
    );
    if (JSON.stringify(next) !== JSON.stringify(recorded()))
      await onChange(next);
  };
  return (activity: AgentActivity) => {
    if (activity.kind !== "command" || activity.status === "running") return;
    if (!/worktree/i.test(activity.label) && activity.label.length < 500)
      return;
    queue = queue.then(() => check(activity.label)).catch(() => {});
    return queue;
  };
}
