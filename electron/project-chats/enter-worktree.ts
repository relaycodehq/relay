// A thread's agent moving it into a worktree in the middle of its answer.

import type { ChatWorktree, ProjectChat } from "../../shared/projects";
import { threadsSharing } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import {
  copyIntoWorktree,
  createWorktree,
  existingBranch,
  fetchStart,
  newBranchProblem,
} from "../git/worktrees";
import { carriedOn } from "./carry-on";
import { chatSummary } from "./chat-summaries";
import type { ChatCore } from "./core";
import type { WorktreeSetup } from "./worktree-setup";
import type { ThreadWorktrees } from "./worktrees";

/** What an agent asks for when it moves its thread into a worktree. */
export interface WorktreeRequest {
  branch?: string;
  uncommitted?: boolean;
}

/** What a thread's other agents hear came into the worktree with it; see `turn-prompt`. */
function whatCameAlong(copy: boolean | undefined, existing: boolean) {
  if (existing) return { joined: true as const };
  return copy ? { copied: true as const } : { fresh: true as const };
}

export class WorktreeEntry {
  constructor(
    private core: ChatCore,
    /** The folder Relay makes threads' worktrees in. */
    private folder: string,
    private setup: WorktreeSetup,
    private repo: Pick<ThreadWorktrees, "inRepo" | "inRepoSettled">,
  ) {}

  /**
   * Moves a project-folder thread into a worktree while its agent answers,
   * at the agent's asking: the worktree of an existing `branch`, shared with
   * whoever works there, or one of its own from the checkout's commit, with
   * a copy of its uncommitted edits when `uncommitted`. Unlike `move`, the
   * project folder keeps its edits, since other threads may be at work
   * there. The agent runs the setup of a folder Relay made itself, as
   * nothing else may run in the middle of its answer.
   */
  enter(id: string, request: WorktreeRequest) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      await this.assertInProjectFolder(chat);
      const root = await this.core.projects.root(chat.projectId);
      const { copied, existing, freshFolder } = await this.enteredWorktree(
        chat,
        root,
        request,
        "agent",
      );
      const made = { ...chat.worktree!, path: chat.worktree!.path! };
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
          ...whatCameAlong(request.uncommitted, existing),
        };
      await this.core.storage.save(chat);
      await active?.moved?.(made.path);
      // Whoever made the folder sets it up; the agent waits for a run going.
      if (!freshFolder) await this.setup.settled(made.path);
      const sharing = threadsSharing(this.core.store.get().chats ?? [], chat);
      const setup = freshFolder && this.setup.command(chat);
      const env = await this.setup.env(chat);
      return {
        folder: made.path,
        branch: made.branch,
        ...(made.from ? { from: made.from } : {}),
        ...(made.wanted ? { notOnWantedBranch: made.wanted.problem } : {}),
        ...(sharing.length
          ? { sharedWithThreads: sharing.map((c) => c.title) }
          : {}),
        ...(request.uncommitted ? { uncommittedFilesCopied: copied } : {}),
        ...(setup ? { setupCommand: setup } : {}),
        ...(Object.keys(env).length ? { environment: env } : {}),
      };
    });
  }

  /**
   * Moves a project-folder thread to existing `branch` at the user's
   * picking: the folder it's checked out in, shared with whoever works
   * there, or a worktree of its own on it. A folder Relay made just now is
   * set up with the thread's next message, as with a first one.
   */
  join(id: string, branch: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      await this.assertInProjectFolder(chat);
      await this.core.active.assertIdle(id);
      const root = await this.core.projects.root(chat.projectId);
      if (!(await existingBranch(root, branch)))
        throw new Error(`There's no branch ${branch}.`);
      await this.enteredWorktree(chat, root, { branch }, "relay");
      const joined = chat.worktree!;
      noteWorkspaceMove(chat, {
        how: "switched",
        to: joined.path!,
        ...(joined.branch ? { branch: joined.branch } : {}),
      });
      const owed = Object.keys(chat.scopeHeard ?? {});
      if (owed.length)
        chat.movedIn = { from: root, to: joined.path!, owed, joined: true };
      // Live sessions started in the project folder; resumed, they start in the worktree.
      this.core.sessions.close(id);
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /** Refuses a thread that isn't a repository thread working in the project folder. */
  private async assertInProjectFolder(chat: ProjectChat) {
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
  }

  /**
   * Puts the thread in the worktree `enter` found or made for it, saved
   * before the repository's queue lets go, so a thread dropping that folder
   * sees this one in it. An existing branch goes wherever carrying it on
   * goes: the folder a thread or the user has it checked out in, else a new
   * one on it. `freshFolder` when Relay made the folder just now.
   */
  private async enteredWorktree(
    chat: ProjectChat,
    root: string,
    { branch, uncommitted: copy }: WorktreeRequest,
    /** Who runs the setup of a folder Relay makes: the agent now, or Relay with the next turn. */
    setsUp: "agent" | "relay",
  ) {
    const found = branch ? await existingBranch(root, branch) : undefined;
    if (branch && found) {
      if (found.inCheckout)
        throw new Error(
          `${found.branch} is the project folder's own branch, where this thread works already.`,
        );
      if (copy)
        throw new Error(
          `${branch} already exists, and joining it brings no uncommitted edits along. Leave out uncommitted to work on it.`,
        );
      // Outside the queue, like a thread carrying a branch on with its first message.
      await fetchStart(root, { on: branch });
      return this.repo.inRepoSettled(root, async () => {
        const worktree = await carriedOn(
          this.core,
          this.folder,
          chat,
          root,
          branch,
          chat.title,
        );
        await this.claim(chat, worktree, setsUp);
        const freshFolder = worktree.setup === "pending";
        return { copied: 0, existing: true, freshFolder };
      });
    }
    const problem = branch && (await newBranchProblem(root, branch));
    if (problem) throw new Error(problem);
    return this.repo.inRepo(root, async () => {
      const { worktree, copied } = copy
        ? await copyIntoWorktree(
            root,
            this.folder,
            chat.title,
            root,
            chat.id,
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
      await this.claim(chat, worktree, setsUp);
      return { copied, existing: false, freshFolder: true };
    });
  }

  /** Saves the thread as working in `worktree`; when its agent runs a new folder's setup itself, Relay won't. */
  private async claim(
    chat: ProjectChat,
    worktree: ChatWorktree,
    setsUp: "agent" | "relay",
  ) {
    const { included: _, ...kept } = worktree;
    chat.worktree = setsUp === "relay" ? worktree : { ...kept, setup: "done" };
    chat.branch = worktree.branch;
    delete chat.commit;
    await this.core.storage.save(chat);
  }
}
