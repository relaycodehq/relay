import type {
  ChatWorktree,
  ProjectChat,
  WorktreeBranch,
  WorktreeStatus,
} from "../../shared/projects";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import { promptTitle } from "../agents/thread-titles";
import {
  branchKept,
  cantCarryOn,
  checkedOutAt,
  copyIntoWorktree,
  createWorktree,
  fetchStart,
  localBranchName,
  moveIntoWorktree,
  newBranchProblem,
  reattachWorktree,
  recreateWorktree,
  removeWorktree,
  retitleWorktree,
  sameFolder,
  uncommitted,
  worktreeChanges,
  worktreeDiff,
  worktreeExists,
} from "../git/worktrees";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere, awaitsReturn } from "./handoff";
import { chatSummary } from "./storage";
import { WorktreeSetup } from "./worktree-setup";
import {
  agentWorktreeKey,
  agentWorktreeUnavailableError,
  joinableWorktrees,
  joinedWorktree,
  reviewFolder,
  selectedAgentWorktree,
  sharedWith,
  threadsSharing,
  threadWorktree,
} from "../../shared/projects";
import {
  activeAfter,
  followAgentWorkspace,
  recoverAgentWorktrees,
  threadWorktreePaths,
} from "./agent-worktrees";
import { sentAgent } from "../../shared/recipient";
import { keyedQueue } from "../util/keyed-queue";
import { noteWorkspaceMove } from "../../shared/workspace-moves";

/** What an agent asks for when it moves its thread into a worktree. */
export interface WorktreeRequest {
  branch?: string;
  uncommitted?: boolean;
}

/** Where a thread works: the project's checkout, or a worktree of its own. */
/**
 * What a worktree gone with its branch is made again from. One that carried
 * on a branch gets a `relay/…` one of its own, named after the thread, not
 * after the folder the lost branch named; one made off a branch goes off it
 * again.
 */
function regrown(worktree: ChatWorktree): ChatWorktree {
  if (worktree.existing)
    return {
      ...worktree,
      path: undefined,
      named: undefined,
      existing: undefined,
    };
  if (worktree.startedOff)
    return { ...worktree, startFrom: { off: worktree.startedOff } };
  return worktree;
}

/**
 * The open thread on `name` whose worktree another thread can join: the
 * folder Git has the branch checked out in now, not only its record, which
 * a folder removed by hand, or switched to another branch by its agent,
 * outlives. A remote `origin/…` means its local twin when there is one.
 */
export async function joinableOn<
  T extends Pick<ProjectChat, "id" | "worktree" | "archivedAt" | "sentTo">,
>(root: string, chats: readonly T[], name: string) {
  const branch = await localBranchName(root, name);
  const at = await checkedOutAt(root, branch);
  if (!at) return;
  for (const c of joinableWorktrees(chats))
    if (
      c.worktree!.branch === branch &&
      (await sameFolder(c.worktree!.path!, at))
    )
      return c;
}

export class ThreadWorktrees {
  readonly setup: WorktreeSetup;
  private refreshed = new Map<string, { at: number; pending: Promise<void> }>();
  /** Worktree changes per repository root; see `inRepo`. */
  private making = keyedQueue();
  /** Threads whose first message just made their worktree; nothing runs in it until it's named. */
  readonly unnamed = new Set<string>();
  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    readonly folder: string,
    private councils: Pick<Councils, "busy" | "root">,
  ) {
    this.setup = new WorktreeSetup(core);
  }

  /** Reconcile on reads too: old chats can have missed the event that made or moved their worktree. */
  async refreshAgentWorktrees(chat: ProjectChat, force = false) {
    if (chat.worktree || chat.scope.kind !== "project") return;
    // Its checkout is on the computer the project lives on.
    if (this.core.projects.get(chat.projectId).computer) return;
    const prior = this.refreshed.get(chat.id);
    if (prior && !force && Date.now() - prior.at < 5000) return prior.pending;
    if (prior) await prior.pending;
    const pending = (async () => {
      // Git can be unavailable while the conversation itself remains readable.
      const worktrees = await this.core.projects
        .root(chat.projectId)
        .then((root) =>
          recoverAgentWorktrees(
            root,
            threadWorktreePaths(this.core.store.get().chats),
            chat,
          ),
        )
        .catch((error) => {
          if (force) throw error;
          return undefined;
        });
      if (!worktrees) return;
      const active = activeAfter(chat, worktrees);
      if (
        JSON.stringify(worktrees) ===
          JSON.stringify(chat.agentWorktrees ?? []) &&
        JSON.stringify(active) === JSON.stringify(chat.activeAgentWorktree)
      )
        return;
      if (worktrees.length) chat.agentWorktrees = worktrees;
      else delete chat.agentWorktrees;
      followAgentWorkspace(chat, active);
      await this.core.storage.save(chat);
    })().catch((error) => {
      this.refreshed.delete(chat.id);
      throw error;
    });
    this.refreshed.set(chat.id, { at: Date.now(), pending });
    await pending;
  }

  /** Where a thread's agent works: its worktree, made with its first message, the reviewed code's for a review, or the checkout. */
  async root(
    chat: ProjectChat,
    prompt?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const review = await this.councils.root(chat);
    if (review) return review;
    const root = await this.core.projects.root(chat.projectId);
    const worktree = chat.worktree;
    if (!worktree) {
      await this.refreshAgentWorktrees(chat);
      if (!chat.activeAgentWorktree) return root;
      const selected = selectedAgentWorktree(chat);
      if (!selected || !(await worktreeExists(selected)))
        throw new Error(agentWorktreeUnavailableError);
      return selected.path;
    }
    if (await worktreeExists(worktree)) return worktree.path!;
    // Outside the repository's queue: a slow remote mustn't hold up every
    // other thread's worktree there.
    await fetchStart(root, regrown(worktree).startFrom, signal);
    return this.inRepo(root, () => this.remake(chat, root, prompt));
  }

  /**
   * Makes `chat`'s worktree, with its first message or again once it's gone,
   * in the repository's queue: another thread may have made or lent it
   * meanwhile, so it reads the thread's record again first. A remote
   * branch it starts from was fetched before.
   */
  private async remake(chat: ProjectChat, root: string, prompt?: string) {
    const saved = await this.core.storage.load(chat.id).catch(() => undefined);
    if (saved && saved !== chat && saved.worktree)
      chat.worktree = saved.worktree;
    const worktree = chat.worktree!;
    if (await worktreeExists(worktree)) return worktree.path!;
    const first = !worktree.path;
    const sharers = this.sharers(chat);
    const name = promptTitle(prompt ?? chat.title);
    // A branch picked to carry on goes wherever it can be had now, and so
    // does one whose found folder went, or that's checked out elsewhere by
    // the time the thread carries it on again.
    let carry =
      first && worktree.startFrom && "on" in worktree.startFrom
        ? worktree.startFrom.on
        : worktree.adopted
          ? worktree.branch
          : undefined;
    const reattached = carry
      ? undefined
      : await reattachWorktree(root, worktree).catch((error: unknown) => {
          if (!worktree.existing || !worktree.branch) throw error;
          carry = worktree.branch;
          return undefined;
        });
    chat.worktree =
      reattached ??
      (carry
        ? await this.carriedOn(chat, root, carry, name)
        : await createWorktree(
            root,
            this.folder,
            name,
            regrown(worktree),
            false,
          ));
    // Only a branch Relay picked waits for the title; the user's keeps its name.
    if (first && !chat.worktree.named) this.unnamed.add(chat.id);
    if (!first)
      noteWorkspaceMove(chat, {
        how: "recreated",
        to: chat.worktree.path!,
        ...(chat.worktree.branch ? { branch: chat.worktree.branch } : {}),
        ...(reattached || (carry && chat.worktree.branch === carry)
          ? {}
          : { fresh: true as const }),
        unasked: true,
      });
    await this.core.storage.save(chat);
    // The threads sharing the folder work in it where it's made again, on
    // what it is now: a new branch, say, counting from another point. The
    // repository's queue keeps their records, not their threads' controls,
    // which a turn holding one while it waits for the queue would deadlock.
    const shared = joinedWorktree(chat.worktree);
    for (const other of sharers) {
      const them = await this.core.storage.load(other.id);
      if (!them.worktree) continue;
      const offset = shared.portOffset ?? them.worktree.portOffset;
      them.worktree = {
        ...shared,
        ...(offset !== undefined ? { portOffset: offset } : {}),
      };
      await this.core.storage.save(them);
    }
    return chat.worktree.path!;
  }

  /**
   * Runs what makes, moves, lends, joins or removes a worktree in `root`'s
   * repository one at a time, so two threads never pick the same folder or
   * branch, nor one take back a folder another is lending it or joining.
   */
  inRepo<T>(root: string, job: () => Promise<T>) {
    return this.making(root, job);
  }

  /** The other open threads working in this thread's worktree folder. */
  private sharers(chat: Pick<ProjectChat, "id" | "worktree">) {
    return threadsSharing(this.core.store.get().chats ?? [], chat);
  }

  /**
   * Everyone else working in the thread's worktree folder: the open threads
   * sharing it, and the open reviews that followed their branch into it,
   * fixes and all. While there are any, the folder stays.
   */
  private async users(chat: Pick<ProjectChat, "id" | "worktree">) {
    const chats = this.core.store.get().chats ?? [];
    const sharing = threadsSharing(chats, chat);
    const path = chat.worktree?.path;
    if (!path || chat.worktree!.removedAt) return sharing;
    const reviews: typeof chats = [];
    for (const c of chats) {
      const folder = reviewFolder(c);
      if (!folder || c.id === chat.id || c.archivedAt || sharing.includes(c))
        continue;
      if (await sameFolder(folder.path, path)) reviews.push(c);
    }
    return [...sharing, ...reviews];
  }

  /** Why the thread's worktree folder stays when the thread lets go of it, if it does. */
  private async stays(
    chat: ProjectChat,
  ): Promise<
    { adopted?: true; users: readonly { title: string }[] } | undefined
  > {
    if (chat.worktree?.adopted) return { adopted: true, users: [] };
    const users = await this.users(chat);
    return users.length ? { users } : undefined;
  }

  /**
   * The worktree a thread carrying on `branch` works in: the folder of an
   * open thread on it, shared; the folder it's checked out in already, unless
   * that's an away thread's; a worktree of its own, which threads keeping the branch for their next
   * message work in too; or, when only checking it out is in the way, a new
   * branch off it. Never a refusal: a branch gone meanwhile goes off the
   * checkout's commit, and the thread says so.
   */
  private async carriedOn(
    chat: ProjectChat,
    root: string,
    branch: string,
    name: string,
  ): Promise<ChatWorktree> {
    const others = (this.core.store.get().chats ?? []).filter(
      (c) => c.id !== chat.id && c.projectId === chat.projectId,
    );
    const open = await joinableOn(root, others, branch);
    if (open)
      return joinedWorktree((await this.core.storage.load(open.id)).worktree!);
    // Threads' records have local names; `origin/feature` is their `feature`.
    const local = await localBranchName(root, branch);
    // A thread away on another computer holds its folder for the work
    // landing there once it's back; nothing else works in it meanwhile.
    const away = others.find(
      (c) =>
        !c.archivedAt &&
        c.sentTo &&
        c.worktree?.branch === local &&
        !!c.worktree.path &&
        !c.worktree.removedAt &&
        !c.worktree.cleanedUp,
    );
    if (away) {
      const off = await createWorktree(
        root,
        this.folder,
        name,
        { startFrom: { off: branch } },
        false,
      );
      return off.wanted
        ? off
        : {
            ...off,
            wanted: {
              branch,
              problem: `“${away.title}” is away on ${away.sentTo!.computer} with it, so the thread is on a new branch off it.`,
            },
          };
    }
    const made = await createWorktree(
      root,
      this.folder,
      name,
      { startFrom: { on: branch } },
      false,
    );
    if (made.branch !== local || made.adopted) return made;
    // Whoever kept the branch for its next message finds it here, the
    // same folder for both, rather than wanting it back on its own. Not a
    // thread away on another computer, whose work lands here once it's
    // back, nor a copy left from an earlier trip, which passed its folder on.
    const keeping = others.filter(
      (c) =>
        !c.archivedAt &&
        !c.sentTo &&
        !c.cameFrom?.returnedAt &&
        !!c.worktree?.path &&
        c.worktree.branch === local,
    );
    // In the repository's queue, which `root` runs this in, rather than
    // under their controls; see `remake`.
    for (const other of keeping) {
      const them = await this.core.storage.load(other.id);
      const theirs = them.worktree;
      if (theirs?.branch !== local || (await worktreeExists(theirs))) continue;
      const {
        removedAt: _removed,
        cleanedUp: _cleaned,
        included: _included,
        adopted: _adopted,
        portOffset: _offset,
        ...kept
      } = theirs;
      // This thread runs the folder's setup; one run serves both, and
      // whichever sends first waits for it.
      them.worktree = { ...kept, path: made.path, setup: "done" };
      noteWorkspaceMove(them, {
        how: "recreated",
        to: made.path,
        branch: local,
        unasked: true,
      });
      await this.core.storage.save(them);
    }
    return made;
  }

  /**
   * Makes `chat`'s worktree now rather than with its first message: at the
   * commit `source` is on, with a copy of what `source` hasn't committed,
   * on `branch` when the user named one. Resolves to how many files came along.
   */
  async copyFrom(
    chat: ProjectChat,
    source: string,
    prompt: string,
    branch?: string,
  ) {
    const { worktree, copied } = await this.copyFor(
      chat,
      source,
      prompt,
      branch,
    );
    chat.worktree = worktree;
    await this.core.storage.save(chat);
    return copied;
  }

  /** `copyFrom`'s worktree, for a chat not saved yet; it stays the caller's to keep. */
  async copyFor(
    chat: Pick<ProjectChat, "id" | "projectId">,
    source: string,
    prompt: string,
    branch?: string,
  ) {
    const root = await this.core.projects.root(chat.projectId);
    return this.inRepo(root, () =>
      copyIntoWorktree(
        root,
        this.folder,
        promptTitle(prompt),
        source,
        chat.id,
        branch,
      ),
    );
  }

  /** Why `branch` can't be made for a new thread's worktree, if it can't. */
  async branch(projectId: string, branch: string): Promise<WorktreeBranch> {
    const root = await this.core.projects.root(projectId);
    const problem = await newBranchProblem(root, branch);
    return problem ? { branch, problem } : { branch };
  }

  /**
   * Moves the worktree the first message made to a folder and branch named
   * after the thread's title, before its setup or agent runs there. Resolves
   * to where the agent works.
   */
  async named(chat: ProjectChat) {
    const worktree = chat.worktree;
    if (!this.unnamed.delete(chat.id) || !worktree?.path) return worktree?.path;
    // Another thread works there already: moving it would pull the folder from under it.
    if ((await this.users(chat)).length) return worktree.path;
    const root = await this.core.projects.root(chat.projectId);
    const moved = await this.inRepo(root, () =>
      retitleWorktree(root, worktree, chat.title),
    ).catch((error: unknown) => {
      // A worktree with submodules, say, can't move; the message's name stays.
      console.warn("Could not name the worktree after the title:", error);
      return undefined;
    });
    if (!moved) return worktree.path;
    if (chat.branch === worktree.branch) chat.branch = moved.branch;
    Object.assign(worktree, moved);
    await this.core.storage.save(chat);
    return moved.path;
  }

  /**
   * The copy an earlier trip of a thread left here on `branch`, once it went
   * back, for the thread arriving again at `tip` to carry on in; or why it
   * can't, when that copy has work of its own. Undefined when no such copy
   * holds the branch.
   */
  async returnedCopy(
    projectId: string,
    branch: string,
    tip: string,
  ): Promise<
    { id: string; worktree: ChatWorktree } | { problem: string } | undefined
  > {
    // The latest trip's copy: an earlier one handed its folder on to it.
    const copy = (this.core.store.get().chats ?? [])
      .filter(
        (c) =>
          c.projectId === projectId &&
          c.cameFrom?.returnedAt &&
          !c.cameFrom.abandonedAt &&
          c.worktree?.branch === branch,
      )
      .sort((a, b) => b.cameFrom!.returnedAt! - a.cameFrom!.returnedAt!)[0];
    if (!copy?.worktree) return;
    const root = await this.core.projects.root(projectId);
    if (await newBranchProblem(root, branch).then((p) => !p)) return;
    const why = await cantCarryOn(root, copy.worktree, tip);
    if (why)
      return {
        problem: `“${copy.title}”, from its last trip here, still holds it, and ${why}.`,
      };
    return { id: copy.id, worktree: copy.worktree };
  }

  /** A returned copy's worktree went on to the thread arriving again; the copy keeps its conversation. */
  async passedOn(id: string) {
    await this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      if (!chat.worktree) return;
      chat.worktree.removedAt = Date.now();
      delete chat.worktree.cleanedUp;
      await this.core.storage.save(chat);
    });
  }

  private async of(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.worktree)
      throw new Error("This thread works in the project's checkout.");
    return { chat, worktree: chat.worktree };
  }

  /** The worktrees a project's threads work in, for its process list. */
  folders(projectId: string) {
    return (this.core.store.get().chats ?? []).flatMap((chat) => {
      const worktree = threadWorktree(chat);
      return chat.projectId === projectId && worktree?.path
        ? [{ path: worktree.path, chatId: chat.id }]
        : [];
    });
  }

  /** An agent is working in the project's checkout; worktree threads don't count. */
  checkoutBusy(projectId: string) {
    // Reviewer threads count too, though the sidebar never lists them.
    return (this.core.store.get().chats ?? []).some(
      (chat) =>
        chat.projectId === projectId &&
        !chat.worktree &&
        !threadWorktree(chat) &&
        this.core.active.has(chat.id),
    );
  }

  /** What the worktree has that the branch it came from doesn't, and whether it all got there. */
  async status(id: string): Promise<WorktreeStatus> {
    const { worktree } = await this.of(id);
    const exists = await worktreeExists(worktree);
    const changes = exists ? await worktreeChanges(worktree) : null;
    // Only what Relay saw land counts: a branch that caught up with `from`
    // looks the same in Git as one that was merged into it.
    const by = worktree.landed?.by;
    const merged = by === "pr" || by === "merge" ? by : undefined;
    return {
      ...(worktree.branch ? { branch: worktree.branch } : {}),
      ...(this.unnamed.has(id) && this.core.active.has(id)
        ? { naming: true as const }
        : {}),
      ...(worktree.path ? { path: worktree.path } : {}),
      ...(worktree.from ? { from: worktree.from } : {}),
      files: changes?.files ?? [],
      ...(merged ? { landed: { by: merged } } : {}),
      ...(worktree.pr ? { pr: worktree.pr } : {}),
      removed: !!worktree.path && !exists,
      ...(worktree.cleanedUp && !exists ? { cleanedUp: true as const } : {}),
      ...(worktree.existing ? { existing: true as const } : {}),
      ...(worktree.adopted ? { adopted: true as const } : {}),
    };
  }

  /** An archived thread's worktree whose changes all reached the checkout has nothing left to keep. */
  async dropLanded(chat: ProjectChat, now: number) {
    if (!chat.worktree || !(await worktreeExists(chat.worktree))) return;
    // Others still work in it: archiving this one leaves it to them.
    if (awaitsReturn(chat) || (await this.stays(chat))) return;
    const status = await this.status(chat.id).catch(() => null);
    if (status && !status.files.length)
      await this.drop(chat, chat.worktree, { at: now }).catch((e: unknown) =>
        console.warn("Could not remove a landed thread's worktree:", e),
      );
  }

  /**
   * An archived thread's worktree its user chose to delete, work in it or
   * not: the folder goes, a snapshot kept, and its branch stays, so undoing
   * the archive or a next message checks it out again.
   */
  async dropArchived(chat: ProjectChat) {
    if (!chat.worktree || !(await worktreeExists(chat.worktree))) return;
    if (awaitsReturn(chat) || (await this.stays(chat))) return;
    this.core.sessions.close(chat.id);
    await this.drop(chat, chat.worktree, { keepBranch: true });
  }

  async diff(id: string, path: string) {
    const { worktree } = await this.of(id);
    if (!(await worktreeExists(worktree)))
      throw new Error("This thread's worktree was removed.");
    return worktreeDiff(worktree, path);
  }

  /** Removes the worktree and stops what runs in it; the next message makes a new one. */
  remove(id: string) {
    return this.core.control(id, async () => {
      const { chat, worktree } = await this.of(id);
      if (awaitsReturn(chat))
        throw new Error(
          `Hand this thread back first; ${chat.cameFrom!.computer} is waiting for it.`,
        );
      const kept = await this.stays(chat);
      if (kept?.adopted)
        throw new Error(
          "Relay didn't make this worktree, so it stays; remove it yourself once you're done with it.",
        );
      await this.core.active.assertIdle(id);
      const others = kept?.users ?? [];
      if (others.length)
        throw new Error(
          `${sharedWith(others)} ${others.length === 1 ? "works" : "work"} in this worktree too, so it stays; archive the others first.`,
        );
      if (!(await this.drop(chat, worktree)))
        throw new Error(
          "Another thread started working in this worktree meanwhile, so it stays.",
        );
    });
  }

  /**
   * Removes a settled thread's worktree but keeps its branch, once `kept`,
   * asked again in the thread's turn, finds nothing in the way. Returns why
   * it stayed, if it did.
   */
  cleanUp(
    id: string,
    kept: (chat: ProjectChat) => Promise<string | undefined>,
  ) {
    return this.core.control(id, async () => {
      const { chat, worktree } = await this.of(id);
      const stays = await this.stays(chat);
      if (stays?.adopted) return "not a worktree Relay made";
      if (stays) return "another thread works in it";
      const why = await kept(chat);
      if (why) return why;
      // Idle agent processes started in the folder; the next message resumes their sessions.
      this.core.sessions.close(id);
      if (!(await this.drop(chat, worktree, { keepBranch: true })))
        return "another thread works in it";
    });
  }

  /**
   * Removes the thread's worktree folder, unless Relay didn't make it or
   * someone else works in it, asked again in the repository's queue right
   * before it goes: a thread joining or adopting the folder does so there
   * too, so whichever comes second sees the other. What runs in it stops
   * first, outside the queue. Resolves to whether the folder went; when it
   * stays, the thread just lets go of it, as a shared one does.
   */
  private async drop(
    chat: ProjectChat,
    worktree: ChatWorktree,
    { keepBranch = false, at }: { keepBranch?: boolean; at?: number } = {},
  ) {
    if (await this.stays(chat)) return false;
    if (worktree.path) {
      threadTerminals.closeWithin(worktree.path);
      await projectTasks.stopWithin(worktree.path);
    }
    await this.setup.teardown(chat, worktree);
    const root = await this.core.projects.root(chat.projectId);
    return this.inRepo(root, async () => {
      if (await this.stays(chat)) return false;
      await removeWorktree(root, chat.id, worktree, { keepBranch });
      worktree.removedAt = at ?? Date.now();
      if (keepBranch) worktree.cleanedUp = true;
      await this.core.storage.save(chat);
      return true;
    });
  }

  /** Why a checkout thread can't move into a worktree now, if it can't. */
  private async moveBlocked(chat: ProjectChat) {
    if (chat.worktree) return "This thread already has its own worktree.";
    if (chat.scope.kind !== "project" || chat.reviewer)
      return "Only repository threads can work in a worktree.";
    if ((await this.core.projects.inspect(chat.projectId)).plain)
      return "Worktrees need a Git repository.";
    await this.core.active.finished(chat.id);
    if (this.core.active.has(chat.id) || this.councils.busy(chat))
      return "Wait for the answer to finish first.";
    if (this.core.sessions.pending(chat.id).length || chat.heldWakeups?.length)
      return "Claude left background work or a wake-up in this thread. Stop it first.";
    const busy = (this.core.store.get().chats ?? []).find(
      (c) =>
        c.id !== chat.id &&
        c.projectId === chat.projectId &&
        !c.worktree &&
        this.core.active.has(c.id),
    );
    if (busy)
      return `“${busy.title}” is working in the project folder. Wait for it to finish first.`;
  }

  /**
   * What moving the thread into its own worktree would take: every
   * uncommitted edit in the project folder, each with the other threads
   * whose turns changed it.
   */
  async movePreview(id: string) {
    const chat = await this.core.storage.load(id);
    const blocked = await this.moveBlocked(chat);
    if (blocked) return { blocked, files: [] };
    const { files } = await uncommitted(
      await this.core.projects.root(chat.projectId),
    );
    const touched = new Map<string, string[]>();
    const others = (this.core.store.get().chats ?? []).filter(
      (c) =>
        c.id !== id &&
        c.projectId === chat.projectId &&
        !c.worktree &&
        !c.archivedAt &&
        !c.empty,
    );
    for (const other of others) {
      const paths = new Set(
        (await this.core.storage.load(other.id)).messages.flatMap(
          (m) => m.changes?.map((f) => f.path) ?? [],
        ),
      );
      for (const path of paths)
        touched.set(path, [...(touched.get(path) ?? []), other.title]);
    }
    return {
      files: files.map((f) => {
        const threads = touched.get(f.path);
        return threads ? { ...f, threads } : f;
      }),
    };
  }

  /**
   * Moves a checkout thread into a worktree of its own, taking every
   * uncommitted edit in the project folder with it. Its agents carry on in
   * their sessions there, told once where they are now.
   */
  move(id: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const blocked = await this.moveBlocked(chat);
      if (blocked) throw new Error(blocked);
      this.core.projects.assertCheckoutAvailable(chat.projectId);
      const root = await this.core.projects.root(chat.projectId);
      chat.worktree = await this.inRepo(root, () =>
        moveIntoWorktree(root, this.folder, chat.title, id),
      );
      chat.movedIn = {
        from: root,
        to: chat.worktree.path!,
        owed: Object.keys(chat.scopeHeard ?? {}),
      };
      noteWorkspaceMove(chat, {
        how: "moved",
        to: chat.worktree.path!,
        ...(chat.worktree.branch ? { branch: chat.worktree.branch } : {}),
      });
      // Live sessions started in the project folder; resumed, they start in the worktree.
      this.core.sessions.close(id);
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /**
   * Moves a project-folder thread into a worktree of its own while its agent
   * answers, at the agent's asking: from the checkout's commit, with a copy
   * of its uncommitted edits when `uncommitted`. Unlike `move`, the project
   * folder keeps its edits, since other threads may be at work there. The
   * agent runs the project's setup itself, as nothing else may run in the
   * middle of its answer.
   */
  enter(id: string, { branch, uncommitted: copy }: WorktreeRequest) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      if (chat.worktree)
        throw new Error(
          chat.worktree.path && !chat.worktree.removedAt
            ? `This thread already works in its own worktree, ${chat.worktree.path}${chat.worktree.branch ? ` on ${chat.worktree.branch}` : ""}.`
            : "This thread already has its own worktree.",
        );
      if (chat.scope.kind !== "project" || chat.reviewer)
        throw new Error("Only repository threads can work in a worktree.");
      if ((await this.core.projects.inspect(chat.projectId)).plain)
        throw new Error("Worktrees need a Git repository.");
      if (chat.activeAgentWorktree)
        throw new Error(
          `This thread works in ${chat.activeAgentWorktree.path}, a worktree it made earlier. The user can switch it back to the project folder first.`,
        );
      const root = await this.core.projects.root(chat.projectId);
      const problem = branch && (await newBranchProblem(root, branch));
      if (problem) throw new Error(problem);
      const { worktree, copied } = await this.inRepo(root, async () =>
        copy
          ? await copyIntoWorktree(
              root,
              this.folder,
              chat.title,
              root,
              id,
              branch,
            )
          : {
              worktree: await createWorktree(
                root,
                this.folder,
                chat.title,
                branch ? { named: branch } : undefined,
              ),
              copied: 0,
            },
      );
      const { included: _, ...made } = worktree;
      chat.worktree = { ...made, setup: "done" };
      chat.branch = made.branch;
      delete chat.commit;
      // The agent that asked knows; the thread's other agents hear it next time.
      const active = this.core.active.get(id);
      const caller = active?.input ?? chat.lastInput;
      const asker = caller ? `${sentAgent(caller)}:main` : undefined;
      const owed = Object.keys(chat.scopeHeard ?? {}).filter(
        (key) => key !== asker,
      );
      noteWorkspaceMove(chat, {
        how: "moved",
        to: made.path,
        ...(made.branch ? { branch: made.branch } : {}),
        unasked: true,
        ...(caller ? { by: sentAgent(caller) } : {}),
      });
      if (owed.length)
        chat.movedIn = {
          from: root,
          to: made.path,
          owed,
          ...(copy ? { copied: true as const } : { fresh: true as const }),
        };
      await this.core.storage.save(chat);
      await active?.moved?.(made.path);
      const setup = this.setup.command(chat);
      const env = await this.setup.env(chat);
      return {
        folder: made.path,
        branch: made.branch,
        ...(made.from ? { from: made.from } : {}),
        ...(copy ? { uncommittedFilesCopied: copied } : {}),
        ...(setup ? { setupCommand: setup } : {}),
        ...(Object.keys(env).length ? { environment: env } : {}),
      };
    });
  }

  /** Where the thread's terminal opens: its worktree, or the project's checkout. */
  async terminalFolder(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    // A review's fixes, and the files its answers changed, are in its folder.
    const review = await this.councils.root(chat);
    if (review) return review;
    const worktree = chat.worktree;
    if (!worktree) {
      await this.refreshAgentWorktrees(chat);
      if (!chat.activeAgentWorktree) return this.core.projects.root(projectId);
      const agent = selectedAgentWorktree(chat);
      if (!agent || !(await worktreeExists(agent)))
        throw new Error(agentWorktreeUnavailableError);
      return agent.path!;
    }
    if (
      worktree.removedAt ||
      (worktree.path && !(await worktreeExists(worktree)))
    )
      throw new Error("This thread's worktree was removed.");
    if (!worktree.path)
      throw new Error("This thread's worktree is made with its first message.");
    return worktree.path;
  }

  async worksInCheckout(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    await this.refreshAgentWorktrees(chat);
    return (
      chat.projectId === projectId && !chat.worktree && !threadWorktree(chat)
    );
  }

  /** Only paths Relay saw the thread's agent make, so the renderer can't open any folder. */
  async agentWorktreePath(id: string, path: string) {
    const chat = await this.core.storage.load(id);
    const worktree = chat.agentWorktrees?.find((w) => w.path === path);
    if (!worktree) throw new Error("This thread didn't make that worktree.");
    return worktree.path;
  }

  /** A project-folder thread that is idle enough to change where it works. */
  private async switchable(id: string) {
    const chat = await this.core.storage.load(id);
    assertHere(chat);
    if (chat.worktree || chat.scope.kind !== "project" || chat.reviewer)
      throw new Error(
        "Only project-folder threads can select an agent worktree.",
      );
    await this.core.active.finished(id);
    if (
      this.core.active.has(id) ||
      this.core.active.hasSide(id) ||
      this.councils.busy(chat)
    )
      throw new Error(
        "Wait for the answer to finish before changing workspace.",
      );
    if (this.core.sessions.pending(id).length || chat.heldWakeups?.length)
      throw new Error(
        "Stop this thread's background work and wake-ups before changing workspace.",
      );
    await this.refreshAgentWorktrees(chat, true);
    return chat;
  }

  /** Changes only the working folder. Files and branches stay where they are. */
  selectAgentWorktree(id: string, path: string | null) {
    return this.core.control(id, async () => {
      const chat = await this.switchable(id);
      const selected =
        path === null
          ? undefined
          : chat.agentWorktrees?.find((w) => w.path === path);
      if (path !== null && (!selected || !(await worktreeExists(selected))))
        throw new Error(
          "This thread didn't make that worktree, or it is unavailable.",
        );
      if (
        (!selected && !chat.activeAgentWorktree) ||
        (selected &&
          chat.activeAgentWorktree &&
          agentWorktreeKey(selected) ===
            agentWorktreeKey(chat.activeAgentWorktree))
      )
        return chatSummary(chat);
      const root = await this.core.projects.root(chat.projectId);
      const from = threadWorktree(chat)?.path ?? root;
      if (selected)
        chat.activeAgentWorktree = {
          path: selected.path,
          gitdir: selected.gitdir,
          branch: selected.branch,
        };
      else delete chat.activeAgentWorktree;
      chat.movedIn = {
        from,
        to: selected?.path ?? root,
        owed: Object.keys(chat.scopeHeard ?? {}),
        selected: true,
      };
      noteWorkspaceMove(chat, {
        how: "switched",
        ...(selected ? { to: selected.path } : {}),
        ...(selected?.branch ? { branch: selected.branch } : {}),
      });
      this.core.sessions.close(id);
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /** Whether the deleted worktree a thread still has selected can be made again: its branch is still there. */
  async agentWorktreeRecreatable(id: string) {
    const chat = await this.core.storage.load(id);
    const gone = chat.activeAgentWorktree;
    if (!gone?.branch || selectedAgentWorktree(chat)) return false;
    return branchKept(await this.core.projects.root(chat.projectId), gone.branch);
  }

  /** Makes the deleted worktree a thread still has selected again, from its branch, and carries on there. */
  recreateAgentWorktree(id: string) {
    return this.core.control(id, async () => {
      const chat = await this.switchable(id);
      const gone = chat.activeAgentWorktree;
      if (!gone || selectedAgentWorktree(chat)) return chatSummary(chat);
      if (!gone.branch)
        throw new Error(
          "Relay never saw this worktree's branch, so it can't make it again.",
        );
      const root = await this.core.projects.root(chat.projectId);
      const made = await this.inRepo(root, () =>
        recreateWorktree(root, gone.path, gone.branch!),
      );
      chat.agentWorktrees = [
        ...(chat.agentWorktrees ?? []).filter((w) => w.path !== made.path),
        { ...made, at: Date.now() },
      ];
      chat.activeAgentWorktree = {
        ...made,
        ...(gone.followed ? { followed: true as const } : {}),
      };
      noteWorkspaceMove(chat, {
        how: "recreated",
        to: made.path,
        branch: gone.branch,
      });
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /** A thread's worktree folder, or its review's, for a workspace id; only while it exists, though a review's falls back to the checkout. */
  async rootFor(projectId: string, id: string, expectedWorktree?: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    // Panes poll this, so a review folder already cleaned up isn't made
    // again just by looking; the thread reads the checkout until a turn or
    // its terminal makes it.
    const review = await this.councils.root(chat, false);
    if (review) return review;
    if (reviewFolder(chat) || chat.reviewer)
      return this.core.projects.root(projectId);
    if (chat.worktree && expectedWorktree)
      throw new Error(
        "This thread's active workspace changed. Refresh before trying again.",
      );
    if (!chat.worktree) {
      await this.refreshAgentWorktrees(chat);
      if (
        expectedWorktree &&
        (!chat.activeAgentWorktree ||
          agentWorktreeKey(chat.activeAgentWorktree) !== expectedWorktree)
      )
        throw new Error(
          "This thread's active workspace changed. Refresh before trying again.",
        );
      const agent = selectedAgentWorktree(chat);
      if (!agent || !(await worktreeExists(agent)))
        throw new Error(agentWorktreeUnavailableError);
      return agent.path!;
    }
    return this.path(id);
  }

  async path(id: string) {
    const { worktree } = await this.of(id);
    if (!(await worktreeExists(worktree)))
      throw new Error("This thread's worktree was removed.");
    return worktree.path!;
  }

  async recordPull(id: string, pr: { number: number; url: string }) {
    const saved = await this.core.storage.load(id);
    if (!saved.worktree) {
      const agent = selectedAgentWorktree(saved);
      if (!agent) throw new Error("This thread has no worktree.");
      agent.pr = pr;
      await this.core.storage.save(saved);
      return;
    }
    const { chat, worktree } = await this.of(id);
    worktree.pr = pr;
    await this.core.storage.save(chat);
  }

  /** Relay's Merge landed `branch`, if it is still this thread's worktree branch. */
  async branchMerged(id: string, branch: string) {
    const { chat, worktree } = await this.of(id);
    if (worktree.branch !== branch || worktree.landed) return;
    worktree.landed = { at: Date.now(), by: "merge" };
    await this.core.storage.save(chat);
  }

  /** The worktree's PR was merged on the Git host, though the checkout may still need a pull. */
  async pullMerged(id: string) {
    const { chat, worktree } = await this.of(id);
    if (worktree.landed?.by === "pr") return;
    worktree.landed = { at: Date.now(), by: "pr" };
    await this.core.storage.save(chat);
  }
}
