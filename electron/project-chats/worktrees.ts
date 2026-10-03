import type { ProjectChat, WorktreeStatus } from "../../shared/projects";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import { promptTitle } from "../agents/thread-titles";
import {
  createWorktree,
  moveIntoWorktree,
  removeWorktree,
  uncommitted,
  worktreeChanges,
  worktreeDiff,
  worktreeExists,
} from "../git/worktrees";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { awaitsReturn } from "./handoff";
import { chatSummary } from "./storage";

/** Where a thread works: the project's checkout, or a worktree of its own. */
export class ThreadWorktrees {
  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    readonly folder: string,
    private councils: Pick<Councils, "busy">,
  ) {}

  /** Where a thread's agent works: its worktree, made with its first message, or the checkout. */
  async root(chat: ProjectChat, prompt?: string): Promise<string> {
    // A thinker reads whatever its thread works in, worktree included.
    if (chat.thinker)
      return this.root(await this.core.storage.load(chat.thinker.parent));
    const root = await this.core.projects.root(chat.projectId);
    const worktree = chat.worktree;
    if (!worktree) return root;
    if (await worktreeExists(worktree)) return worktree.path!;
    chat.worktree = await createWorktree(
      root,
      this.folder,
      promptTitle(prompt ?? chat.title),
      worktree,
    );
    await this.core.storage.persist(chat);
    return chat.worktree.path!;
  }

  private async of(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.worktree)
      throw new Error("This thread works in the project's checkout.");
    return { chat, worktree: chat.worktree };
  }

  /** The worktrees a project's threads work in, for its process list. */
  folders(projectId: string) {
    return (this.core.store.get().chats ?? []).flatMap((chat) =>
      chat.projectId === projectId &&
      chat.worktree?.path &&
      !chat.worktree.removedAt
        ? [{ path: chat.worktree.path, chatId: chat.id }]
        : [],
    );
  }

  /** An agent is working in the project's checkout; worktree threads don't count. */
  checkoutBusy(projectId: string) {
    // Reviewer threads count too, though the sidebar never lists them.
    return (this.core.store.get().chats ?? []).some(
      (chat) =>
        chat.projectId === projectId &&
        !chat.worktree &&
        this.core.active.has(chat.id),
    );
  }

  /** What the worktree has that the branch it came from doesn't, and whether it all got there. */
  async status(id: string): Promise<WorktreeStatus> {
    const { worktree } = await this.of(id);
    const exists = await worktreeExists(worktree);
    const changes = exists ? await worktreeChanges(worktree) : null;
    const merged =
      changes && !changes.files.length && changes.commits > 0
        ? ("merge" as const)
        : worktree.landed?.by === "pr"
          ? ("pr" as const)
          : undefined;
    return {
      ...(worktree.branch ? { branch: worktree.branch } : {}),
      ...(worktree.path ? { path: worktree.path } : {}),
      ...(worktree.from ? { from: worktree.from } : {}),
      files: changes?.files ?? [],
      ...(merged ? { landed: { by: merged } } : {}),
      ...(worktree.pr ? { pr: worktree.pr } : {}),
      removed: !!worktree.path && !exists,
    };
  }

  /** An archived thread's worktree whose changes all reached the checkout has nothing left to keep. */
  async dropLanded(chat: ProjectChat, now: number) {
    if (!chat.worktree || !(await worktreeExists(chat.worktree))) return;
    if (awaitsReturn(chat)) return;
    const status = await this.status(chat.id).catch(() => null);
    if (status && !status.files.length) {
      await removeWorktree(
        await this.core.projects.root(chat.projectId),
        chat.id,
        chat.worktree,
      ).catch(() => {});
      chat.worktree.removedAt = now;
    }
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
      await this.core.active.assertIdle(id);
      if (worktree.path) {
        threadTerminals.closeWithin(worktree.path);
        await projectTasks.stopWithin(worktree.path);
      }
      await removeWorktree(
        await this.core.projects.root(chat.projectId),
        id,
        worktree,
      );
      worktree.removedAt = Date.now();
      await this.core.storage.persist(chat);
    });
  }

  /** Why a checkout thread can't move into a worktree now, if it can't. */
  private async moveBlocked(chat: ProjectChat) {
    if (chat.worktree) return "This thread already has its own worktree.";
    if (chat.scope.kind !== "project" || chat.reviewer || chat.thinker)
      return "Only repository threads can work in a worktree.";
    if (chat.shared) return "Shared conversations stay in the project folder.";
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
      chat.worktree = await moveIntoWorktree(root, this.folder, chat.title, id);
      chat.movedIn = {
        from: root,
        to: chat.worktree.path!,
        owed: Object.keys(chat.scopeHeard ?? {}),
      };
      // Live sessions started in the project folder; resumed, they start in the worktree.
      this.core.sessions.close(id);
      await this.core.storage.persist(chat);
      return chatSummary(chat);
    });
  }

  /** Where the thread's terminal opens: its worktree, or the project's checkout. */
  async terminalFolder(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    const worktree = chat.worktree;
    if (!worktree) return this.core.projects.root(projectId);
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
    return chat.projectId === projectId && !chat.worktree;
  }

  /** Only paths Relay saw the thread's agent make, so the renderer can't open any folder. */
  async agentWorktreePath(id: string, path: string) {
    const chat = await this.core.storage.load(id);
    const worktree = chat.agentWorktrees?.find((w) => w.path === path);
    if (!worktree) throw new Error("This thread didn't make that worktree.");
    return worktree.path;
  }

  /** A thread's worktree folder, for a workspace id; only while it exists. */
  async rootFor(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
    return this.path(id);
  }

  async path(id: string) {
    const { worktree } = await this.of(id);
    if (!(await worktreeExists(worktree)))
      throw new Error("This thread's worktree was removed.");
    return worktree.path!;
  }

  async recordPull(id: string, pr: { number: number; url: string }) {
    const { chat, worktree } = await this.of(id);
    worktree.pr = pr;
    await this.core.storage.persist(chat);
  }

  /** The worktree's PR was merged on the Git host, though the checkout may still need a pull. */
  async pullMerged(id: string) {
    const { chat, worktree } = await this.of(id);
    if (worktree.landed?.by === "pr") return;
    worktree.landed = { at: Date.now(), by: "pr" };
    await this.core.storage.persist(chat);
  }
}
