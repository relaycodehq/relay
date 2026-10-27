import { randomUUID } from "node:crypto";
import type {
  ChatScope,
  ChatWorktree,
  ChatWorkspace,
  LinkedFolder,
  ProjectChat,
  StartedBy,
  WorktreeStart,
} from "../../shared/projects";
import { branchNameProblem } from "../../shared/branch-names";
import { joinedWorktree } from "../../shared/projects";
import { worktreeStartProblem } from "../git/worktrees";
import type { ThreadWorktrees } from "./worktrees";
import { joinableOn } from "./carry-on";
import type { ChatCore } from "./core";
import { ThreadNotes } from "./notes";
import { chatSummary } from "./chat-summaries";

/** New threads: empty ones, and forks of an existing one up to an answer. */
export class ThreadCreate {
  constructor(
    private core: ChatCore,
    private worktrees: Pick<ThreadWorktrees, "inRepoSettled">,
  ) {}

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
    const projectChats = (this.core.store.get().chats ?? []).filter(
      (c) => c.projectId === projectId,
    );
    // Joining a thread by itself is no longer offered, but a draft from
    // before can still ask: it carries on that thread's branch, and with
    // the thread gone it's a plain new worktree.
    const asked =
      start && "thread" in start
        ? projectChats.find((c) => c.id === start.thread)?.worktree?.branch
        : undefined;
    const picked: WorktreeStart | undefined =
      start && "thread" in start ? (asked ? { on: asked } : undefined) : start;
    // A carried-on branch keeps its own name.
    const named =
      workspace === "worktree" && !(picked && "on" in picked)
        ? branch
        : undefined;
    const startFrom = workspace === "worktree" ? picked : undefined;
    // A name git can't take is a typo to fix; one that's taken by the time
    // the first message sends falls back to `relay/…`, and the thread says so.
    const problem = named && branchNameProblem(named);
    if (problem) throw new Error(problem);
    if (!startFrom)
      return this.add(projectId, scope, workspace, { startedBy, named, links });
    const root = await this.core.projects.root(projectId);
    // In the repository's queue, where a worktree's removal asks again
    // whether anyone works in it: whichever comes second sees the other. One
    // being torn down is waited out.
    return this.worktrees.inRepoSettled(root, async () => {
      // On a branch another thread's worktree is on: the same folder, both
      // threads working in it, as T3 shares one.
      const joining =
        "on" in startFrom
          ? await joinableOn(
              root,
              (this.core.store.get().chats ?? []).filter(
                (c) => c.projectId === projectId,
              ),
              startFrom.on,
            )
          : undefined;
      const joined =
        joining &&
        joinedWorktree((await this.core.storage.load(joining.id)).worktree!);
      // So is a branch to start from that isn't there; anywhere else it
      // is, the first message finds it a folder. One that goes by then
      // falls back the same way.
      const startProblem =
        !joined && (await worktreeStartProblem(root, startFrom));
      if (startProblem) throw new Error(startProblem);
      return this.add(projectId, scope, workspace, {
        startedBy,
        named,
        links,
        ...(joined ? { worktree: joined } : { startFrom }),
      });
    });
  }

  private async add(
    projectId: string,
    scope: ChatScope,
    workspace: ChatWorkspace,
    {
      startedBy,
      named,
      links,
      startFrom,
      worktree,
    }: {
      startedBy?: StartedBy;
      named?: string;
      links?: LinkedFolder[];
      startFrom?: WorktreeStart;
      worktree?: ChatWorktree;
    },
  ) {
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId,
      scope,
      // The worktree itself is made with the first message, named after it
      // unless the user named its branch.
      ...(worktree
        ? { worktree }
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
