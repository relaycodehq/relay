import type {
  AgentActivity,
  AgentProvider,
  ChatMessage,
  ContextUsage,
  ForkPoint,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { resolveTurnModel } from "../../shared/turn-model";
import { watchAgentWorktrees } from "../agent-worktrees";
import { agentRuntime } from "../agents";
import { AnswerRecorder } from "../answer-recorder";
import { turnRules, type ChatTurn } from "../chat-turn";
import { ClaudeSignedOutError } from "../rooms/claude-sign-in";
import { projectTasks } from "../tasks";
import { finishTurn, resumeTurn, startTurn } from "../turn-changes";
import { commitWatch } from "../turn-commit";
import type { AgentControl } from "./active";
import type { ChatCore } from "./core";
import { agentSession, dropSession, sessionFor } from "./sessions";
import type { ChatSharing } from "./sharing";
import type { ThreadTitles } from "./titles";

/**
 * The first turn of a side conversation or a forked thread with the agent
 * that wrote its answer starts from a copy of that agent's session, cut
 * right after the answer.
 */
export function forkFor(
  chat: ProjectChat,
  provider: AgentProvider,
  parentId?: string,
) {
  if (agentSession(chat, provider, parentId).thread) return;
  const from = chat.messages.find((m) => m.id === (parentId ?? chat.forkedAt));
  return from?.role === "assistant" &&
    from.provider === provider &&
    from.forkPoint
    ? { point: from.forkPoint, from }
    : undefined;
}
/**
 * What a turn runs on, with Default resolved as the agent's settings stand
 * now. Both lists are cached, as the composer keeps them warm.
 */
export async function turnModel(
  provider: AgentProvider,
  input: ProjectChatSend,
  root: string,
) {
  const runtime = agentRuntime(provider);
  const [models, defaults] = await Promise.all([
    runtime.models().catch(() => []),
    runtime.defaults(root).catch(() => null),
  ]);
  return resolveTurnModel(provider, input, models, defaults);
}

/** Runs one agent turn in a thread, recording its answer as it streams. */
export class TurnRunner {
  constructor(
    private core: ChatCore,
    private titles: ThreadTitles,
    private sharing: ChatSharing,
    /** The folder Relay makes threads' worktrees in. */
    private worktreesFolder: string,
    /** Claude started a turn of its own in the session. */
    private unprompted: (
      chat: ProjectChat,
      root: string,
      provider: AgentProvider,
      parentId?: string,
    ) => Promise<void>,
  ) {}

  /**
   * Runs `message` as the agent's answer to `prompt`. Resolves with the
   * message the answer ended in: a steer moves the rest to one of its own.
   */
  async run(
    chat: ProjectChat,
    message: ChatMessage,
    root: string,
    prompt: string,
    input: ProjectChatSend,
    abort: AbortController,
    turn: ChatTurn,
  ) {
    const rules = turnRules(turn);
    const answer = new AnswerRecorder(
      chat,
      message,
      (m) => this.core.emit({ chatId: chat.id, message: m }),
      () => void this.core.storage.save(chat).catch(() => abort.abort()),
    );
    const branch = input.parentId ?? undefined;
    const firstUser = chat.messages.find((m) => m.role === "user");
    const attached = chat.messages.find((m) => m.id === input.id)?.images ?? [];
    const sessionKey = this.core.sessions.key(
      chat.id,
      input.parentId ?? undefined,
    );
    this.core.sessions.add(sessionKey);
    const provider = message.provider;
    if (rules.showsModel)
      void turnModel(provider, input, root).then((model) =>
        answer.setModel(model),
      );
    const sessionId = agentSession(chat, provider, input.parentId).thread;
    // A side thread forks the main one whole, its running turn included.
    const main = agentSession(chat, provider).thread;
    const fork: { point: ForkPoint; from?: ChatMessage } | undefined =
      turn.kind === "compact"
        ? undefined
        : rules.side
          ? !sessionId && main
            ? { point: { thread: main, at: "" } }
            : undefined
          : forkFor(chat, provider, input.parentId ?? undefined);
    // Each agent session hears about running processes on its own.
    const noteKey = JSON.stringify([sessionKey, provider]);
    if (!sessionId) projectTasks.forgetNote(noteKey);
    // What the agent itself touched, so the turn's card leaves out edits made meanwhile by anyone else.
    const edited = new Set<string>(),
      commands = new Map<string, string>();
    let commits: Awaited<ReturnType<typeof commitWatch>> | undefined;
    const watchWorktrees = watchAgentWorktrees(
      root,
      this.worktreesFolder,
      () => chat.agentWorktrees ?? [],
      async (worktrees) => {
        if (worktrees.length) chat.agentWorktrees = worktrees;
        else delete chat.agentWorktrees;
        await this.core.storage.persist(chat);
      },
    );
    let point: string | undefined,
      committed = false;
    try {
      const options = {
        onControl: (control: AgentControl) => {
          const active = this.core.active.get(chat.id);
          if (active?.abort === abort) active.steer = control.steer;
        },
        onSteered: (id: string) => answer.continueBelow(id),
        skills: turn.kind === "reply" ? (turn.skills ?? []) : [],
        compact: turn.kind === "compact",
        adopt: turn.kind === "adopt",
        onContext: (usage: ContextUsage) => answer.context(usage),
        onCost: (usd: number) => answer.cost(usd),
        cwd: root,
        prompt,
        context: async () =>
          projectTasks.note(
            root,
            noteKey,
            chat.id,
            chat.worktree
              ? await this.core.projects.root(chat.projectId)
              : undefined,
          ),
        choice: input.choice,
        signal: abort.signal,
        onText: (body: string) => answer.text(body),
        onPlan: (body: string) => answer.plan(body),
        images: attached.map((image) => ({
          path: this.core.storage.imagePath(chat.id, image),
          mimeType: image.mimeType,
        })),
        onTitle: (title: string) => {
          if (!branch) this.titles.heard(chat, answer.message, title);
        },
        onActivity: (activity: AgentActivity) => {
          if (activity.kind === "command" && activity.status === "running")
            projectTasks.record(root, chat.id, activity.label);
          if (activity.kind === "command") {
            commands.set(activity.id, activity.label);
            commits?.command(activity.label);
          } else if (activity.kind === "file") commits?.edited();
          watchWorktrees(activity);
          answer.activity(activity);
        },
        onCommentary: (id: string, text: string | null) =>
          answer.commentary(id, text),
        onEdit: (paths: string[]) => {
          for (const path of paths) edited.add(path);
        },
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        ...(chat.thinker ? { readOnly: true } : {}),
        ...(chat.reviewer
          ? {
              readOnly: true,
              ...(chat.reviewer.codex && rules.reviews
                ? { review: chat.reviewer.codex }
                : {}),
            }
          : {}),
        ...(rules.side ? { readOnly: true, side: true } : {}),
        // The thread's running answer owns its requests; a side turn asks none.
        onRequest: rules.side
          ? undefined
          : this.core.active.get(chat.id)?.requests.ask,
        session: {
          key: sessionKey,
          id: sessionId,
          fork: fork?.point,
          onPoint: (at: string) => {
            point = at;
          },
          onId: async (id: string) => {
            sessionFor(chat, provider, branch).thread = id;
            await this.core.storage.save(chat);
          },
          onUnprompted: () => this.unprompted(chat, root, provider, branch),
        },
      };
      // Taken right before the agent starts, so the card lists only its edits.
      const first = message.id;
      // A side turn changes nothing, and edits made meanwhile are the main answer's.
      const before = rules.records
        ? await (rules.resumesSnapshot ? resumeTurn : startTurn)(root, first)
        : null;
      if (before && !branch) {
        const checkout = chat.worktree
          ? await this.core.projects.root(chat.projectId)
          : root;
        commits = await commitWatch(
          checkout === root ? [root] : [root, checkout],
        );
      }
      try {
        const body = await agentRuntime(provider).run({
          ...options,
          contextWindow: input.contextWindow,
        });
        answer.message.body = body;
      } finally {
        // Before the status changes: a finished answer means a settled checkout.
        if (before) {
          const files = await finishTurn(
            root,
            first,
            before,
            answer.message.id,
            { edited: [...edited], commands: [...commands.values()] },
          );
          if (files.length) answer.message.changes = files;
          committed = !!(await commits?.ended());
        }
      }
      const done = answer.message;
      if (turn.kind === "compact") {
        // The summary goes beside the answer: a compaction still says nothing.
        const summary = done.body.trim();
        if (summary) done.compactSummary = summary.slice(0, 100000);
        done.body = "";
      }
      done.status = abort.signal.aborted ? "cancelled" : "complete";
      const { thread } = agentSession(chat, provider, input.parentId);
      if (done.status === "complete" && point && thread)
        done.forkPoint = { thread, at: point };
    } catch (e) {
      const failed = answer.message;
      failed.status = abort.signal.aborted ? "cancelled" : "failed";
      if (abort.signal.aborted) delete failed.error;
      else {
        failed.error = e instanceof Error ? e.message : String(e);
        if (e instanceof ClaudeSignedOutError) {
          failed.signIn = "claude";
          // The running CLI keeps the rejected login; the next turn starts one
          // that reads the new sign-in, resuming the same conversation.
          await agentRuntime(provider).closeSession(sessionKey);
        }
        // A fork that failed may have left a broken session. Drop it and the
        // fork point: sending again starts over with the conversation as text.
        if (fork) {
          dropSession(chat, provider, branch);
          await agentRuntime(provider).closeSession(sessionKey);
          if (fork.from) delete fork.from.forkPoint;
        }
      }
      if (rules.pausesQueue(failed)) chat.queuePaused = true;
    } finally {
      const owner = this.core.active.get(chat.id);
      if (owner?.abort === abort) owner.finishing = true;
      const ended = answer.message;
      if (ended.status !== "failed") {
        if (rules.advancesSession(ended))
          sessionFor(chat, provider, branch).through = ended.id;
        if (turn.kind === "reply") turn.briefed?.();
      }
      ended.ended = Date.now();
      // A finished answer is new activity: it reorders the thread and wakes
      // a snoozed or settled one.
      chat.updated = ended.ended;
      if (committed) chat.committedAt = ended.ended;
      answer.end();
      await this.core.storage.save(chat);
      if (chat.shared) await this.sharing.deliver(chat).catch(() => {});
      if (
        ended.status === "complete" &&
        rules.titles &&
        !branch &&
        firstUser &&
        firstUser.id === input.id
      )
        this.titles.generate(chat, input.choice, ended);
    }
    // A steer moves the rest of the answer to a message of its own.
    return answer.message;
  }
}
