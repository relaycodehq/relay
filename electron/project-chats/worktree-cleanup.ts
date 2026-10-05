import { isAbsolute, relative, resolve } from "node:path";
import type {
  ChatSummary,
  ChatWorktree,
  ProjectChat,
} from "../../shared/projects";
import { worktreeHoldsWork } from "../git/worktrees";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { awaitsReturn } from "./handoff";
import type { ThreadWorktrees } from "./worktrees";

const DAY_MS = 86_400_000;
/** A thread shown in a window asks for its worktree every few seconds; this long after the last ask it counts as closed. */
const SHOWN_FOR_MS = 10 * 60_000;
/** A worktree kept for what's in it, or what runs in it, is looked at again this much later, not every sweep. */
const RECHECK_MS = 60 * 60_000;

/** A thread with a worktree on record, as a sweep reads it. */
export interface CleanupCandidate {
  /** Its summary with what runs or waits in it now, as the thread list has it. */
  chat: ChatSummary;
  /** When it moved to Settled, by hand or by itself; undefined while it isn't. */
  settledSince: number | undefined;
  /** Days after settling before its worktree goes; null never. */
  days: number | null;
  /** The project's checkout, which is never removed. */
  checkout: string;
}

/** What the sweep knows of the rest of the app. */
export interface CleanupScene {
  now: number;
  /** The folder Relay makes threads' worktrees in. */
  folder: string;
  /** Every thread, to find another working in the same folder. */
  chats: readonly ChatSummary[];
  /** Shown in a window lately. */
  shown(id: string): boolean;
  /** A turn or a side question is running in the thread. */
  busy(id: string): boolean;
  /** A Relay terminal is open in the folder. */
  terminal(path: string): boolean;
}

/** Inside Relay's worktree folder, on a branch Relay named, and not holding the checkout. */
function relayMade(worktree: ChatWorktree, checkout: string, folder: string) {
  const path = resolve(worktree.path!);
  const inside = (parent: string, child: string) => {
    const rel = relative(parent, child);
    return !rel.startsWith("..") && !isAbsolute(rel);
  };
  return (
    (!!worktree.branch?.startsWith("relay/") ||
      (!!worktree.named && worktree.branch === worktree.named)) &&
    path !== resolve(folder) &&
    inside(resolve(folder), path) &&
    !inside(path, resolve(checkout))
  );
}

/**
 * Why a thread keeps its worktree for now; undefined once it can go as far
 * as anything Relay knows without asking Git or the system. Checked again
 * every sweep, so a thread moved back out of Settled before its day simply
 * stops being due.
 */
export function cleanupKept(
  { chat, settledSince, days, checkout }: CleanupCandidate,
  scene: CleanupScene,
): string | undefined {
  const worktree = chat.worktree;
  if (!worktree?.path || worktree.removedAt) return "no worktree on disk";
  if (days === null) return "cleanup is off";
  if (chat.archivedAt) return "archived";
  if (settledSince === undefined) return "not settled";
  if (scene.now < settledSince + days * DAY_MS) return "not due yet";
  if (!relayMade(worktree, checkout, scene.folder))
    return "not a worktree Relay made";
  if (chat.sentTo || chat.cameFrom?.returnedAt || awaitsReturn(chat))
    return "handed off to another computer";
  if (chat.running || chat.waiting || scene.busy(chat.id))
    return "an agent is at work in it";
  if (
    chat.pending?.length ||
    chat.heldWakeups?.length ||
    chat.nextSend ||
    chat.stopped ||
    (chat.limitResume && !chat.limitResume.off)
  )
    return "work is waiting to run in it";
  if (scene.shown(chat.id)) return "it's open";
  if (scene.terminal(worktree.path)) return "a terminal is open in it";
  if (
    scene.chats.some(
      (other) =>
        other.id !== chat.id &&
        other.worktree?.path === worktree.path &&
        !other.worktree?.removedAt,
    )
  )
    return "another thread works in it";
}

/**
 * Removes the worktrees of threads settled for the set days, on launch and
 * every few minutes. Only Relay's own worktrees go, only with nothing at
 * work or waiting in them and nothing Git couldn't give back; their branches
 * stay, so the thread's next message checks its branch out again.
 */
export class WorktreeCleanup {
  private sweeping = false;
  private lastShown = new Map<string, number>();
  /** Threads whose worktree held work or ran something, and when to look again. */
  private recheck = new Map<string, number>();
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private councils: Pick<Councils, "busy">,
    private candidates: () => CleanupCandidate[],
    private now = () => Date.now(),
  ) {}

  /** A window is showing the thread. */
  shown(id: string) {
    this.lastShown.set(id, this.now());
  }

  private scene(): CleanupScene {
    const now = this.now();
    return {
      now,
      folder: this.worktrees.folder,
      chats: this.core.store.get().chats ?? [],
      shown: (id) => now - (this.lastShown.get(id) ?? 0) < SHOWN_FOR_MS,
      busy: (id) => this.core.active.has(id) || this.core.active.hasSide(id),
      terminal: (path) => threadTerminals.openWithin(path),
    };
  }

  async sweep() {
    if (this.sweeping || this.core.closing()) return;
    this.sweeping = true;
    try {
      const scene = this.scene();
      const due = this.candidates().filter(
        (c) =>
          !cleanupKept(c, scene) &&
          (this.recheck.get(c.chat.id) ?? 0) <= this.now(),
      );
      for (const { chat } of due) {
        if (this.core.closing()) return;
        const why = await this.worktrees
          .cleanUp(chat.id, (loaded) => this.kept(loaded))
          .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
        if (why) this.recheck.set(chat.id, this.now() + RECHECK_MS);
        else this.recheck.delete(chat.id);
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** Everything again, in the thread's turn so nothing starts meanwhile, then what runs in the folder and what Git holds there. */
  private async kept(chat: ProjectChat) {
    const candidate = this.candidates().find((c) => c.chat.id === chat.id);
    if (!candidate) return "no worktree on disk";
    const why = cleanupKept(candidate, this.scene());
    if (why) return why;
    if (this.councils.busy(chat)) return "a review or council is at work";
    const path = chat.worktree!.path!;
    if ((await projectTasks.list(path)).length)
      return "something is running in it";
    return worktreeHoldsWork(path);
  }
}
