import type { AgentOptions } from "../types";
import { ANSWER_LIMIT, guardSteer, TurnEnd } from "../turn-kit";
import { CodexPlanRows, codexActivity, codexEditedPaths } from "../activity";
import { withTimeout } from "../../util/timeout";
import { skillMentionPattern } from "../../../shared/skill-mentions";
import type { ContextUsage, PromptCache } from "../../../shared/projects";
import { CodexAnswerStream } from "./answer-stream";
import { CodexCacheClock } from "./codex-cache";
import type { CodexConnection } from "./codex-connection";
import { CodexGoalHold, codexGoal, codexGoals } from "./codex-goal";
import { codexFailure, codexSpentUntil } from "./codex-limits";
import { codexRequest } from "./codex-requests";
import {
  parseCodexNotification,
  readTokenUsage,
  type CodexNotification,
} from "./codex-schemas";
import { CodexRequestSpeed } from "./codex-speed";
import { CodexSubagents, codexSubagentBooks } from "./codex-subagents";
import type { CodexTransport } from "./codex-transport";
import { codexTokens, type CodexTurnWatch } from "./codex-watch";

const cancelled = () => new Error("Cancelled by you.");

/**
 * A report that carried tokens. At a compaction boundary Codex reports the
 * window's new size with every count at zero: that was no request.
 */
const requested = (t: ReturnType<typeof codexTokens>) =>
  t.input + t.cacheRead + t.cacheWrite + t.output > 0;

/** Codex reports the newest request's size as `last`; that is what fills the window. */
export function codexContextUsage(
  value: unknown,
  cache?: PromptCache,
): ContextUsage | undefined {
  const usage = readTokenUsage(value);
  const used = usage?.last?.totalTokens;
  if (!usage || typeof used !== "number" || !Number.isFinite(used) || used <= 0)
    return;
  const max = usage.modelContextWindow,
    total = usage.total?.totalTokens;
  return {
    usedTokens: used,
    ...(typeof max === "number" && max > 0 ? { maxTokens: max } : {}),
    ...(typeof total === "number" && total > used
      ? { totalTokens: total }
      : {}),
    ...(cache ? { cache } : {}),
  };
}

/**
 * Codex parses only `$name` as a skill, while the composer takes any currency
 * sign (`€review`); amounts like `€20` don't match and stay prose.
 */
export const codexMentions = (text: string) =>
  text.replace(skillMentionPattern, "$1$$$2");

/** One Relay run on a Codex thread: what its notifications say, and stopping it. */
export class CodexTurn {
  readonly end = new TurnEnd<string>();
  readonly goals: CodexGoalHold;
  readonly subagents: CodexSubagents;
  wire: CodexTransport | undefined;
  watcher: CodexTurnWatch | undefined;
  threadId = "";
  turnId = "";
  /** What a `/goal` that starts no turn says back. */
  said = "";
  private plan = "";
  /** Codex hands a finished `/review` back as one item, not as an answer. */
  private review = "";
  /**
   * The turn Codex runs a `/review` in, inside this run's own: interrupts and
   * steers name it, while `turn/completed` still ends the review under `turnId`.
   */
  private reviewTurnId = "";
  /** When the spent window lifts, from Codex's latest word on the account's limits. */
  private spentUntil: number | undefined;
  private fileChanges = new Map<string, unknown>();
  private plans = new CodexPlanRows();
  private stream: CodexAnswerStream;
  private speed = new CodexRequestSpeed();
  private cacheClock = new CodexCacheClock();
  private interruptTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly options: AgentOptions,
    private readonly connection: CodexConnection,
    /** The thread's key, when its subagents are kept between runs. */
    sessionKey: string | undefined,
    /** A thread's goal keeps the run open across the turns Codex starts for it. */
    private readonly holds: boolean,
  ) {
    this.stream = new CodexAnswerStream(options.onText, (id, text) =>
      options.onCommentary?.(id, text),
    );
    this.subagents = new CodexSubagents({
      book: sessionKey ? codexSubagentBooks.open(sessionKey) : undefined,
      onActivity: (activity) => options.onActivity?.(activity),
      onFileChange: (id, changes) => this.edited(id, changes),
      onUsage: (last, ran) => {
        const model = ran || options.choice.model || connection.started?.model;
        const tokens = codexTokens(last as Parameters<typeof codexTokens>[0]);
        if (model && requested(tokens))
          options.onUsage?.({
            model,
            tokens,
            fast: options.choice.fast,
            subagent: true,
          });
      },
      read: (id) =>
        this.wire
          ? this.wire.request("thread/read", {
              threadId: id,
              includeTurns: false,
            })
          : Promise.reject(new Error("Codex isn't connected.")),
      interrupt: (id, turn) =>
        this.wire
          ? this.wire.request("turn/interrupt", { threadId: id, turnId: turn })
          : Promise.resolve(),
    });
    this.goals = new CodexGoalHold(
      connection.goal,
      (goal) => options.onGoal?.(goal),
      () => void this.pauseGoal().finally(() => this.finish()),
    );
  }

  get settled() {
    return this.end.settled;
  }

  /** What the run answered so far: its plan, review, answer or goal reply. */
  get answer() {
    return this.plan || this.review || this.stream.answer || this.said;
  }

  private past(turnId: string) {
    if (!turnId) return;
    const past = this.connection.pastTurns;
    past.add(turnId);
    // Late word comes soon after; the oldest ids can go.
    if (past.size > 20) past.delete(past.values().next().value!);
  }

  /** Ends the run: in `error`, or in what it answered. */
  finish = (error?: Error) => {
    if (this.settled) return;
    this.past(this.turnId);
    void this.subagents.stop();
    if (error) this.end.fail(error);
    else this.end.succeed(this.answer);
  };

  notification = (method: string, raw: unknown) => {
    if (this.settled) return;
    let n: CodexNotification | undefined;
    try {
      n = parseCodexNotification(method, raw);
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!n) return;
    const { options } = this;
    const p = n.params;
    // Another thread here is a subagent's; it shows under its agent row, never in the answer.
    if (p.threadId && this.threadId && p.threadId !== this.threadId) {
      this.subagents.notification(n, this.turnId);
      return;
    }
    this.speed.observe(n);
    if (n.method === "account/rateLimits/updated")
      this.spentUntil = codexSpentUntil(n.params.rateLimits) ?? this.spentUntil;
    if (n.method === "thread/tokenUsage/updated")
      this.tokensUsed(n.params.tokenUsage);
    if (n.method === "thread/name/updated" && n.params.threadName != null)
      options.onTitle?.(n.params.threadName);
    if (
      n.method === "thread/goal/updated" ||
      n.method === "thread/goal/cleared"
    ) {
      const goal =
        n.method === "thread/goal/cleared" ? null : codexGoal(n.params.goal);
      if (goal !== undefined) this.goals.seen(goal);
    }
    if (n.method === "item/started" || n.method === "item/completed")
      this.item(n.method, n.params.item);
    if (n.method === "turn/plan/updated") {
      const row = this.plans.update(this.threadId, n.params);
      if (row) options.onActivity?.(row);
    }
    if (n.method === "item/plan/delta") {
      this.plan += n.params.delta;
      if (this.plan.length > ANSWER_LIMIT) {
        this.finish(new Error("Plan size limit reached."));
        return;
      }
      options.onPlan?.(this.plan);
    }
    try {
      if (
        n.method === "item/started" ||
        n.method === "item/completed" ||
        n.method === "item/agentMessage/delta"
      )
        this.stream.update(n.method, n.params);
      if (
        n.method === "item/completed" &&
        n.params.item.type === "agentMessage" &&
        n.params.item.delivery === "async" &&
        n.params.item.id &&
        n.params.item.questions?.length
      )
        options.onQuestions?.(
          n.params.item.id,
          n.params.item.questions.map((q, index) => ({
            id: String(index),
            question: q.title,
            options: q.options?.map((label) => ({ label })),
          })),
        );
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (n.method === "turn/started") {
      const { id } = n.params.turn;
      if (options.job.kind === "review") {
        if (id !== this.turnId) this.reviewTurnId = id;
      } else {
        // Codex went on with the goal: the turn before is history in this answer.
        if (this.turnId && id !== this.turnId) {
          this.past(this.turnId);
          this.stream.nextTurn();
          options.session?.onPoint?.(id);
        }
        this.turnId = id;
      }
      this.goals.started();
      this.cacheClock.turnStarted();
    }
    if (n.method === "turn/completed") {
      // Word about an earlier turn, late: this one goes on. Before this one's
      // id is known, only a turn known to be over is told apart.
      const { id } = n.params.turn;
      if (
        id &&
        id !== this.turnId &&
        (this.turnId || this.connection.pastTurns.has(id))
      )
        return;
      const done = n.params.turn.status === "completed";
      if (this.holds && done && this.goals.completed()) return;
      if (done) {
        this.watcher?.ended(this.plan || this.review || this.stream.answer);
        this.finish();
      } else
        this.failed(
          codexFailure(
            n.params.turn.error,
            "Codex did not finish this answer.",
            this.spentUntil,
          ),
        );
    }
    if (n.method === "error" && !n.params.willRetry)
      this.failed(
        codexFailure(
          n.params.error,
          "Codex failed to answer.",
          this.spentUntil,
        ),
      );
  };

  /** Codex asks the user something; a file change brings the diff Codex sent with its item. */
  request = (
    method: string,
    params: Record<string, unknown> & { itemId?: unknown },
  ) =>
    codexRequest(
      method,
      {
        ...params,
        ...(method === "item/fileChange/requestApproval" &&
        typeof params.itemId === "string" &&
        this.fileChanges.has(params.itemId)
          ? { changes: this.fileChanges.get(params.itemId) }
          : {}),
      },
      this.options.onRequest!,
      (activity) => {
        if (!this.settled) this.options.onActivity?.(activity);
      },
    );

  /** Stopped by the user: interrupt the running turn, pausing its goal first. */
  abort = () => {
    if (this.settled) return;
    void this.subagents.stop();
    // Between a goal's turns there is nothing to interrupt.
    if (this.goals.waiting) {
      this.goals.dispose();
      void this.pauseGoal().finally(() => this.finish(cancelled()));
      return;
    }
    if (this.goals.active)
      void this.pauseGoal().finally(() => this.interrupt());
    else this.interrupt();
  };

  /** Sends a steering message into the running turn, or turns it away once it's over. */
  steer(
    text: string,
    id: string | undefined,
    images: AgentOptions["images"],
    /** A one-off's sandbox lists the images it may read when it starts. */
    takesImages: boolean,
  ) {
    return guardSteer(
      () => !this.settled && !this.options.signal.aborted,
      () => {
        if (images?.length && !takesImages)
          throw new Error("This turn can't take new images.");
      },
      async () => {
        await this.wire!.request("turn/steer", {
          threadId: this.threadId,
          expectedTurnId: this.reviewTurnId || this.turnId,
          input: [
            ...(text
              ? [{ type: "text", text: codexMentions(text), text_elements: [] }]
              : []),
            ...(images ?? []).map((image) => ({
              type: "localImage",
              path: image.path,
            })),
          ],
          // Codex echoes it on the user message item once it reads the steer.
          ...(id ? { clientUserMessageId: id } : {}),
        });
      },
    );
  }

  /** Like Codex's TUI on Stop: no further turn starts for the goal. */
  async pauseGoal() {
    const { wire, threadId } = this;
    if (!this.goals.active || !wire || !threadId) return;
    await withTimeout(
      codexGoals(wire, threadId).set({ status: "paused" }),
      2000,
      "Codex didn't pause the goal in time.",
    )
      .then((goal) => this.goals.seen(goal))
      .catch((e) => console.warn("Could not pause the Codex goal:", e));
  }

  dispose() {
    this.goals.dispose();
    clearTimeout(this.interruptTimeout);
  }

  private tokensUsed(tokenUsage: unknown) {
    const { options } = this;
    // `last` is the one request that just finished.
    const last = (
      tokenUsage as {
        last?: { outputTokens?: number; reasoningOutputTokens?: number };
      } | null
    )?.last;
    const tokens = last && codexTokens(last);
    // A compaction's report carries no request, and its summary replaces
    // the conversation the cache held.
    const usage = codexContextUsage(
      tokenUsage,
      tokens && requested(tokens) ? this.cacheClock.reported() : undefined,
    );
    if (usage) options.onContext?.(usage);
    this.watcher?.requested(tokenUsage);
    const model = options.choice.model || this.connection.started?.model;
    const streamed = last && this.speed.finish(last);
    if (tokens && model && requested(tokens))
      options.onUsage?.({
        model,
        tokens,
        fast: options.choice.fast,
        ...(streamed && { streamed }),
      });
  }

  private item(
    method: "item/started" | "item/completed",
    item: Extract<
      CodexNotification,
      { method: "item/started" }
    >["params"]["item"],
  ) {
    const { options } = this;
    // A steer Codex has read: what it says next answers that message.
    if (
      method === "item/started" &&
      item.type === "userMessage" &&
      item.clientId
    ) {
      this.stream.restart();
      options.onSteered?.(item.clientId);
    }
    if (item.type === "fileChange" && item.id && item.changes)
      this.edited(item.id, item.changes);
    this.subagents.spawned(item);
    if (
      method === "item/completed" &&
      item.type === "exitedReviewMode" &&
      item.review != null
    ) {
      this.review = item.review.slice(0, ANSWER_LIMIT);
      options.onText(this.review);
    }
    if (
      method === "item/completed" &&
      item.type === "plan" &&
      item.text != null
    ) {
      this.plan = item.text.slice(0, ANSWER_LIMIT);
      options.onPlan?.(this.plan);
    }
    const activity = codexActivity(method, item);
    // A /compact shows as its own line in the thread, not inside a turn.
    if (
      activity &&
      !(options.job.kind === "compact" && item.type === "contextCompaction")
    )
      options.onActivity?.(activity);
    if (method === "item/completed" && item.id) this.watcher?.item(item);
  }

  private edited(id: string, changes: unknown) {
    this.fileChanges.set(id, changes);
    this.options.onEdit?.(codexEditedPaths(changes));
  }

  /** A failed run leaves its goal paused, not working where no run shows it. */
  private failed(error: Error) {
    if (this.settled) return;
    if (!this.goals.active || this.options.signal.aborted)
      return this.finish(error);
    this.goals.dispose();
    void this.pauseGoal().finally(() => this.finish(error));
  }

  private interrupt() {
    if (this.settled) return;
    const { wire, threadId } = this;
    const turnId = this.reviewTurnId || this.turnId;
    if (wire && threadId && turnId) {
      // Keep the transport alive until Codex acknowledges the interruption.
      this.interruptTimeout = setTimeout(
        () => this.finish(cancelled()),
        Number(process.env.RELAY_TEST_CODEX_INTERRUPT_MS) || 3000,
      );
      void wire
        .request("turn/interrupt", { threadId, turnId })
        .catch(() => this.finish(cancelled()));
    } else this.finish(cancelled());
  }
}
