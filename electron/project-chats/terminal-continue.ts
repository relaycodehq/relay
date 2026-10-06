import { randomUUID } from "node:crypto";
import { branchNameProblem } from "../../shared/branch-names";
import type {
  ChatSummary,
  ChatWorkspace,
  ContinuedSession,
  ProjectChat,
} from "../../shared/projects";
import {
  continuesAsCopy,
  type TerminalSession,
  type TerminalSessionPick,
} from "../../shared/terminal-sessions";
import { accountHomes, accountLabel } from "../agents/accounts";
import type { TerminalSessions } from "../terminal-sessions";
import type { ChatCore } from "./core";
import { chatSummary } from "./storage";
import type { ThreadWorktrees } from "./worktrees";

const TITLE_LIMIT = 120;

/** A session's title as a thread title: one line, no control characters. */
export function threadTitle(title: string) {
  const line = title
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line.slice(0, TITLE_LIMIT) || "Terminal session";
}

/**
 * Threads that carry on a Claude Code or Codex session the user ran in a
 * terminal: resumed when nothing holds it, otherwise continued in a copy.
 */
export class TerminalContinue {
  /** Sessions being brought over; a second pick waits for the first's thread. */
  private continuing = new Map<string, Promise<ChatSummary>>();

  constructor(
    private core: ChatCore,
    private worktrees: ThreadWorktrees,
    private sessions: TerminalSessions,
  ) {}

  async list(projectId: string): Promise<TerminalSession[]> {
    const root = await this.core.projects.root(projectId);
    const found = await this.sessions.list(root);
    const counts = new Map<string, number>();
    for (const { provider } of accountHomes())
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    return found.map(({ path, ...session }) => {
      const chatId = this.continuedBy(projectId, session)?.id;
      return {
        ...session,
        ...(chatId ? { chatId } : {}),
        ...((counts.get(session.provider) ?? 0) > 1
          ? { accountLabel: accountLabel(session.provider, session.account) }
          : {}),
      };
    });
  }

  /**
   * A thread holding the session's conversation so far, with its agent set
   * to carry on in it; the thread that already does, archived or not, if
   * there is one. `created` says which.
   */
  async continue(
    projectId: string,
    pick: TerminalSessionPick,
    workspace: ChatWorkspace = "checkout",
    branch?: string,
  ): Promise<ContinuedSession> {
    const key = `${projectId}:${pick.provider}:${pick.session}`;
    const making = this.continuing.get(key);
    if (making) return { chat: await making, created: false };
    const already = this.continuedBy(projectId, {
      provider: pick.provider,
      id: pick.session,
    });
    if (already) return { chat: already, created: false };
    const made = this.make(projectId, pick, workspace, branch);
    this.continuing.set(key, made);
    try {
      return { chat: await made, created: true };
    } finally {
      this.continuing.delete(key);
    }
  }

  private async make(
    projectId: string,
    pick: TerminalSessionPick,
    workspace: ChatWorkspace,
    branch?: string,
  ) {
    const { plain } = await this.core.projects.inspect(projectId);
    if (plain && workspace === "worktree")
      throw new Error("Worktrees need a Git repository.");
    const named = workspace === "worktree" ? branch : undefined;
    const problem = named && branchNameProblem(named);
    if (problem) throw new Error(problem);
    const root = await this.core.projects.root(projectId);
    const session = await this.sessions.find(root, pick);
    if (!session)
      throw new Error("That session is no longer in this project's folder.");
    const { messages, cut } = await this.sessions.history(session);
    // In a copy, the thread's history ends where the copy is cut, after an
    // answer whose turn finished. Without one, the conversation goes to the
    // agent as text instead.
    const copy = continuesAsCopy(session);
    const kept =
      copy && cut
        ? messages.slice(0, messages.findIndex((m) => m.id === cut.message) + 1)
        : messages;
    const last = kept.at(-1);
    if (!last) throw new Error("That session has no conversation to continue.");
    const now = Date.now();
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      scope: { kind: "project" },
      title: threadTitle(session.title),
      created: now,
      updated: now,
      seenAt: now,
      messages: kept,
      accounts: { [session.provider]: session.account },
      fromTerminal: {
        provider: session.provider,
        session: session.id,
        how: !copy ? "resumed" : cut ? "forked" : "text",
        open: session.live,
        through: last.id,
      },
    };
    if (!copy)
      chat.sessions = {
        [session.provider]: { thread: session.id, through: last.id },
      };
    else if (cut) {
      last.forkPoint = cut.point;
      chat.forkedAt = last.id;
    }
    if (workspace === "worktree") {
      const { worktree } = await this.worktrees.copyFor(chat, root, chat.title, named);
      chat.worktree = worktree;
      // The session ran in the project folder; its paths point there.
      chat.movedIn = {
        from: root,
        to: worktree.path!,
        owed: [`${session.provider}:main`],
        copied: true,
      };
    }
    // Stored only once whole, so no one sees it half made.
    await this.core.storage.add(chat);
    return chatSummary(chat);
  }

  /** The thread continuing the session; an archived one too, which may come back. */
  private continuedBy(
    projectId: string,
    session: { provider: string; id: string },
  ) {
    return (this.core.store.get().chats ?? []).find(
      (c) =>
        c.projectId === projectId &&
        c.fromTerminal?.provider === session.provider &&
        c.fromTerminal.session === session.id,
    );
  }
}
