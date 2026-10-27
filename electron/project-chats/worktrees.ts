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
  cantCarryOn,
  copyIntoWorktree,
  createWorktree,
  fetchStart,
  moveIntoWorktree,
  newBranchProblem,
  reattachWorktree,
  removeWorktree,
  retitleWorktree,
  uncommitted,
  worktreeChanges,
  worktreeDiff,
  worktreeExists,
} from "../git/worktrees";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { awaitsReturn } from "./handoff";
import { chatSummary } from "./chat-summaries";
import { WorktreeSetup } from "./worktree-setup";
import { carriedOn } from "./carry-on";
import { WorktreeEntry } from "./enter-worktree";
import { AgentWorkspaces } from "./agent-workspaces";
import { whyFolderStays, worktreeUsers } from "./worktree-users";
import {
  agentWorktreeUnavailableError,
  joinedWorktree,
  reviewFolder,
  selectedAgentWorktree,
  sharedWith,
  threadsSharing,
  threadWorktree,
} from "../../shared/projects";
import { forgetAgentWorktrees } from "./agent-worktrees";
import { keyedQueue } from "../util/keyed-queue";
import { noteWorkspaceMove } from "../../shared/workspace-moves";

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

export class ThreadWorktrees {
  readonly setup: WorktreeSetup;
  /** The worktrees a project-folder thread's agent made, and the one it works in. */
  readonly agents: AgentWorkspaces;
  /** Moves a project-folder thread into a worktree at its agent's asking. */
  readonly entry: WorktreeEntry;
  /** Worktree changes per repository root; see `inRepo`. */
  private making = keyedQueue();
  /** Worktree folders between their teardown and their removal, per repository root; see `drop`. */
  private dropping = new Map<string, Set<Promise<void>>>();
  /** Threads whose first message just made their worktree; nothing runs in it until it's named. */
  readonly unnamed = new Set<string>();

  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    readonly folder: string,
    private councils: Pick<Councils, "busy" | "root">,
  ) {
    this.setup = new WorktreeSetup(core);
    this.entry = new WorktreeEntry(core, folder, this.setup, this);
    this.agents = new AgentWorkspaces(core, councils, (root, job) =>
      this.inRepo(root, job),
    );
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
    if (!worktree) return (await this.agents.folder(chat)) ?? root;
    if (await worktreeExists(worktree)) return worktree.path!;
    // Outside the repository's queue: a slow remote mustn't hold up every
    // other thread's worktree there.
    await fetchStart(root, regrown(worktree).startFrom, signal);
    return this.inRepoSettled(root, () => this.remake(chat, root, prompt));
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
        ? await carriedOn(this.core, this.folder, chat, root, carry, name)
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
    return this.making(root, async () => {
      forgetAgentWorktrees(root);
      this.agents.forget();
      try {
        return await job();
      } finally {
        forgetAgentWorktrees(root);
        this.agents.forget();
      }
    });
  }

  /**
   * `inRepo`, once no worktree folder there is between its teardown and
   * its removal: a thread joining or carrying on a branch would find it
   * still there, set up no more.
   */
  async inRepoSettled<T>(root: string, job: () => Promise<T>): Promise<T> {
    for (;;) {
      const going = this.dropping.get(root);
      if (going?.size) await Promise.all(going);
      const ran = await this.inRepo(root, async () =>
        this.dropping.get(root)?.size ? undefined : { value: await job() },
      );
      if (ran) return ran.value;
    }
  }

  /** The other open threads working in this thread's worktree folder. */
  private sharers(chat: Pick<ProjectChat, "id" | "worktree">) {
    return threadsSharing(this.core.store.get().chats ?? [], chat);
  }

  /** Everyone else working in the thread's worktree folder; see ./worktree-users. */
  private users(chat: Pick<ProjectChat, "id" | "worktree">) {
    return worktreeUsers(this.core.store.get().chats ?? [], chat);
  }

  /** Why the thread's worktree folder stays when the thread lets go of it, if it does. */
  private stays(chat: ProjectChat) {
    return whyFolderStays(this.core.store.get().chats ?? [], chat);
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
    const root = await this.core.projects.root(chat.projectId);
    // In the queue, where a thread joining the folder saves itself: moving
    // the folder would pull it from under that one.
    const moved = await this.inRepo(root, async () =>
      (await this.users(chat)).length
        ? undefined
        : await retitleWorktree(root, worktree, chat.title),
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
    const root = await this.core.projects.root(chat.projectId);
    // Claimed in the queue, so no thread joins the folder once its teardown
    // runs; they wait for it to go (`inRepoSettled`).
    let done = () => {};
    const going = new Promise<void>((resolve) => (done = resolve));
    const claimed = await this.inRepo(root, async () => {
      if (await this.stays(chat)) return false;
      const all = this.dropping.get(root) ?? new Set();
      this.dropping.set(root, all.add(going));
      return true;
    });
    if (!claimed) return false;
    try {
      if (worktree.path) {
        threadTerminals.closeWithin(worktree.path);
        await projectTasks.stopWithin(worktree.path);
      }
      await this.setup.teardown(chat, worktree);
      return await this.inRepo(root, async () => {
        // A review following the branch can still have come in meanwhile.
        if (await this.stays(chat)) return false;
        await removeWorktree(root, chat.id, worktree, { keepBranch });
        worktree.removedAt = at ?? Date.now();
        if (keepBranch) worktree.cleanedUp = true;
        await this.core.storage.save(chat);
        return true;
      });
    } finally {
      const all = this.dropping.get(root);
      all?.delete(going);
      if (!all?.size) this.dropping.delete(root);
      done();
    }
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

  /** Where the thread's terminal opens: its worktree, or the project's checkout. */
  async terminalFolder(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    // A review's fixes, and the files its answers changed, are in its folder.
    const review = await this.councils.root(chat);
    if (review) return review;
    const worktree = chat.worktree;
    if (!worktree)
      return (
        (await this.agents.folder(chat)) ?? this.core.projects.root(projectId)
      );
    if (
      worktree.removedAt ||
      (worktree.path && !(await worktreeExists(worktree)))
    )
      throw new Error("This thread's worktree was removed.");
    if (!worktree.path)
      throw new Error("This thread's worktree is made with its first message.");
    return worktree.path;
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
      const folder = await this.agents.folder(chat, expectedWorktree);
      if (!folder) throw new Error(agentWorktreeUnavailableError);
      return folder;
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
