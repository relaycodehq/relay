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
import { linksInstructions, threadLinks } from "../../shared/projects";
import { goalChanged, type ThreadGoal } from "../../shared/goal";
import {
  threadWorktreePaths,
  turnWorkspace,
  watchAgentWorktrees,
} from "./agent-worktrees";
import { agentRuntime } from "../agents";
import { accountFor, accountLabel } from "../agents/accounts";
import { hasAccounts, SYSTEM_ACCOUNT } from "../../shared/agent-accounts";
import { AnswerRecorder } from "./answer-recorder";
import { agentJob, turnRules, type ChatTurn } from "./chat-turn";
import { isAgentError, type AgentError } from "../agents/errors";
import type { AgentWatch, UsageReport } from "../agents/types";
import { projectTasks } from "../terminal/tasks";
import { publishFindings, settleFixes } from "../findings";
import { relayToolsFor } from "../relay-mcp";
import type { AgentControl } from "./active";
import type { ChatCore } from "./core";
import { agentSession, dropSession, sessionFor } from "./sessions";
import type { ThreadTitles } from "./titles";
import { TurnSnapshot } from "./turn-snapshot";
import type { AgentQuestion } from "../../shared/agent-modes";
import { errorMessage } from "../../shared/error-message";

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
  /** Keeps copies of the images a finished answer shows. */
  keepShown(chat: ProjectChat, message: ChatMessage): Promise<void>;
}

type Fork = { point: ForkPoint; from?: ChatMessage };

/** One turn being run: what its steps share. */
interface TurnState {
  chat: ProjectChat;
  root: string;
  input: ProjectChatSend;
  turn: ChatTurn;
  rules: ReturnType<typeof turnRules>;
  abort: AbortController;
  answer: AnswerRecorder;
  provider: AgentProvider;
  /** The side conversation it answers in, if any. */
  branch?: string;
  sessionKey: string;
  account?: string;
  fork?: Fork;
  /** It answers the thread's first prompt, which names the thread. */
  first: boolean;
  /** Where the agent's session stood at the end, to fork from later. */
  point?: string;
  limit?: AgentError;
}

/** Runs one agent turn in a thread, recording its answer as it streams. */
export class TurnRunner {
  constructor(
    private core: ChatCore,
    private titles: ThreadTitles,
    private host: TurnRunnerHost,
  ) {}

  /** What the thread reaches beyond its folder; a reviewer reaches what its thread does. */
  private async links(chat: ProjectChat, root: string) {
    const parent = chat.reviewer?.parent;
    const own = parent
      ? await this.core.storage.load(parent).then(
          (c) => c.links,
          () => undefined,
        )
      : chat.links;
    const project = this.core.projects.get(chat.projectId).settings?.links;
    return threadLinks(project, own, root).map(({ from, ...link }) => link);
  }

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
      () => void this.core.storage.checkpoint(chat).catch(() => abort.abort()),
    );
    const stop = () => answer.stop();
    abort.signal.addEventListener("abort", stop, { once: true });
    const active = this.core.active.get(chat.id);
    // The turn this runs in, when it's one of the thread's own.
    const mine = this.core.active.of(abort);
    if (mine) mine.answer = () => answer.message;
    const owned = !rules.side && active?.abort === abort;
    if (owned) {
      active.render = (render) => answer.render(render);
      active.askPage = (group) => answer.askPage(group);
      active.preview = (preview) => answer.preview(preview);
      active.importOffer = (offer) => answer.importOffer(offer);
      active.answerId = () => answer.message.id;
    }
    const branch = input.parentId ?? undefined;
    const sessionKey = this.core.sessions.key(chat.id, branch);
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
    const sessionId = agentSession(chat, provider, branch).thread;
    // A side thread forks the main one whole, its running turn included.
    const main = agentSession(chat, provider).thread;
    const fork: Fork | undefined =
      turn.kind === "compact"
        ? undefined
        : rules.side
          ? !sessionId && main
            ? { point: { thread: main, at: "" } }
            : undefined
          : forkFor(chat, provider, branch);
    const t: TurnState = {
      chat,
      root,
      input,
      turn,
      rules,
      abort,
      answer,
      provider,
      branch,
      sessionKey,
      account,
      fork,
      first: chat.messages.find((m) => m.role === "user")?.id === input.id,
    };
    const snapshot = new TurnSnapshot(root, message.id, rules.records);
    try {
      const options = await this.options(t, prompt, sessionId, snapshot);
      await snapshot.start(
        rules.resumesSnapshot,
        branch
          ? undefined
          : async () =>
              chat.worktree
                ? await this.core.projects.root(chat.projectId)
                : root,
      );
      if (owned) active.moved = (path) => snapshot.moved(path);
      if (mine) this.core.active.running(chat.id, mine, answer.message.id);
      try {
        const body = await this.ask(t, options);
        if (!answer.stopped) answer.message.body = body;
      } finally {
        await snapshot.finish(chat, answer.message, provider);
        // The agent's session started in the folder it left; the next turn
        // starts it again in the worktree.
        if (snapshot.counted !== root && !this.core.active.hasSide(chat.id))
          this.core.sessions.close(chat.id);
      }
      this.complete(t);
    } catch (e) {
      await this.fail(t, e, active);
    } finally {
      abort.signal.removeEventListener("abort", stop);
      // A stopped turn reads as stopping until it ends; the ledger keeps it so.
      if (mine) this.core.active.finishing(chat.id, mine);
      await this.end(t, snapshot.committed);
    }
    // A steer moves the rest of the answer to a message of its own.
    return answer.message;
  }

  /** What the agent runs the turn with, and how what it does lands in the answer. */
  private async options(
    t: TurnState,
    prompt: string,
    sessionId: string | undefined,
    snapshot: TurnSnapshot,
  ) {
    const { chat, root, input, turn, rules, abort, answer, provider, branch } =
      t;
    // Each agent session hears about running processes on its own.
    const noteKey = JSON.stringify([t.sessionKey, provider]);
    if (!sessionId) projectTasks.forgetNote(noteKey);
    const workspace = turnWorkspace(chat, provider);
    const watchWorktrees = watchAgentWorktrees(
      await this.core.projects.root(chat.projectId),
      () => threadWorktreePaths(this.core.store.get().chats),
      () => chat.agentWorktrees ?? [],
      async (worktrees) => {
        workspace(worktrees);
        await this.core.storage.save(chat);
      },
    );
    const relayTools = relayToolsFor(
      chat.id,
      !!chat.startedBy,
      this.core.store.get().renderMode,
      !!chat.importFrom,
    );
    const env = await this.host.env(chat);
    const links = await this.links(chat, root);
    const attached = [
      ...((turn.kind === "reply" && turn.carried) || []),
      ...(chat.messages.find((m) => m.id === input.id)?.images ?? []),
    ];
    const watch = this.watch(t);
    let goalSaved = 0;
    return {
      onControl: (control: AgentControl) => {
        const active = this.core.active.get(chat.id);
        if (active?.abort !== abort) return;
        active.steer = control.steer;
        active.goal = control.goal;
        active.retune = control.retune;
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
      onSteerUnread: (id: string, error?: Error) =>
        answer.unreadSteer(id, error),
      job: agentJob(turn, chat),
      // A reviewer's work counts toward the thread it serves.
      usage: {
        chat: chat.reviewer?.parent ?? chat.id,
        project: chat.projectId,
      },
      onContext: (usage: ContextUsage) => answer.context(usage),
      onCost: (usd: number) => answer.cost(usd),
      onUsage: (usage: UsageReport) => {
        if (usage.streamed && !usage.subagent) answer.streamed(usage.streamed);
      },
      cwd: root,
      ...(links.length ? { links } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      prompt,
      ...(turn.kind === "reply" && turn.request
        ? { request: turn.request }
        : {}),
      context: async () => {
        const note = await projectTasks.note(
          root,
          noteKey,
          chat.id,
          chat.worktree
            ? await this.core.projects.root(chat.projectId)
            : undefined,
        );
        return (
          [note, linksInstructions(links)].filter(Boolean).join("\n\n") ||
          undefined
        );
      },
      choice: input.choice,
      account: t.account,
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
        snapshot.activity(activity);
        watchWorktrees(activity);
        answer.activity(activity);
      },
      onCommentary: (id: string, text: string | null) =>
        answer.commentary(id, text),
      onQuestions: rules.side
        ? undefined
        : (id: string, questions: AgentQuestion[]) =>
            answer.questions(id, questions),
      onEdit: (paths: string[]) => snapshot.edits(paths),
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      ...(chat.reviewer || rules.side ? { readOnly: true } : {}),
      // A started thread only gets the reading ones: no threads of threads.
      ...(relayTools && !chat.reviewer && !rules.side ? { relayTools } : {}),
      // The thread's running answer owns its requests; a side turn asks none.
      onRequest: rules.side
        ? undefined
        : this.core.active.get(chat.id)?.requests.ask,
      ...(watch ? { watch } : {}),
      session: {
        key: t.sessionKey,
        id: sessionId,
        fork: t.fork?.point,
        onPoint: (at: string) => {
          t.point = at;
        },
        onId: async (id: string) => {
          sessionFor(chat, provider, branch).thread = id;
          await this.core.storage.save(chat);
        },
        onUnprompted: () => this.host.unprompted(chat, root, provider, branch),
      },
    };
  }

  /**
   * The thread's own turns, including the ones Claude starts when a
   * background subagent ends. Claude asks beside its live session, Codex
   * and OpenCode in a throwaway fork of the thread, as Codex's /side does.
   */
  private watch({ chat, turn, rules, answer, provider }: TurnState) {
    const { watchThreads: scope = "off", watchKnown: known = [] } =
      this.core.store.get();
    if (
      scope === "off" ||
      (provider !== "claude" &&
        provider !== "codex" &&
        provider !== "opencode") ||
      (turn.kind !== "reply" && turn.kind !== "adopt") ||
      rules.side ||
      chat.reviewer
    )
      return;
    const threadNotes = chat.messages.flatMap((m) => m.notes ?? []);
    return {
      scope,
      known,
      shown: threadNotes.map((n) => `${n.title}: ${n.line}`),
      // Older notes don't carry the flag; their title in the known list says it.
      topics: threadNotes
        .filter((n) => n.known || (n.closed && known.includes(n.title)))
        .map((n) => `${n.title}: ${n.line}`),
      onNote: (note) => answer.note(note),
      onSpend: (spend) => this.core.watchSpend?.add(chat.id, spend),
    } satisfies AgentWatch;
  }

  /** The agent's answer, asked again once from Relay's record when it lost the history. */
  private async ask(
    t: TurnState,
    options: Awaited<ReturnType<TurnRunner["options"]>>,
  ) {
    const { chat, turn, abort, provider, branch, fork } = t;
    const runtime = agentRuntime(provider);
    const run = () =>
      runtime.run({ ...options, contextWindow: t.input.contextWindow });
    try {
      return await run();
    } catch (error) {
      if (
        !isAgentError(error, "missingHistory") ||
        turn.kind !== "reply" ||
        !turn.importedPrompt ||
        abort.signal.aborted
      )
        throw error;
      // A refused resume/fork never started a turn. Recover once from
      // Relay's own record, without repeating any agent work.
      dropSession(chat, provider, branch);
      await runtime.closeSession(t.sessionKey);
      if (fork?.from) delete fork.from.forkPoint;
      if (chat.fromTerminal) chat.fromTerminal.how = "text";
      options.session.id = undefined;
      options.session.fork = undefined;
      options.prompt = turn.importedPrompt;
      await this.core.storage.save(chat);
      return await run();
    }
  }

  /** The agent finished, or was stopped while it answered. */
  private complete({
    chat,
    root,
    input,
    turn,
    abort,
    answer,
    provider,
    point,
  }: TurnState) {
    const done = answer.message;
    if (turn.kind === "compact") {
      // The summary goes beside the answer: a compaction still says nothing.
      const summary = done.body.trim();
      if (summary) done.compactSummary = summary.slice(0, 100000);
      done.body = "";
    }
    done.status = abort.signal.aborted ? "cancelled" : "complete";
    if (
      done.status === "complete" &&
      (turn.kind === "reply" || turn.kind === "adopt") &&
      !done.parentId &&
      !chat.reviewer
    )
      publishFindings(chat, done, root);
    const { thread } = agentSession(chat, provider, input.parentId);
    if (done.status === "complete" && point && thread)
      done.forkPoint = { thread, at: point };
  }

  private async fail(
    t: TurnState,
    e: unknown,
    active: ReturnType<ChatCore["active"]["get"]>,
  ) {
    const { chat, rules, abort, answer, provider, account, fork } = t;
    const failed = answer.message;
    failed.status = abort.signal.aborted ? "cancelled" : "failed";
    if (abort.signal.aborted) delete failed.error;
    else {
      failed.error = errorMessage(e);
      if (
        isAgentError(e, "signedOut") &&
        account &&
        account !== SYSTEM_ACCOUNT &&
        hasAccounts(provider)
      ) {
        // The terminal's login would sign in the usual account, not this one.
        failed.error = `${accountLabel(provider, account)} is signed out. Sign it in again in Settings → AI & agents → Agents, then resume the answer.`;
        await agentRuntime(provider).closeSession(t.sessionKey);
      } else if (isAgentError(e, "signedOut")) {
        failed.signIn = e.provider;
        // The running agent keeps the rejected login; the next turn starts
        // one that reads the new sign-in, resuming the same conversation.
        await agentRuntime(provider).closeSession(t.sessionKey);
      }
      // A handoff note, side question or catch-up isn't the answer to carry on.
      if (isAgentError(e, "usageLimit") && rules.plansResume) t.limit = e;
      // A fork that failed may have left a broken session. Drop it and the
      // fork point: sending again starts over with the conversation as text.
      if (fork) {
        dropSession(chat, provider, t.branch);
        await agentRuntime(provider).closeSession(t.sessionKey);
        if (fork.from) delete fork.from.forkPoint;
      }
    }
    if (failed.status === "failed" && failed.compactedCold)
      console.warn(
        "Could not compact the cold conversation first, sending anyway:",
        e,
      );
    if (
      rules.pausesQueue(failed) &&
      !(abort.signal.aborted && active?.abort === abort && active.keepsQueue)
    )
      chat.queuePaused = true;
  }

  /** However the turn went: settles the thread, saves it, and lets the sidebar know. */
  private async end(t: TurnState, committed: boolean) {
    const { chat, input, turn, rules, answer, provider, branch } = t;
    const ended = answer.message;
    if (turn.kind === "reply")
      settleFixes(chat.findings, input.id, ended.status === "complete");
    if (ended.status !== "failed") {
      if (rules.advancesSession(ended))
        sessionFor(chat, provider, branch).through = ended.id;
      if (turn.kind === "reply") turn.briefed?.();
    }
    // A stopped answer ended when it was stopped, not when its agent let go.
    ended.ended = answer.stopped ? (ended.ended ?? Date.now()) : Date.now();
    // A finished answer is new activity: it reorders the thread and can
    // unsettle it. Snoozed threads stay hidden until their wake time. A
    // compaction while you were away isn't news, and leaves a read thread read.
    if (!ended.compactedIdle) chat.updated = ended.ended;
    if (committed) chat.committedAt = ended.ended;
    await this.host.keepShown(chat, ended);
    answer.end();
    // The sidebar hears of the finished answer once the turn lets go of the thread.
    await this.core.storage.save(chat, { holdSummary: true });
    // The agents the turn ran outlive the session that followed them.
    void this.core.sessions.keepSubagents(chat.id);
    if (t.limit) this.host.limited(chat.id, ended.id, t.limit);
    if (ended.status === "complete" && rules.titles && !branch && t.first)
      this.titles.generate(chat, input.choice, ended);
  }
}
