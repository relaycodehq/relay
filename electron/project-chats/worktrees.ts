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
  moveIntoWorktree,
  newBranchProblem,
  reattachWorktree,
  removeWorktree,
  suggestedBranch,
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
  selectedAgentWorktree,
  threadWorktree,
} from "../../shared/projects";
import {
  activeAfter,
  recoverAgentWorktrees,
  threadWorktreePaths,
} from "./agent-worktrees";
import { sentAgent } from "../../shared/recipient";

/** What an agent asks for when it moves its thread into a worktree. */
export interface WorktreeRequest {
  branch?: string;
  uncommitted?: boolean;
}

/** Where a thread works: the project's checkout, or a worktree of its own. */
export class ThreadWorktrees {
  readonly setup: WorktreeSetup;
  private refreshed = new Map<string, { at: number; pending: Promise<void> }>();
  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    readonly folder: string,
    private councils: Pick<Councils, "busy">,
  ) {
    this.setup = new WorktreeSetup(core);
  }

  /** Reconcile on reads too: old chats can have missed the event that made or moved their worktree. */
  async refreshAgentWorktrees(chat: ProjectChat, force = false) {
    if (chat.worktree || chat.scope.kind !== "project") return;
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
      if (active) chat.activeAgentWorktree = active;
      else delete chat.activeAgentWorktree;
      await this.core.storage.save(chat);
    })().catch((error) => {
      this.refreshed.delete(chat.id);
      throw error;
    });
    this.refreshed.set(chat.id, { at: Date.now(), pending });
    await pending;
  }

  /** Where a thread's agent works: its worktree, made with its first message, or the checkout. */
  async root(chat: ProjectChat, prompt?: string): Promise<string> {
    // A thinker reads whatever its thread works in, worktree included.
    if (chat.thinker)
      return this.root(await this.core.storage.load(chat.thinker.parent));
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
    chat.worktree =
      (await reattachWorktree(root, worktree)) ??
      (await createWorktree(
        root,
        this.folder,
        promptTitle(prompt ?? chat.title),
        worktree,
      ));
    await this.core.storage.save(chat);
    return chat.worktree.path!;
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
    return copyIntoWorktree(
      root,
      this.folder,
      promptTitle(prompt),
      source,
      chat.id,
      branch,
    );
  }

  /**
   * The branch a new thread's worktree would get: Relay's pick for `prompt`,
   * or `branch` with why it can't be made, if it can't.
   */
  async branch(
    projectId: string,
    prompt: string,
    branch?: string,
  ): Promise<WorktreeBranch> {
    const root = await this.core.projects.root(projectId);
    if (!branch)
      return {
        branch: await suggestedBranch(root, this.folder, promptTitle(prompt)),
      };
    const problem = await newBranchProblem(root, branch);
    return problem ? { branch, problem } : { branch };
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
      ...(worktree.cleanedUp && !exists ? { cleanedUp: true as const } : {}),
    };
  }

  /** An archived thread's worktree whose changes all reached the checkout has nothing left to keep. */
  async dropLanded(chat: ProjectChat, now: number) {
    if (!chat.worktree || !(await worktreeExists(chat.worktree))) return;
    if (awaitsReturn(chat)) return;
    const status = await this.status(chat.id).catch(() => null);
    if (status && !status.files.length) {
      await this.setup.teardown(chat, chat.worktree);
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
      await this.drop(chat, worktree);
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
      const why = await kept(chat);
      if (why) return why;
      // Idle agent processes started in the folder; the next message resumes their sessions.
      this.core.sessions.close(id);
      await this.drop(chat, worktree, { keepBranch: true });
    });
  }

  private async drop(
    chat: ProjectChat,
    worktree: ChatWorktree,
    { keepBranch = false } = {},
  ) {
    if (worktree.path) {
      threadTerminals.closeWithin(worktree.path);
      await projectTasks.stopWithin(worktree.path);
    }
    await this.setup.teardown(chat, worktree);
    await removeWorktree(
      await this.core.projects.root(chat.projectId),
      chat.id,
      worktree,
      { keepBranch },
    );
    worktree.removedAt = Date.now();
    if (keepBranch) worktree.cleanedUp = true;
    await this.core.storage.save(chat);
  }

  /** Why a checkout thread can't move into a worktree now, if it can't. */
  private async moveBlocked(chat: ProjectChat) {
    if (chat.worktree) return "This thread already has its own worktree.";
    if (chat.scope.kind !== "project" || chat.reviewer || chat.thinker)
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
      chat.worktree = await moveIntoWorktree(root, this.folder, chat.title, id);
      chat.movedIn = {
        from: root,
        to: chat.worktree.path!,
        owed: Object.keys(chat.scopeHeard ?? {}),
      };
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
      if (chat.scope.kind !== "project" || chat.reviewer || chat.thinker)
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
      const { worktree, copied } = copy
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
          };
      const { included: _, ...made } = worktree;
      chat.worktree = { ...made, setup: "done" };
      chat.branch = made.branch;
      // The agent that asked knows; the thread's other agents hear it next time.
      const active = this.core.active.get(id);
      const caller = active?.input ?? chat.lastInput;
      const asker = caller ? `${sentAgent(caller)}:main` : undefined;
      const owed = Object.keys(chat.scopeHeard ?? {}).filter(
        (key) => key !== asker,
      );
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

  /** Changes only the working folder. Files and branches stay where they are. */
  selectAgentWorktree(id: string, path: string | null) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      assertHere(chat);
      if (
        chat.worktree ||
        chat.scope.kind !== "project" ||
        chat.reviewer ||
        chat.thinker
      )
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
      this.core.sessions.close(id);
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /** A thread's worktree folder, for a workspace id; only while it exists. */
  async rootFor(projectId: string, id: string, expectedWorktree?: string) {
    const chat = await this.core.storage.load(id);
    if (chat.projectId !== projectId)
      throw new Error("This thread belongs to another project.");
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

  /** The worktree's PR was merged on the Git host, though the checkout may still need a pull. */
  async pullMerged(id: string) {
    const { chat, worktree } = await this.of(id);
    if (worktree.landed?.by === "pr") return;
    worktree.landed = { at: Date.now(), by: "pr" };
    await this.core.storage.save(chat);
  }
}
