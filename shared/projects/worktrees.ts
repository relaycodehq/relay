import { z } from "zod";
import { branchNameProblem } from "../branch-names";
import type { AgentProvider } from "../agents";
import { workingReview, type ReviewCheckout } from "../deep-review";
import type { TurnFileChange } from "./messages";

/**
 * A branch as Git lists it, local or `origin/…`. No part starts with `-`, so
 * with its remote cut off it's never an option, and Git's own rules keep out
 * `:` and `..`, so it's never a refspec.
 */
const refNameSchema = z
  .string()
  .trim()
  .max(250)
  .refine(
    (name) =>
      !branchNameProblem(name) &&
      !name.split("/").some((part) => part.startsWith("-")),
  );
/**
 * Where a new thread's worktree starts, when not on a new branch off the
 * checkout's commit: a new branch `off` another branch, a remote one
 * fetched first, `on` an existing branch, carried on in the folder it's
 * checked out in or in a new worktree, or in the worktree another `thread`
 * works in, the two of them sharing its folder.
 */
export const worktreeStartSchema = z.union([
  z.object({ off: refNameSchema }).strict(),
  z.object({ on: refNameSchema }).strict(),
  z.object({ thread: z.uuid() }).strict(),
]);
export type WorktreeStart = z.infer<typeof worktreeStartSchema>;

type WithWorktree = {
  id: string;
  worktree?: ChatWorktree;
  archivedAt?: number;
  /** Away on another computer; see `ChatSentTo`. */
  sentTo?: unknown;
};
/** A worktree whose folder is there to work in, not removed or cleaned up. */
const liveWorktree = (worktree: ChatWorktree | undefined) =>
  !!worktree?.path && !worktree.removedAt && !worktree.cleanedUp;

/**
 * The other open threads working in `chat`'s worktree folder. While there
 * are any, nothing removes, renames or hands off the folder from under them.
 */
export const threadsSharing = <T extends WithWorktree>(
  chats: readonly T[],
  chat: Pick<WithWorktree, "id" | "worktree">,
) =>
  liveWorktree(chat.worktree)
    ? chats.filter(
        (c) =>
          c.id !== chat.id &&
          !c.archivedAt &&
          liveWorktree(c.worktree) &&
          c.worktree!.path === chat.worktree!.path,
      )
    : [];

/** The threads sharing a worktree, by title: “One”, or “One” and 2 others. */
export function sharedWith(others: readonly { title: string }[]) {
  const first = `“${others[0]!.title}”`;
  return others.length === 1
    ? first
    : `${first} and ${others.length - 1} other${others.length === 2 ? "" : "s"}`;
}

/**
 * Open threads with a worktree another thread can join, one per folder. Not
 * one away on another computer: its work lands in the folder once it's back.
 */
export const joinableWorktrees = <T extends WithWorktree>(
  chats: readonly T[],
) => {
  const seen = new Set<string>();
  return chats.filter((c) => {
    if (c.archivedAt || c.sentTo || !liveWorktree(c.worktree)) return false;
    if (seen.has(c.worktree!.path!)) return false;
    seen.add(c.worktree!.path!);
    return true;
  });
};

/**
 * The worktree a thread joining `other`'s takes: the same folder, branch
 * and point its changes count from, so both see the same Changes, and the
 * same port offset. Setup already ran, or runs, for the folder.
 */
export function joinedWorktree(other: ChatWorktree): ChatWorktree {
  const {
    removedAt: _removed,
    cleanedUp: _cleaned,
    startFrom: _start,
    wanted: _wanted,
    setup: _setup,
    included: _included,
    ...shared
  } = other;
  return { ...shared, setup: "done" };
}

/** A thread that works in its own git worktree, leaving the checkout alone. */
export interface ChatWorktree {
  /** Unset until the first message makes the worktree. */
  path?: string;
  branch?: string;
  /**
   * A branch name kept rather than taken from its folder: the one the user
   * gave it, made with the first message, or the one it had on the computer
   * it came from. Relay still counts the branch as its own.
   */
  named?: string;
  /**
   * The branch the user named, or picked to carry on or (`off`) start off,
   * that couldn't be used by the time the first message sent, and why; the
   * worktree went on a `relay/…` branch off the checkout's commit instead,
   * or off the branch itself when only checking it out was in the way.
   */
  wanted?: { branch: string; problem: string; off?: true };
  /** Where the first message makes it, picked for the new thread; gone once it's made. */
  startFrom?: WorktreeStart;
  /**
   * The branch it was made off in place of the checkout's. Made again, it
   * stays off it rather than moving up to the checkout's commit.
   */
  startedOff?: string;
  /**
   * It carries on a branch that was there before the thread. Relay never
   * renames, resets or deletes it, and it keeps its name in `named`.
   */
  existing?: true;
  /**
   * A folder Relay didn't make: one the branch was already checked out in,
   * by the user, another tool or a thread long gone. The thread works in it
   * as it is; Relay runs no setup there and never removes, renames or cleans
   * it up, nor deletes its branch, which is `existing` too.
   */
  adopted?: true;
  /** The checkout's branch it was made from; its changes are what that branch lacks. */
  from?: string;
  /** The commit the worktree was made at: the checkout's, or the branch's it started off or carried on. */
  head?: string;
  /** Where its branch starts: `head`, or for older worktrees a snapshot of the checkout's uncommitted edits. */
  start?: string;
  /** Older worktrees count their changes from here instead of from `from`. */
  base?: string;
  /** Its PR was merged on the Git host, or Relay's Merge landed its branch. Older worktrees may hold other values. */
  landed?: { at: number; by: string };
  pr?: { number: number; url: string };
  /** Removed; the next message makes a fresh one from the checkout. */
  removedAt?: number;
  /**
   * Removed by itself a while after the thread settled, with nothing
   * uncommitted in it. Its branch stays, and the next message checks it out again.
   */
  cleanedUp?: true;
  /** Made since Relay ran setup commands: "pending" until the project's setup has run in this folder. */
  setup?: "pending" | "done";
  /** What `.worktreeinclude` copied into this folder, until setup shows it. */
  included?: string[];
  /** Added to its dev servers' ports, handed out as RELAY_PORT_OFFSET; the checkout's is 0. */
  portOffset?: number;
}
/**
 * Days a settled thread keeps its worktree before Relay removes it; 0 as soon
 * as nothing is going on in it, null never. Off until asked for: removing a
 * folder also takes what Git ignores in it, like a hand-copied `.env`.
 */
export const DEFAULT_WORKTREE_CLEANUP_DAYS: number | null = null;
export interface AgentWorktree {
  path: string;
  branch?: string;
  /** Git's stable worktree metadata name, retained when the folder moves. */
  gitdir?: string;
  pr?: { number: number; url: string };
  /** When Relay first saw it. */
  at: number;
}

/** The user's chosen worktree; retained if it disappears so actions cannot fall back to the checkout. */
export type ActiveAgentWorktree = Pick<
  AgentWorktree,
  "path" | "gitdir" | "branch"
> & {
  /** Relay moved the thread in after its agent made it; once that worktree is gone the thread goes back to the project folder. */
  followed?: true;
};
/**
 * The folder a thread works in changed after it started: it moved into a
 * worktree of its own, its removed worktree was made again, it switched
 * between the project folder and a worktree its agent made, or it moved to
 * another project.
 */
export interface WorkspaceMove {
  at: number;
  /** The main conversation's last message before it; its line shows under that one. */
  after?: string;
  how: "moved" | "recreated" | "switched" | "project";
  /** The folder it works in from here on; unset for the project folder. */
  to?: string;
  /** The name of the project it moved to. */
  project?: string;
  branch?: string;
  /** Recreated from the project folder on a new branch; the old one couldn't be checked out again. */
  fresh?: true;
  /** The agent did it, or Relay did on its own; only these get the unseen dot. */
  unasked?: true;
  /** The agent that did it, when one did. */
  by?: AgentProvider;
}
/**
 * Where a deep review reads and fixes the reviewed code when the project's
 * checkout doesn't have it; `prNumber` is the pull request it holds,
 * detached until a fix gives it a branch.
 */
export type ReviewFolder = Pick<ReviewCheckout, "path" | "branch"> & {
  prNumber?: number;
};
type ThreadWorkspace = {
  worktree?: ChatWorktree;
  agentWorktrees?: AgentWorktree[];
  activeAgentWorktree?: ActiveAgentWorktree;
  /** On summaries; the full thread has it as the latest checkout a round made. */
  reviewFolder?: ReviewFolder;
  reviews?: { scope: { checkout?: ReviewCheckout } }[];
};

export const reviewFolder = (
  chat: ThreadWorkspace | undefined,
): ReviewFolder | undefined => {
  if (chat?.reviewFolder) return chat.reviewFolder;
  const checkout = chat && workingReview(chat)?.scope.checkout;
  return (
    checkout && {
      path: checkout.path,
      ...(checkout.branch ? { branch: checkout.branch } : {}),
      ...(checkout.pr ? { prNumber: checkout.pr.number } : {}),
    }
  );
};

/** What a review's folder has checked out, for a branch label: its branch, or the pull request it holds detached. */
export const reviewFolderLabel = (folder: ReviewFolder | undefined) =>
  folder?.branch ?? (folder?.prNumber ? `PR #${folder.prNumber}` : undefined);

export const agentWorktreeKey = (worktree: ActiveAgentWorktree) =>
  worktree.gitdir ?? worktree.path;

export function selectedAgentWorktree(chat: ThreadWorkspace | undefined) {
  const selected = chat?.activeAgentWorktree;
  return (
    selected &&
    chat?.agentWorktrees?.find((w) =>
      selected.gitdir ? w.gitdir === selected.gitdir : w.path === selected.path,
    )
  );
}

/** Why a send or action refuses while `agentWorktreeUnavailable`; phones match it to offer the project folder. */
export const agentWorktreeUnavailableError =
  "The selected worktree is unavailable. Choose another workspace.";

export const agentWorktreeUnavailable = (chat: ThreadWorkspace | undefined) =>
  !chat?.worktree &&
  !!chat?.activeAgentWorktree &&
  !selectedAgentWorktree(chat);

/** The folder a thread's Git, files, terminal and agent follow. */
export function threadWorktree(chat: ThreadWorkspace | undefined) {
  const review = reviewFolder(chat);
  if (review) return review;
  if (chat?.worktree)
    return chat.worktree.path && !chat.worktree.removedAt
      ? chat.worktree
      : undefined;
  return selectedAgentWorktree(chat) ?? chat?.activeAgentWorktree;
}
export interface WorktreeStatus {
  branch?: string;
  /** Its `relay/…` branch waits for the thread's title to be named after it. */
  naming?: true;
  path?: string;
  /** The branch it merges into. */
  from?: string;
  /** What it has that `from` doesn't yet, committed or not. */
  files: TurnFileChange[];
  /** Relay's Merge landed its branch in `from`, or its PR was merged. */
  landed?: { by: "merge" | "pr" };
  pr?: ChatWorktree["pr"];
  removed: boolean;
  /** Removed after the thread settled, its branch kept; see `ChatWorktree.cleanedUp`. */
  cleanedUp?: true;
  /** It carries on a branch that was there before it, which removing it keeps. */
  existing?: true;
  /** A folder Relay didn't make, which it never removes; see `ChatWorktree.adopted`. */
  adopted?: true;
}
/** The branch a new thread's worktree would be made on, and why it can't, if it can't. */
export interface WorktreeBranch {
  branch: string;
  problem?: string;
}
/** Every uncommitted edit in the project folder, with the other threads whose turns changed each. */
export interface WorktreeMove {
  blocked?: string;
  files: (TurnFileChange & { threads?: string[] })[];
}
