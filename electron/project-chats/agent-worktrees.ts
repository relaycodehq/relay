import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { git } from "../git/git";
import {
  selectedAgentWorktree,
  type ActiveAgentWorktree,
  type AgentActivity,
  type AgentWorktree,
  type ChatWorktree,
  type ProjectChat,
} from "../../shared/projects";

// Agents sometimes make their own git worktree from a shell command and work
// there. Relay didn't make it, so without this the thread still reads as
// working in the checkout while its changes land somewhere else.
//
// Threads run side by side on one repository, so a worktree that merely
// appeared during a turn may be another thread's. Only the command that made
// it says whose it is.

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const unquote = (text: string) => text.replace(/^(['"])(.*)\1$/, "$2");

/** The shell variables `before` sets, like `WT="$HOME/…/name"`, the last one winning. */
function assigned(before: string) {
  const vars = new Map<string, string>();
  for (const [, name, value] of before.matchAll(
    /(?:^|[\s;&|(])(?:export\s+|local\s+)?([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|)'"]*)/g,
  ))
    vars.set(name, unquote(value));
  return vars;
}

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
      const vars = assigned(command.slice(0, match.index));
      const folder = arg.startsWith("'")
        ? unquote(arg)
        : unquote(arg).replace(
            /\$\{?([A-Za-z_]\w*)\}?/g,
            (whole, name: string) => vars.get(name) ?? whole,
          );
      return target.test(folder);
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

/**
 * The worktree a project-folder thread moves to without being asked: the
 * first one its own agent makes during a turn. Once one is recorded only the
 * user moves the thread, so going back to the project folder sticks.
 */
function firstAgentWorktree(chat: ProjectChat, next: AgentWorktree[]) {
  if (
    chat.worktree ||
    chat.scope.kind !== "project" ||
    chat.reviewer ||
    chat.thinker ||
    chat.activeAgentWorktree ||
    chat.agentWorktrees?.length
  )
    return undefined;
  return next.at(-1);
}

/**
 * Where a thread works once its agent worktrees are `worktrees`: the one
 * selected, as Git now has it. Gone, one Relay followed the agent into
 * sends the thread back to the project folder, whichever turn or restart
 * notices; one the user chose stays selected, shown as unavailable.
 */
export function activeAfter(
  chat: ProjectChat,
  worktrees: AgentWorktree[],
): ActiveAgentWorktree | undefined {
  const active = chat.activeAgentWorktree;
  const selected = selectedAgentWorktree({ ...chat, agentWorktrees: worktrees });
  if (!selected) return active?.followed ? undefined : active;
  return {
    path: selected.path,
    gitdir: selected.gitdir,
    branch: selected.branch,
    ...(active?.followed ? { followed: true as const } : {}),
  };
}

/** Applies one turn's worktree changes to its thread. */
export function turnWorkspace(chat: ProjectChat) {
  return (worktrees: AgentWorktree[]) => {
    const first = firstAgentWorktree(chat, worktrees);
    const active = first
      ? {
          path: first.path,
          gitdir: first.gitdir,
          branch: first.branch,
          followed: true as const,
        }
      : activeAfter(chat, worktrees);
    if (worktrees.length) chat.agentWorktrees = worktrees;
    else delete chat.agentWorktrees;
    if (active) chat.activeAgentWorktree = active;
    else delete chat.activeAgentWorktree;
  };
}

type Live = Map<string, { branch?: string; gitdir?: string }>;

/**
 * The folders of threads' own worktrees. Relay made those, whatever an
 * agent's command says; any other folder, in Relay's worktrees folder too,
 * may be an agent's.
 */
export const threadWorktreePaths = (
  chats: { worktree?: ChatWorktree }[] = [],
): ReadonlySet<string> =>
  new Set(chats.flatMap((c) => (c.worktree?.path ? [c.worktree.path] : [])));

/** The repository's worktrees still on disk, other than `root` and threads' own. */
async function liveWorktrees(
  root: string,
  relayMade: ReadonlySet<string>,
): Promise<Live> {
  const live: Live = new Map();
  const out = await git(root, ["worktree", "list", "--porcelain"]);
  for (const block of out.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines
      .find((l) => l.startsWith("worktree "))
      ?.slice("worktree ".length);
    if (
      !path ||
      relayMade.has(path) ||
      lines.some((l) => l.startsWith("prunable"))
    )
      continue;
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
  relayMade: ReadonlySet<string>,
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
    await liveWorktrees(root, relayMade),
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
  relayMade: () => ReadonlySet<string>,
  recorded: () => AgentWorktree[],
  onChange: (worktrees: AgentWorktree[]) => void | Promise<void>,
) {
  const before = liveWorktrees(root, relayMade()).catch(() => null);
  let queue = Promise.resolve();
  const check = async (command: string) => {
    const known = await before;
    if (!known) return;
    const live = await liveWorktrees(root, relayMade());
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
