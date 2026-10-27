// A started thread going to another branch at the user's picking, wherever that branch is worked on.

import type {
  ChatSummary,
  ChatWorktree,
  ProjectChat,
} from "../../shared/projects";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import { currentBranchOr } from "../git/git";
import {
  checkedOutAt,
  dropUnusedBranch,
  existingBranch,
  fetchStart,
  switchWorktree,
  worktreeExists,
  worktreeHoldsWork,
} from "../git/worktrees";
import { projectTasks } from "../terminal/tasks";
import { threadTerminals } from "../terminal/thread-terminals";
import { errorMessage } from "../../shared/error-message";
import { chatSummary } from "./chat-summaries";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere, awaitsReturn } from "./handoff";
import { whyFolderStays, worktreeUsers } from "./worktree-users";
import type { ThreadWorktrees } from "./worktrees";

/** Where a thread worked before a move: the folder, and the worktree it had there, if any. */
interface Left {
  folder: string;
  worktree?: ChatWorktree;
}

export class BranchSwitch {
  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private councils: Pick<Councils, "busy">,
  ) {}

  /**
   * Thread `id` works on existing `branch` from now on, wherever that is:
   * the project folder's branch takes it back to the project folder, a
   * branch checked out in a folder joins it there, and any other moves the
   * thread's own worktree onto it when no one else is in it and nothing
   * there would be lost, else gets it a worktree on it. One step under the
   * thread's control, so no turn starts halfway. The folder it leaves stays
   * as it is. The project folder itself is switched by
   * `projectChangeBranch`, before this is asked.
   */
  async workOn(id: string, branch: string): Promise<ChatSummary> {
    const { projectId } = await this.core.storage.load(id);
    const root = await this.core.projects.root(projectId);
    const found = await existingBranch(root, branch);
    if (!found) throw new Error(`There's no branch ${branch}.`);
    // Outside the thread's control and the repository's queue: a slow
    // remote holds nothing else up.
    if (!found.inCheckout) await fetchStart(root, { on: branch });
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      await this.assertMovable(chat);
      const left = await this.whereItWorks(chat, root);
      if (found.inCheckout) {
        // A worktree record whose folder went would come back with the next message.
        const inProjectFolder = left.folder === root && !chat.worktree;
        if (inProjectFolder) return chatSummary(chat);
        return this.moved(chat, root, left, { folder: root });
      }
      const own = left.worktree;
      if (
        own &&
        (await currentBranchOr(left.folder, own.branch)) === found.branch
      )
        return chatSummary(chat);
      if (own) {
        const inPlace = await this.worktrees.inRepo(root, () =>
          this.switchInPlace(chat, root, own, found.branch),
        );
        if (inPlace.switched) return inPlace.summary;
      }
      // The picked name, not its local one: a remote-only branch is made from it.
      const joined = await this.worktrees.entry.carryOnto(chat, root, branch);
      return this.moved(chat, root, left, {
        folder: joined.path!,
        worktree: joined,
      });
    });
  }

  /** Refuses while anything runs in the thread that a move would pull the folder from under. */
  private async assertMovable(chat: ProjectChat) {
    if (chat.scope.kind !== "project" || chat.reviewer)
      throw new Error("Only repository threads can switch branches.");
    assertHere(chat);
    if (awaitsReturn(chat))
      throw new Error(
        `Hand this thread back first; ${chat.cameFrom!.computer} is waiting for it.`,
      );
    await this.core.active.assertIdle(chat.id);
    if (this.core.active.hasSide(chat.id) || this.councils.busy(chat))
      throw new Error(
        "Wait for the answer to finish before switching branches.",
      );
    if (this.core.sessions.pending(chat.id).length || chat.heldWakeups?.length)
      throw new Error(
        "Stop this thread's background work and wake-ups before switching branches.",
      );
  }

  /** The folder the thread works in now: its own worktree, the one its agent made, or the project folder. */
  private async whereItWorks(chat: ProjectChat, root: string): Promise<Left> {
    const worktree = chat.worktree;
    if (
      worktree?.path &&
      !worktree.removedAt &&
      (await worktreeExists(worktree))
    )
      return { folder: worktree.path, worktree };
    return { folder: chat.activeAgentWorktree?.path ?? root };
  }

  /**
   * Its own folder can go to `branch` itself: nothing else has the branch
   * checked out, Relay made the folder, no one else works in it, and it
   * holds nothing a switch would carry along or leave behind.
   */
  private async switchableInPlace(
    chat: ProjectChat,
    root: string,
    branch: string,
  ) {
    if (await checkedOutAt(root, branch)) return false;
    const chats = this.core.store.get().chats ?? [];
    if (await whyFolderStays(chats, chat)) return false;
    return !(await worktreeHoldsWork(chat.worktree!.path!));
  }

  /**
   * Switches the thread's own worktree folder to `branch` when it can go
   * there itself; asked in the repository's queue, so no thread joins the
   * folder meanwhile. Git refusing here is an error to show, not a reason
   * to move the thread elsewhere.
   */
  private async switchInPlace(
    chat: ProjectChat,
    root: string,
    own: ChatWorktree,
    branch: string,
  ): Promise<{ switched: false } | { switched: true; summary: ChatSummary }> {
    if (!(await this.switchableInPlace(chat, root, branch)))
      return { switched: false };
    const folder = own.path!;
    chat.worktree = await switchWorktree(
      root,
      { ...own, path: folder },
      branch,
    ).catch((e: unknown) => {
      throw new Error(
        `Couldn't switch the worktree to ${branch}: ${errorMessage(e)}`,
      );
    });
    chat.branch = branch;
    delete chat.commit;
    if (!this.keptByAnother(chat, own.branch))
      await dropUnusedBranch(root, own);
    const owed = Object.keys(chat.scopeHeard ?? {});
    if (owed.length)
      chat.movedIn = { from: folder, to: folder, owed, switched: true };
    noteWorkspaceMove(chat, { how: "switched", to: folder, branch });
    await this.core.storage.save(chat);
    return { switched: true, summary: chatSummary(chat) };
  }

  /**
   * Saves the thread as working in `to`, its worktree claimed there already
   * when it has one, and lets go of the folder it left.
   */
  private async moved(chat: ProjectChat, root: string, left: Left, to: Left) {
    if (!to.worktree) {
      delete chat.worktree;
      delete chat.branch;
      delete chat.commit;
    }
    delete chat.activeAgentWorktree;
    const owed = Object.keys(chat.scopeHeard ?? {});
    if (owed.length)
      chat.movedIn = {
        from: left.folder,
        to: to.folder,
        owed,
        ...(to.worktree
          ? { joined: true as const }
          : { selected: true as const }),
      };
    const branch = to.worktree?.branch;
    noteWorkspaceMove(chat, {
      how: "switched",
      ...(to.folder !== root ? { to: to.folder } : {}),
      ...(branch ? { branch } : {}),
    });
    // Live sessions started where it was; resumed, they start where it is now.
    this.core.sessions.close(chat.id);
    await this.core.storage.save(chat);
    if (left.worktree) await this.letGo(chat, left.worktree);
    return chatSummary(chat);
  }

  /**
   * The folder stays as it is, edits, ignored files and all, listed among
   * the worktrees to come back to; what ran in it stops when no one else
   * works there now.
   */
  private async letGo(chat: ProjectChat, worktree: ChatWorktree) {
    if (!worktree.path || worktree.adopted) return;
    const chats = this.core.store.get().chats ?? [];
    if ((await worktreeUsers(chats, { id: chat.id, worktree })).length) return;
    threadTerminals.closeWithin(worktree.path);
    await projectTasks.stopWithin(worktree.path);
  }

  /** Another thread, archived ones included, keeps `branch` for its worktree, to check it out again. */
  private keptByAnother(chat: ProjectChat, branch: string | undefined) {
    return (this.core.store.get().chats ?? []).some(
      (c) =>
        c.id !== chat.id &&
        c.projectId === chat.projectId &&
        c.worktree?.branch === branch,
    );
  }
}
