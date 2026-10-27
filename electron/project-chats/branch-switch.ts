// A started thread going to another branch at the user's picking, wherever that branch is worked on.

import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import {
  checkedOutAt,
  dropUnusedBranch,
  existingBranch,
  fetchStart,
  switchWorktree,
  worktreeExists,
  worktreeHoldsWork,
} from "../git/worktrees";
import { chatSummary } from "./chat-summaries";
import type { ChatCore } from "./core";
import { assertHere, awaitsReturn } from "./handoff";
import { whyFolderStays } from "./worktree-users";
import type { ThreadWorktrees } from "./worktrees";

export class BranchSwitch {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
  ) {}

  /**
   * Thread `id` works on existing `branch` from now on, wherever that is:
   * the project folder's branch takes it back to the project folder, a
   * branch checked out in a folder joins it there, and any other moves the
   * thread's own worktree onto it when no one else works there, else gets
   * it a worktree on it. Where the branch is never refuses it; a running
   * answer only has it wait. The project folder itself is switched by
   * `projectChangeBranch`, before this is asked.
   */
  async workOn(id: string, branch: string): Promise<ChatSummary> {
    const chat = await this.core.storage.load(id);
    if (chat.scope.kind !== "project" || chat.reviewer)
      throw new Error("Only repository threads can switch branches.");
    assertHere(chat);
    if (awaitsReturn(chat))
      throw new Error(
        `Hand this thread back first; ${chat.cameFrom!.computer} is waiting for it.`,
      );
    await this.core.active.assertIdle(id);
    const root = await this.core.projects.root(chat.projectId);
    const found = await existingBranch(root, branch);
    if (!found) throw new Error(`There's no branch ${branch}.`);
    if (found.inCheckout) return this.toProjectFolder(id);
    const own = await liveWorktree(chat);
    if (own?.branch === found.branch) return chatSummary(chat);
    const elsewhere = await checkedOutAt(root, found.branch);
    if (own && !elsewhere) {
      const switched = await this.switchInPlace(id, root, found.branch);
      if (switched) return switched;
    }
    if (chat.worktree || chat.activeAgentWorktree) await this.toProjectFolder(id);
    return this.worktrees.entry.join(id, found.branch);
  }

  /**
   * Back to the project folder: out of the worktree the agent made, or out
   * of the thread's own, which goes when Relay made it, no one else works
   * there and it holds no work, as a settled thread's would.
   */
  private async toProjectFolder(id: string) {
    const chat = await this.core.storage.load(id);
    if (!chat.worktree) return this.worktrees.agents.select(id, null);
    const stayed = await this.worktrees.cleanUp(id, async (c) =>
      c.worktree?.path ? worktreeHoldsWork(c.worktree.path) : undefined,
    );
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const left = chat.worktree;
      if (!left) return chatSummary(chat);
      const root = await this.core.projects.root(chat.projectId);
      delete chat.worktree;
      delete chat.branch;
      delete chat.commit;
      if (!stayed && !this.keptByAnother(chat, left.branch))
        await dropUnusedBranch(root, left);
      const owed = Object.keys(chat.scopeHeard ?? {});
      if (owed.length && left.path)
        chat.movedIn = { from: left.path, to: root, owed, selected: true };
      noteWorkspaceMove(chat, { how: "switched" });
      this.core.sessions.close(id);
      await this.core.storage.save(chat);
      return chatSummary(chat);
    });
  }

  /**
   * Switches the thread's own worktree folder to `branch`, when it's
   * Relay's and no one else works in it. Undefined when it can't, Git
   * refusing over edits in the way among the reasons; the caller then finds
   * the thread another folder.
   */
  private async switchInPlace(id: string, root: string, branch: string) {
    await fetchStart(root, { on: branch });
    return this.core.control(id, () =>
      this.worktrees.inRepo(root, async () => {
        const chat = await this.core.storage.load(id);
        const left = chat.worktree;
        if (!left?.path) return undefined;
        const chats = this.core.store.get().chats ?? [];
        if (await whyFolderStays(chats, chat)) return undefined;
        const moved = await switchWorktree(
          root,
          { ...left, path: left.path },
          branch,
        ).catch(() => undefined);
        if (!moved) return undefined;
        chat.worktree = moved;
        chat.branch = branch;
        delete chat.commit;
        if (!this.keptByAnother(chat, left.branch))
          await dropUnusedBranch(root, left);
        const owed = Object.keys(chat.scopeHeard ?? {});
        if (owed.length)
          chat.movedIn = { from: left.path, to: left.path, owed, switched: true };
        noteWorkspaceMove(chat, { how: "switched", to: left.path, branch });
        await this.core.storage.save(chat);
        return chatSummary(chat);
      }),
    );
  }

  /** Another open thread keeps `branch` for its worktree, to check it out again. */
  private keptByAnother(chat: ProjectChat, branch: string | undefined) {
    return (this.core.store.get().chats ?? []).some(
      (c) =>
        c.id !== chat.id &&
        c.projectId === chat.projectId &&
        !c.archivedAt &&
        c.worktree?.branch === branch,
    );
  }
}

/** The thread's own worktree, when its folder is still there. */
async function liveWorktree(chat: ProjectChat) {
  const worktree = chat.worktree;
  if (!worktree?.path || worktree.removedAt) return undefined;
  return (await worktreeExists(worktree)) ? worktree : undefined;
}
