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
import { goalChanged, type ThreadGoal } from "../../shared/goal";
import { watchAgentWorktrees } from "./agent-worktrees";
import { agentRuntime } from "../agents";
import { accountFor, accountLabel } from "../agents/accounts";
import { hasAccounts, SYSTEM_ACCOUNT } from "../../shared/agent-accounts";
import { AnswerRecorder } from "./answer-recorder";
import { agentJob, turnRules, type ChatTurn } from "./chat-turn";
import { isAgentError, type AgentError } from "../agents/errors";
import type { AgentWatch } from "../agents/types";
import { projectTasks } from "../terminal/tasks";
import { currentBranchOr } from "../git/git";
import { finishTurn, resumeTurn, startTurn } from "../git/turn-changes";
import { keepIgnored, recordIgnored } from "../git/ignored-touches";
import { commitWatch } from "./turn-commit";
import { relayToolsFor } from "../relay-mcp";
import type { AgentControl } from "./active";
import type { ChatCore } from "./core";
import { agentSession, dropSession, sessionFor } from "./sessions";
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

export interface TurnRunnerHost {
  /** Claude started a turn of its own in the session. */
  unprompted(
    chat: ProjectChat,
    root: string,
    provider: AgentProvider,
    parentId?: string,
  ): Promise<void>;
  /** A usage limit stopped the reply `messageId`. */
  limited(chatId: string, messageId: string, limit: AgentError): void;
  /** What the thread's agent process is told about its worktree. */
  env(chat: ProjectChat): Promise<Record<string, string>>;
}

/** Runs one agent turn in a thread, recording its answer as it streams. */
export class TurnRunner {
  constructor(
    private core: ChatCore,
    private titles: ThreadTitles,
    /** The folder Relay makes threads' worktrees in. */
    private worktreesFolder: string,
    private host: TurnRunnerHost,
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
    const stop = () => answer.stop();
    abort.signal.addEventListener("abort", stop, { once: true });
    const branch = input.parentId ?? undefined;
    const firstUser = chat.messages.find((m) => m.role === "user");
    const attached = chat.messages.find((m) => m.id === input.id)?.images ?? [];
    const sessionKey = this.core.sessions.key(
      chat.id,
      input.parentId ?? undefined,
    );
    this.core.sessions.add(sessionKey);
    const provider = message.provider;
    // A thread keeps the account it started on, and the one a limit moved it
    // to; the composer's pick only says where a thread's first turn goes.
    const account = hasAccounts(provider)
      ? accountFor(provider, chat.accounts?.[provider] ?? input.account)
      : undefined;
    if (
      account &&
      hasAccounts(provider) &&
      chat.accounts?.[provider] !== account
    )
      chat.accounts = { ...chat.accounts, [provider]: account };
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
        await this.core.storage.save(chat);
      },
    );
    let point: string | undefined,
      goalSaved = 0,
      committed = false,
      limit: AgentError | undefined;
    // The thread's own turns, including the ones Claude starts when a
    // background subagent ends. Claude asks beside its live session, Codex
    // in a throwaway fork of the thread, as its own /side does.
    const { watchThreads: scope = "off", watchKnown: known = [] } =
      this.core.store.get();
    const threadNotes = chat.messages.flatMap((m) => m.notes ?? []);
    const watch: AgentWatch | undefined =
      scope !== "off" &&
      (provider === "claude" || provider === "codex") &&
      (turn.kind === "reply" || turn.kind === "adopt") &&
      !rules.side &&
      !chat.thinker &&
      !chat.reviewer
        ? {
            scope,
            known,
            shown: threadNotes.map((n) => `${n.title}: ${n.line}`),
            // Older notes don't carry the flag; their title in the known list says it.
            topics: threadNotes
              .filter((n) => n.known || (n.closed && known.includes(n.title)))
              .map((n) => `${n.title}: ${n.line}`),
            onNote: (note) => answer.note(note),
            onSpend: (spend) => this.core.watchSpend?.add(chat.id, spend),
          }
        : undefined;
    try {
      const relayTools = relayToolsFor(chat.id, !!chat.startedBy);
      const env = await this.host.env(chat);
      const options = {
        onControl: (control: AgentControl) => {
          const active = this.core.active.get(chat.id);
          if (active?.abort !== abort) return;
          active.steer = control.steer;
          active.goal = control.goal;
        },
        ...(!branch && chat.goal?.provider === provider
          ? { goal: chat.goal }
          : {}),
        onGoal: (goal: ThreadGoal | null) => {
          // A goal belongs to the main conversation; side ones run their own.
          if (branch || rules.side) return;
          const before = chat.goal;
          if (goal) chat.goal = goal;
          else delete chat.goal;
          // Token counts tick with every tool call; the thread file holds every message.
          const now = Date.now();
          if (!goalChanged(before, goal) && now - goalSaved < 15_000) return;
          goalSaved = now;
          void this.core.storage
            .save(chat)
            .catch((e) => console.warn("Could not save the goal:", e));
        },
        onSteered: (id: string) => answer.continueBelow(id),
        skills: turn.kind === "reply" ? (turn.skills ?? []) : [],
        job: agentJob(turn, chat),
        // A reviewer's or thinker's work counts toward the thread it serves.
        usage: {
          chat: (chat.reviewer ?? chat.thinker)?.parent ?? chat.id,
          project: chat.projectId,
        },
        onContext: (usage: ContextUsage) => answer.context(usage),
        onCost: (usd: number) => answer.cost(usd),
        cwd: root,
        ...(Object.keys(env).length ? { env } : {}),
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
        account,
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
        ...(chat.thinker || chat.reviewer || rules.side
          ? { readOnly: true }
          : {}),
        // A started thread only gets the reading ones: no threads of threads.
        ...(relayTools && !chat.thinker && !chat.reviewer && !rules.side
          ? { relayTools }
          : {}),
        // The thread's running answer owns its requests; a side turn asks none.
        onRequest: rules.side
          ? undefined
          : this.core.active.get(chat.id)?.requests.ask,
        ...(watch ? { watch } : {}),
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
          onUnprompted: () =>
            this.host.unprompted(chat, root, provider, branch),
        },
      };
      // Taken right before the agent starts, so the card lists only its edits.
      const first = message.id;
      // A side turn changes nothing, and edits made meanwhile are the main answer's.
      // Ignored files stay out of the snapshot; a resumed turn may have written them already.
      const [before, ignoredStart] = await Promise.all([
        rules.records
          ? (rules.resumesSnapshot ? resumeTurn : startTurn)(root, first)
          : null,
        rules.records && !rules.resumesSnapshot
          ? keepIgnored(root).catch((e) => {
              console.warn("Could not keep the ignored files:", e);
              return null;
            })
          : null,
      ]);
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
        if (!answer.stopped) answer.message.body = body;
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
          await recordIgnored(root, ignoredStart, [...edited], provider).catch(
            (e) => console.warn("Could not list the ignored files edited:", e),
          );
          committed = !!(await commits?.ended());
          // The agent may have left the checkout on another branch, as landing one in main does.
          chat.branch = await currentBranchOr(root, chat.branch);
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
        if (
          isAgentError(e, "signedOut") &&
          account &&
          account !== SYSTEM_ACCOUNT &&
          hasAccounts(provider)
        ) {
          // The terminal's login would sign in the usual account, not this one.
          failed.error = `${accountLabel(provider, account)} is signed out. Sign it in again in Settings → AI models → Accounts, then resume the answer.`;
          await agentRuntime(provider).closeSession(sessionKey);
        } else if (isAgentError(e, "signedOut")) {
          failed.signIn = e.provider;
          // The running agent keeps the rejected login; the next turn starts
          // one that reads the new sign-in, resuming the same conversation.
          await agentRuntime(provider).closeSession(sessionKey);
        }
        // A handoff note, side question or catch-up isn't the answer to carry on.
        if (isAgentError(e, "usageLimit") && rules.plansResume) limit = e;
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
      abort.signal.removeEventListener("abort", stop);
      const owner = this.core.active.get(chat.id);
      if (owner?.abort === abort) owner.finishing = true;
      const ended = answer.message;
      if (ended.status !== "failed") {
        if (rules.advancesSession(ended))
          sessionFor(chat, provider, branch).through = ended.id;
        if (turn.kind === "reply") turn.briefed?.();
      }
      // A stopped answer ended when it was stopped, not when its agent let go.
      ended.ended = answer.stopped ? (ended.ended ?? Date.now()) : Date.now();
      // A finished answer is new activity: it reorders the thread and wakes
      // a snoozed or settled one.
      chat.updated = ended.ended;
      if (committed) chat.committedAt = ended.ended;
      answer.end();
      // The sidebar hears of the finished answer once the turn lets go of the thread.
      await this.core.storage.save(chat, { holdSummary: true });
      if (limit) this.host.limited(chat.id, ended.id, limit);
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
