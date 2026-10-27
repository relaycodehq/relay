import type { ProjectChat } from "../../shared/projects";
import {
  agentWorktreeKey,
  agentWorktreeUnavailableError,
  selectedAgentWorktree,
  threadWorktree,
} from "../../shared/projects";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import { hasBranch, recreateWorktree, worktreeExists } from "../git/worktrees";
import {
  activeAfter,
  followAgentWorkspace,
  forgetAgentWorktrees,
  recoverAgentWorktrees,
  threadWorktreePaths,
} from "./agent-worktrees";
import type { ChatCore } from "./core";
import type { Councils } from "./councils";
import { assertHere } from "./handoff";
import { chatSummary } from "./chat-summaries";

/**
 * The worktrees an agent made from a project-folder thread, and which of
 * them the thread works in: found again on reads, switched between, and
 * made again after one was deleted.
 */
export class AgentWorkspaces {
  private refreshed = new Map<string, { at: number; pending: Promise<void> }>();

  constructor(
    private core: ChatCore,
    private councils: Pick<Councils, "busy">,
    private inRepo: <T>(root: string, job: () => Promise<T>) => Promise<T>,
  ) {}

  /** Git changed under every thread of a repository: look again on the next read. */
  forget() {
    this.refreshed.clear();
  }

  /** Reconcile on reads too: old chats can have missed the event that made or moved their worktree. */
  async refresh(chat: ProjectChat, force = false) {
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
        .then((root) => {
          if (force) forgetAgentWorktrees(root);
          return recoverAgentWorktrees(
            root,
            threadWorktreePaths(this.core.store.get().chats),
            chat,
            force,
          );
        })
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

  /** Resolve the selected folder, reconciling a deletion or repaired move even inside the discovery cache window. */
  async folder(chat: ProjectChat, expectedWorktree?: string) {
    await this.refresh(chat);
    let selected = selectedAgentWorktree(chat);
    let exists = selected && (await worktreeExists(selected));
    if (selected && !exists) {
      await this.refresh(chat, true);
      selected = selectedAgentWorktree(chat);
      exists = selected && (await worktreeExists(selected));
    }
    if (
      expectedWorktree &&
      (!chat.activeAgentWorktree ||
        agentWorktreeKey(chat.activeAgentWorktree) !== expectedWorktree)
    )
      throw new Error(
        "This thread's active workspace changed. Refresh before trying again.",
      );
    if (!chat.activeAgentWorktree) return;
    if (!selected || !exists) throw new Error(agentWorktreeUnavailableError);
    return selected.path;
  }

  async worksInCheckout(projectId: string, id: string) {
    const chat = await this.core.storage.load(id);
    await this.refresh(chat);
    return (
      chat.projectId === projectId && !chat.worktree && !threadWorktree(chat)
    );
  }

  /** Only paths Relay saw the thread's agent make, so the renderer can't open any folder. */
  async path(id: string, path: string) {
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
    await this.refresh(chat, true);
    return chat;
  }

  /** Changes only the working folder. Files and branches stay where they are. */
  select(id: string, path: string | null) {
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
  async recreatable(id: string) {
    const chat = await this.core.storage.load(id);
    const gone = chat.activeAgentWorktree;
    if (!gone?.branch || selectedAgentWorktree(chat)) return false;
    return hasBranch(
      await this.core.projects.root(chat.projectId),
      gone.branch,
    );
  }

  /** Makes the deleted worktree a thread still has selected again, from its branch, and carries on there. */
  recreate(id: string) {
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
}
