import type { ProjectChat } from "../../shared/projects";
import { reviewFolder } from "../../shared/projects";
import { sentAgent } from "../../shared/recipient";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import type { ChatCore } from "./core";
import { assertHere, awaitsReturn } from "./handoff";

/** Where a thread went: its id and the project it's in now. */
export interface ProjectMove {
  chatId: string;
  projectId: string;
}

/**
 * Moves a thread into another of the user's projects at its agent's asking,
 * like a Scratchpad chat that grew into a project of its own. The
 * conversation and its agents' sessions come along; files stay where they
 * are. A thread tied to its repository, by a worktree, a pull request, a
 * review or a handoff, stays.
 */
export class ProjectMoves {
  private listeners = new Set<(move: ProjectMove) => void>();

  constructor(private core: ChatCore) {}

  /** Hears every thread that moved, so its windows can follow it. */
  onMoved(listener: (move: ProjectMove) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Why `id` can't move to `projectId`, or undefined when it can. */
  async blocked(id: string, projectId: string) {
    return this.problem(await this.core.storage.load(id), projectId);
  }

  /**
   * Moves it, mid-answer too: the rest of the answer's edits count in the
   * new folder, and its agent starts there from the next message on.
   */
  move(id: string, projectId: string) {
    return this.core.control(id, async () => {
      const chat = await this.core.storage.load(id);
      const problem = this.problem(chat, projectId);
      if (problem) throw new Error(problem);
      const target = this.core.projects.get(projectId);
      const to = await this.core.projects.root(projectId);
      const old = this.core.projects.get(chat.projectId);
      const from = await this.core.projects.root(old.id).catch(() => old.path);
      chat.projectId = projectId;
      // What the old checkout was on; the answer's end reads the new one.
      delete chat.branch;
      delete chat.commit;
      // The agent that asked knows; the thread's other agents hear it next time.
      const active = this.core.active.get(id);
      const caller = active?.input ?? chat.lastInput;
      const asker = caller ? `${sentAgent(caller)}:main` : undefined;
      const owed = Object.keys(chat.scopeHeard ?? {}).filter(
        (key) => key !== asker,
      );
      if (owed.length) chat.movedIn = { from, to, owed, project: target.name };
      else delete chat.movedIn;
      noteWorkspaceMove(chat, {
        how: "project",
        to,
        project: target.name,
        unasked: true,
        ...(caller ? { by: sentAgent(caller) } : {}),
      });
      await this.core.storage.save(chat);
      this.core.storage.summariesChanged(old.id);
      if (active) await active.moved?.(to);
      else this.core.sessions.close(id);
      for (const listener of this.listeners)
        listener({ chatId: id, projectId });
      return { project: { id: target.id, name: target.name }, folder: to };
    });
  }

  private problem(chat: ProjectChat, projectId: string) {
    if (chat.projectId === projectId)
      return "This thread is in that project already.";
    const target = (this.core.store.get().projects ?? []).find(
      (p) => p.id === projectId,
    );
    if (!target || target.removed)
      return "There's no such project; list_projects gives their ids.";
    if (target.scratch)
      return "A thread can't move into the Scratchpad, only into a project.";
    if (target.computer)
      return `${target.name} is on ${target.computer.name}; a thread can only move to a project on this computer.`;
    try {
      assertHere(chat);
    } catch (e) {
      return (e as Error).message;
    }
    if (awaitsReturn(chat))
      return "This thread came from another computer, which waits for it back.";
    if (chat.scope.kind !== "project" || chat.reviewer)
      return "A pull request or deep review thread stays with its repository.";
    if (chat.reviews?.length || reviewFolder(chat))
      return "A thread that ran a deep review stays with its repository.";
    if (chat.worktree)
      return "A thread in its own worktree stays with its repository.";
    if (chat.activeAgentWorktree || chat.agentWorktrees?.length)
      return "This thread made worktrees of its repository, so it stays with it.";
  }
}
