import type {
  AgentProvider,
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { resolveTurnModel } from "../../shared/turn-model";
import { agentRuntime } from "../agents";
import { accountFor, accountLabel } from "../agents/accounts";
import { hasAccounts, SYSTEM_ACCOUNT } from "../../shared/agent-accounts";
import { AnswerRecorder } from "./answer-recorder";
import { turnRules, type ChatTurn } from "./chat-turn";
import { isAgentError } from "../agents/errors";
import { publishFindings, settleFixes } from "../findings";
import type { ActiveChat } from "./active";
import type { ChatCore } from "./core";
import { agentSession, dropSession, sessionFor } from "./sessions";
import type { ThreadTitles } from "./titles";
import { judgeGuess } from "./turn-check";
import { turnOptions, type TurnOptions } from "./turn-options";
import { TurnSnapshot } from "./turn-snapshot";
import type { Fork, TurnRunnerHost, TurnState } from "./turn-state";
import { errorMessage } from "../../shared/error-message";

export type { TurnRunnerHost } from "./turn-state";

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

/** Lets the agent's tools reach the answer the thread's turn is writing. */
function connectAnswer(active: ActiveChat, answer: AnswerRecorder) {
  active.render = (render) => answer.render(render);
  active.askPage = (group) => answer.askPage(group);
  active.preview = (preview) => answer.preview(preview);
  active.importOffer = (offer) => answer.importOffer(offer);
  active.answerId = () => answer.message.id;
}

/**
 * The account a turn runs on, kept on the thread. A thread stays on the
 * account it started on, or the one a limit moved it to; the composer's pick
 * only says where a thread's first turn goes.
 */
function keepAccount(
  chat: ProjectChat,
  provider: AgentProvider,
  input: ProjectChatSend,
) {
  if (!hasAccounts(provider)) return undefined;
  const account = accountFor(
    provider,
    chat.accounts?.[provider] ?? input.account,
  );
  if (account && chat.accounts?.[provider] !== account)
    chat.accounts = { ...chat.accounts, [provider]: account };
  return account;
}

/** The session a turn starts from a copy of, if any; see forkFor. */
function forkOf({
  chat,
  provider,
  replyTo,
  turn,
  rules,
}: Pick<TurnState, "chat" | "provider" | "replyTo" | "turn" | "rules">):
  Fork | undefined {
  if (turn.kind === "compact") return undefined;
  if (!rules.side) return forkFor(chat, provider, replyTo);
  // A /btw side question copies the main conversation whole, its running
  // turn included, unless it has a session of its own already.
  const hasOwnSession = !!agentSession(chat, provider, replyTo).thread;
  const main = agentSession(chat, provider).thread;
  if (hasOwnSession || !main) return undefined;
  return { point: { thread: main, at: "" } };
}

/** Runs one agent turn in a thread, recording its answer as it streams. */
export class TurnRunner {
  constructor(
    private core: ChatCore,
    private titles: ThreadTitles,
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
      () =>
        this.core.storage.checkpoint(chat).catch(() => {
          abort.abort();
        }),
    );
    const stop = () => answer.stop();
    abort.signal.addEventListener("abort", stop, { once: true });
    const active = this.core.active.get(chat.id);
    // This run's turn in the ledger, when it's one of the thread's own.
    const ledgerTurn = this.core.active.of(abort);
    if (ledgerTurn) ledgerTurn.answer = () => answer.message;
    // The thread's running turn, not a /btw side question beside it.
    const isActiveTurn = !rules.side && active?.abort === abort;
    if (isActiveTurn) connectAnswer(active, answer);
    const replyTo = input.parentId ?? undefined;
    const sessionKey = this.core.sessions.key(chat.id, replyTo);
    this.core.sessions.add(sessionKey);
    const provider = message.provider;
    const account = keepAccount(chat, provider, input);
    if (rules.showsModel)
      void turnModel(provider, input, root).then((model) =>
        answer.setModel(model),
      );
    const sessionId = agentSession(chat, provider, replyTo).thread;
    const fork = forkOf({ chat, provider, replyTo, turn, rules });
    const t: TurnState = {
      chat,
      root,
      input,
      turn,
      rules,
      abort,
      answer,
      provider,
      replyTo,
      sessionKey,
      account,
      fork,
      first: chat.messages.find((m) => m.role === "user")?.id === input.id,
    };
    judgeGuess(this.core, t);
    const snapshot = new TurnSnapshot(root, message.id, rules.records);
    try {
      await this.runAgent(t, prompt, sessionId, snapshot, () => {
        if (isActiveTurn) active.moved = (path) => snapshot.moved(path);
        if (ledgerTurn)
          this.core.active.running(chat.id, ledgerTurn, answer.message.id);
      });
      this.complete(t);
    } catch (e) {
      await this.fail(t, e, active);
    } finally {
      abort.signal.removeEventListener("abort", stop);
      // A stopped turn reads as stopping until it ends; the ledger keeps it so.
      if (ledgerTurn) this.core.active.finishing(chat.id, ledgerTurn);
      await this.end(t, snapshot.committed);
    }
    // A steer moves the rest of the answer to a message of its own.
    return answer.message;
  }

  /**
   * Has the agent answer, with a snapshot around it counting what it
   * changes; `underWay` runs once the snapshot is taken and the agent starts.
   */
  private async runAgent(
    t: TurnState,
    prompt: string,
    sessionId: string | undefined,
    snapshot: TurnSnapshot,
    underWay: () => void,
  ) {
    const { chat, root, rules, replyTo, answer, provider } = t;
    const options = await turnOptions(
      { core: this.core, titles: this.titles, host: this.host },
      t,
      prompt,
      sessionId,
      snapshot,
    );
    // Commits are watched in the thread's checkout, though not for a turn in
    // a reply thread.
    const checkout = replyTo
      ? undefined
      : async () =>
          chat.worktree ? await this.core.projects.root(chat.projectId) : root;
    await snapshot.start(rules.resumesSnapshot, checkout);
    underWay();
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
  }

  /** The agent's answer, asked again once from Relay's record when it lost the history. */
  private async ask(t: TurnState, options: TurnOptions) {
    const { chat, turn, abort, provider, replyTo, fork } = t;
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
      dropSession(chat, provider, replyTo);
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
    const { chat, rules, abort, answer } = t;
    const failed = answer.message;
    const stopped = abort.signal.aborted;
    failed.status = stopped ? "cancelled" : "failed";
    if (stopped) delete failed.error;
    else await this.explainFailure(t, e);
    if (failed.status === "failed" && failed.compactedCold)
      console.warn(
        "Could not compact the cold conversation first, sending anyway:",
        e,
      );
    // A Stop that was asked to leave the queue going.
    const stoppedKeepingQueue =
      stopped && active?.abort === abort && !!active.keepsQueue;
    if (rules.pausesQueue(failed) && !stoppedKeepingQueue)
      chat.queuePaused = true;
  }

  /** Says why the turn failed, and clears up what the failure left behind. */
  private async explainFailure(t: TurnState, e: unknown) {
    const { chat, rules, answer, provider, account, fork } = t;
    const failed = answer.message;
    failed.error = errorMessage(e);
    if (isAgentError(e, "signedOut")) {
      // The terminal's login would sign in the usual account, not this one.
      const namedAccount =
        !!account && account !== SYSTEM_ACCOUNT && hasAccounts(provider);
      if (namedAccount)
        failed.error = `${accountLabel(provider, account)} is signed out. Sign it in again in Settings → AI & agents → Agents, then resume the answer.`;
      else failed.signIn = e.provider;
      // The running agent keeps the rejected login; the next turn starts
      // one that reads the new sign-in, resuming the same conversation.
      await agentRuntime(provider).closeSession(t.sessionKey);
    }
    // When the limit resets, Relay resends the user's last message. A
    // handoff note or a turn the agent started itself has none to resend.
    if (isAgentError(e, "usageLimit") && rules.plansResume) t.limit = e;
    // A fork that failed may have left a broken session. Drop it and the
    // fork point: sending again starts over with the conversation as text.
    if (fork) {
      dropSession(chat, provider, t.replyTo);
      await agentRuntime(provider).closeSession(t.sessionKey);
      if (fork.from) delete fork.from.forkPoint;
    }
  }

  /** However the turn went: settles the thread, saves it, and lets the sidebar know. */
  private async end(t: TurnState, committed: boolean) {
    const { chat, input, turn, rules, answer, provider, replyTo } = t;
    const ended = answer.message;
    if (turn.kind === "reply")
      settleFixes(chat.findings, input.id, ended.status === "complete");
    if (ended.status !== "failed") {
      if (rules.advancesSession(ended))
        sessionFor(chat, provider, replyTo).through = ended.id;
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
    if (ended.status === "complete" && rules.titles && !replyTo && t.first)
      this.titles.generate(chat, input.choice, ended);
  }
}
