import { randomUUID } from "node:crypto";
import type {
  ChatScope,
  ChatWorkspace,
  LinkedFolder,
  ProjectChat,
  StartedBy,
  WorktreeStart,
} from "../../shared/projects";
import { branchNameProblem } from "../../shared/branch-names";
import {
  joinableWorktrees,
  joinedWorktree,
  threadOnBranch,
} from "../../shared/projects";
import { worktreeStartProblem } from "../git/worktrees";
import type { ChatCore } from "./core";
import { ThreadNotes } from "./notes";
import { chatSummary } from "./storage";

/** New threads: empty ones, and forks of an existing one up to an answer. */
export class ThreadCreate {
  constructor(private core: ChatCore) {}
  async create(
    projectId: string,
    scope: ChatScope,
    workspace: ChatWorkspace = "checkout",
    startedBy?: StartedBy,
    branch?: string,
    links?: LinkedFolder[],
    start?: WorktreeStart,
  ) {
    const project = this.core.projects.get(projectId);
    if (project.computer) {
      if (scope.kind !== "project")
        throw new Error(
          `PRs and deep reviews of ${project.name} run on ${project.computer.name}; open them there.`,
        );
      // It works in the project's folder there; worktrees there come later.
      workspace = "checkout";
    }
    const { plain } = project.computer
      ? { plain: !!project.computer.plain }
      : await this.core.projects.inspect(projectId);
    if (plain && (workspace === "worktree" || scope.kind !== "project"))
      throw new Error("Worktrees, PRs and deep reviews need a Git repository.");
    if (workspace === "worktree" && scope.kind !== "project")
      throw new Error("Only repository threads can work in a worktree.");
    // A carried-on branch keeps its own name.
    const named =
      workspace === "worktree" && !(start && "on" in start)
        ? branch
        : undefined;
    const startFrom = workspace === "worktree" ? start : undefined;
    // In another thread's worktree, or on a branch one is on: the same
    // folder, both threads working in it, as T3 shares one.
    const projectChats = (this.core.store.get().chats ?? []).filter(
      (c) => c.projectId === projectId,
    );
    const asked =
      startFrom && "thread" in startFrom
        ? projectChats.find((c) => c.id === startFrom.thread)
        : startFrom && "on" in startFrom
          ? threadOnBranch(projectChats, startFrom.on)
          : undefined;
    const joining = asked && joinableWorktrees([asked])[0];
    if (startFrom && "thread" in startFrom && !joining)
      throw new Error("That thread's worktree is gone; pick another.");
    const joined =
      joining &&
      joinedWorktree((await this.core.storage.load(joining.id)).worktree!);
    // A name git can't take is a typo to fix; one that's taken by the time
    // the first message sends falls back to `relay/…`, and the thread says so.
    const problem = named && branchNameProblem(named);
    if (problem) throw new Error(problem);
    // So is a branch to start from that isn't there or is held elsewhere;
    // one that goes by the first message falls back the same way.
    const startProblem =
      startFrom &&
      !joined &&
      (await worktreeStartProblem(
        await this.core.projects.root(projectId),
        startFrom,
        (branch) => {
          const other = threadOnBranch(
            (this.core.store.get().chats ?? []).filter(
              (c) => c.projectId === projectId,
            ),
            branch,
          );
          return other
            ? `${branch} is kept for the thread “${other.title}”; carry it on there.`
            : undefined;
        },
      ));
    if (startProblem) throw new Error(startProblem);
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      scope,
      // The worktree itself is made with the first message, named after it
      // unless the user named its branch.
      ...(joined
        ? { worktree: joined }
        : workspace === "worktree"
          ? {
              worktree: {
                ...(named ? { named } : {}),
                ...(startFrom ? { startFrom } : {}),
              },
            }
          : {}),
      title:
        scope.kind === "pr"
          ? `PR #${scope.ref.number}`
          : scope.kind === "review"
            ? "Deep review"
            : "New chat",
      created: Date.now(),
      updated: Date.now(),
      messages: [],
      ...(startedBy ? { startedBy } : {}),
      ...(links?.length ? { links } : {}),
    };
    await this.core.storage.add(chat);
    return chatSummary(chat);
  }
  /**
   * A new thread holding the conversation up to an answer, side conversation
   * included when the answer is in one. The original keeps its turns' changes
   * to review and roll back; the fork starts without them.
   */
  async fork(id: string, messageId?: string) {
    const source = await this.core.storage.load(id);
    if (source.scope.kind === "review")
      throw new Error("A deep review can't be forked.");
    const at = messageId
      ? source.messages.find((m) => m.id === messageId)
      : [...source.messages]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" &&
              m.status !== "streaming" &&
              !m.parentId &&
              !m.side &&
              !m.handoff &&
              !m.compaction &&
              !m.reload &&
              !m.worktreeCommand,
          );
    if (at?.role !== "assistant" || at.status === "streaming")
      throw new Error("Fork from an answer that has finished.");
    const upTo = source.messages.slice(0, source.messages.indexOf(at) + 1);
    const side = at.parentId;
    const main = side
      ? upTo.slice(0, upTo.findIndex((m) => m.id === side) + 1)
      : upTo;
    const kept = upTo.filter((m) =>
      side
        ? m.parentId === side || (!m.parentId && main.includes(m))
        : !m.parentId,
    );
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId: source.projectId,
      scope: source.scope,
      title: `Fork: ${source.title}`.slice(0, 120),
      created: Date.now(),
      updated: Date.now(),
      ...(source.branch ? { branch: source.branch } : {}),
      // Its own worktree, made from the checkout with its first message.
      ...(source.worktree ? { worktree: {} } : {}),
      ...(source.links ? { links: source.links } : {}),
      messages: kept.map(({ changes, pending, seq, parentId, ...m }) => ({
        ...structuredClone(m),
        id: randomUUID(),
        version: 1,
      })),
    };
    const notes = ThreadNotes.forFork(
      source.notes,
      new Map(kept.map((m, i) => [m.id, chat.messages[i]!.id])),
    );
    if (notes) chat.notes = notes;
    chat.forkedAt = chat.messages.at(-1)!.id;
    await this.core.storage.copyImages(source.id, chat.id, kept);
    await this.core.storage.shown.copy(
      source.id,
      chat.id,
      new Map(kept.map((m, i) => [m.id, chat.messages[i]!.id])),
    );
    await this.core.storage.renders.copy(
      source.id,
      chat.id,
      kept.flatMap((m) => m.renders ?? []).map((r) => r.id),
    );
    await this.core.storage.add(chat);
    return chatSummary(chat);
  }
}
