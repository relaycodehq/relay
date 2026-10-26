// Runs a deep review: each reviewer in a thread of its own, listed under the
// review like a thread its agent started, where the user can follow, steer,
// stop or continue it; then the lead in the review thread itself, where it
// fixes findings with the user.
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import {
  hasNextPass,
  latestReview,
  passSlots,
  passStarted,
  reviewerRound,
  roundOf,
  reviewRunning,
  reviewThreadTitle,
  type DeepReviewStart,
  type DeepReviewState,
  type ResumeReview,
} from "../../shared/deep-review";
import { hasCouncilReport, memberAnswer } from "../../shared/council";
import { lastAnswer, queued, unfinishedSlots } from "./council";
import { haltedReview, reviewReports, startLead } from "./lead";
import { requestText } from "./prompts";
import { resolveScope, reviewPasses, type PullInfo } from "./scope";
import type { PullRef } from "../../shared/types";
import { placeRound } from "./checkout";
import { createReviewers, sendReviewers } from "./reviewers";
import { followFixes } from "./fixes";
import type { DeepReviewHost } from "./host";
export {
  ensureReviewCheckout,
  reviewCheckoutsIn,
  sweepReviewCheckouts,
} from "./checkout";

export { migrateReviewRounds } from "./rounds";
export { forgePulls } from "./pull-info";
export type { PullInfo };
export type { DeepReviewHost };

export class DeepReviews {
  /** Reviewers whose turn ended with their subagents still at work. */
  private awaiting = new Set<string>();
  /** Rounds whose next pass is starting, by request: its reviewers aren't at work yet. */
  private advancing = new Set<string>();
  constructor(private host: DeepReviewHost) {}

  /**
   * Starts a round in `folder`, where the thread works now: the project's
   * checkout, its own worktree, or the folder an earlier round of a deep
   * review moved it to; asked for once the round may start, as finding it
   * can make the folder again. A deep review's own thread checks out the
   * reviewed code when that folder doesn't have it. `pull` asks the forge
   * about a pull request. `duringTurn` is a round its agent asked for
   * mid-answer: the lead's turn waits for that answer to end, and the
   * folder it runs in isn't moved.
   */
  async start(
    chatId: string,
    config: DeepReviewStart,
    {
      folder,
      pull: pullInfo,
      duringTurn = false,
    }: {
      folder?: (chat: ProjectChat) => Promise<string>;
      pull?: (ref: PullRef) => Promise<PullInfo>;
      duringTurn?: boolean;
    } = {},
  ) {
    const chat = await this.host.load(chatId);
    const own = chat.scope.kind === "review";
    if (chat.reviewer)
      throw new Error("A reviewer can't start a review of its own.");
    if (
      reviewRunning(latestReview(chat)) ||
      (!duringTurn && this.host.active(chat.id))
    )
      throw new Error("Wait for the review to finish first.");
    const first = !chat.reviews?.length;
    const project = this.host.project(chat.projectId);
    if (
      config.target.kind === "pr" &&
      (project.repository?.owner !== config.target.ref.owner ||
        project.repository?.name !== config.target.ref.name)
    )
      throw new Error("This pull request belongs to a different project.");
    // The forge knows which branch a pull request merges into.
    const pull =
      config.target.kind === "pr"
        ? await pullInfo?.(config.target.ref)
        : undefined;
    const root = await (folder?.(chat) ?? this.host.root(chat.projectId));
    const scope = await resolveScope(root, config.target, project, pull);
    const discardCheckout = await placeRound(root, scope, chat, {
      worktrees: this.host.worktrees,
      prHead: pull?.headBranch,
      duringTurn,
    });
    const passes = await reviewPasses(root, scope, config);
    const request: ChatMessage = {
      id: randomUUID(),
      role: "user",
      body: requestText(scope, config),
      status: "complete",
      created: Date.now(),
      provider: config.lead.provider,
      version: 1,
    };
    const state: DeepReviewState = {
      request: request.id,
      scope,
      reviewers: [],
      lead: config.lead,
      runChecks: config.runChecks,
      ...(config.focus ? { focus: config.focus } : {}),
      runtimeMode: config.runtimeMode,
      status: "reviewing",
      ...(passes && { passes, pass: 0 }),
    };
    // Reviewers first: the thread only holds the review once all of them exist.
    const created = await createReviewers(this.host, chat, state, config).catch(
      async (error: unknown) => {
        await Promise.allSettled([discardCheckout()]);
        throw error;
      },
    );
    await this.holdRound(chat, request, state, { own, first }, () =>
      Promise.allSettled([
        ...created.map((c) => this.host.discard(c)),
        discardCheckout(),
      ]),
    );
    await this.ask(chat, state, passSlots(state, 0));
  }

  /**
   * Puts the round in its thread and saves it. When saving fails, the
   * thread goes back to how it was and `undo` throws away what the round made.
   */
  private async holdRound(
    chat: ProjectChat,
    request: ChatMessage,
    state: DeepReviewState,
    { own, first }: { own: boolean; first: boolean },
    undo: () => Promise<unknown>,
  ) {
    const before = {
      title: chat.title,
      updated: chat.updated,
      branch: chat.branch,
    };
    chat.messages.push(request);
    // A review's own thread is named after what its first round covers.
    if (own && first) chat.title = reviewThreadTitle(state.scope);
    chat.updated = Date.now();
    if (own) chat.branch = state.scope.branch ?? chat.branch;
    (chat.reviews ??= []).push(state);
    try {
      await this.host.touch(chat, request.id);
    } catch (error) {
      // The loaded thread is the cached one, so put it back as it was.
      chat.messages.splice(chat.messages.indexOf(request), 1);
      Object.assign(chat, before);
      chat.reviews.pop();
      if (!chat.reviews.length) delete chat.reviews;
      await undo();
      throw error;
    }
  }

  /**
   * Runs the reviewers that didn't finish, or the lead when they all did.
   * `slot` runs that reviewer's task again on its own while the others go
   * on, the lead waiting for it; `lead` hands a stopped review to the lead
   * with the reports that are in.
   */
  async resume(chatId: string, only?: ResumeReview) {
    const stopped = latestReview(await this.host.load(chatId));
    if (!stopped) throw new Error("This thread has no review to continue.");
    // A stopped answer reads as stopped while its agent winds down; going on
    // waits for that rather than refusing.
    await Promise.all([
      this.host.finished(chatId),
      ...stopped.reviewers.map((r) => this.host.windDown(r.chatId)),
    ]);
    const chat = await this.host.load(chatId);
    const state = latestReview(chat);
    if (state?.request !== stopped.request)
      throw new Error("This thread has no review to continue.");
    if (only && "slot" in only) return this.rerun(chat, state, only.slot);
    if (only?.lead) return this.leadNow(chat, state);
    if (
      this.host.active(chat.id) ||
      state.reviewers.some((r) => this.host.active(r.chatId))
    )
      throw new Error("This review is already running.");
    if (state.status === "done" || state.status === "leading")
      throw new Error("The review is done. Ask the lead to continue instead.");
    // Later passes' reviewers haven't been asked yet: they wait their turn.
    const unfinished = (
      await unfinishedSlots(this.host, state.reviewers)
    ).filter((slot) => passStarted(state, state.reviewers[slot]!));
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    if (unfinished.length) await this.ask(chat, state, unfinished);
    else await this.reviewerDone(chat.id, state.request);
  }

  private async leadNow(chat: ProjectChat, state: DeepReviewState) {
    if (state.status !== "stopped" || leadStarted(state))
      throw new Error("Only a stopped review can go to its lead early.");
    if (
      this.host.active(chat.id) ||
      state.reviewers.some((r) => this.host.active(r.chatId))
    )
      throw new Error("This review is already running.");
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    await this.reviewerDone(chat.id, state.request, true);
  }

  private async rerun(chat: ProjectChat, state: DeepReviewState, slot: number) {
    const reviewer = state.reviewers[slot];
    if (!reviewer) throw new Error("This review has no such reviewer.");
    if (!passStarted(state, reviewer))
      throw new Error("That reviewer's pass hasn't started yet.");
    if (leadStarted(state))
      throw new Error("The lead has the reports. Ask the lead instead.");
    if (this.host.active(reviewer.chatId))
      throw new Error("This reviewer is already at work.");
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    await this.ask(chat, state, [slot]);
  }

  /**
   * A turn is about to start in a reviewer's thread, sent from it like in
   * any thread. A review that stopped before its lead started waits for that
   * reviewer again, so its answer goes to the lead with the others.
   */
  async memberStarting(member: ProjectChat) {
    const task = member.reviewer;
    if (!task) return;
    const chat = await this.host.load(task.parent).catch(() => undefined);
    const state = chat && reviewerRound(chat.reviews, task);
    if (
      !chat ||
      !state ||
      state !== latestReview(chat) ||
      state.reviewers[task.slot]?.chatId !== member.id ||
      (state.status !== "stopped" && state.status !== "failed") ||
      leadStarted(state)
    )
      return;
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
  }

  /** Stop in the review thread stops the reviewers too. */
  async stop(chat: ProjectChat) {
    const state = latestReview(chat);
    if (state?.status !== "reviewing") return;
    state.status = "stopped";
    const abandoning: Promise<void>[] = [];
    for (const r of state.reviewers) {
      this.host.stop(r.chatId);
      // Between turns, only closing its session ends the subagents it waits for.
      if (!this.host.active(r.chatId) && this.host.waiting(r.chatId))
        abandoning.push(
          this.host.load(r.chatId).then((member) => this.abandon(member)),
        );
    }
    await Promise.allSettled(abandoning);
    await this.host.touch(chat, state.request);
  }

  /**
   * Ends a reviewer's subagents before they report. Its last answer only
   * handed the work to them, so it reads as stopped, and Resume runs the
   * reviewer again rather than taking that answer for its report.
   */
  private async abandon(member: ProjectChat) {
    this.host.close(member.id);
    const answer = memberAnswer(member.messages);
    if (answer?.status !== "complete") return;
    answer.status = "cancelled";
    await this.host.touch(member, answer.id);
  }

  /**
   * Background work changed somewhere. A reviewer whose session ended while
   * its subagents worked never gets the turn they'd report in: it reads as
   * stopped, so the review doesn't wait on it for good.
   */
  async sessionsChanged() {
    for (const id of [...this.awaiting]) {
      if (this.host.active(id)) this.awaiting.delete(id);
      if (!this.awaiting.has(id) || this.host.live(id)) continue;
      this.awaiting.delete(id);
      const member = await this.host.load(id).catch(() => undefined);
      if (!member?.reviewer) continue;
      await this.abandon(member);
      await this.reviewerDone(member.reviewer.parent, member.reviewer.round);
    }
  }

  /**
   * Relay restarted and the agent host kept the turns of the reviewers in
   * `kept`. The review waits on them again, unless another reviewer was cut
   * off before it reported: then it stops, and Resume runs that one.
   */
  async reattached(chatId: string, kept: ReadonlySet<string>) {
    const chat = await this.host.load(chatId).catch(() => undefined);
    const state = chat && latestReview(chat);
    if (!chat || state?.status !== "reviewing") return;
    for (const r of state.reviewers.filter((r) => passStarted(state, r)))
      if (
        !kept.has(r.chatId) &&
        !hasCouncilReport(await lastAnswer(this.host, r.chatId))
      )
        return this.reviewerLost(chat.id, state.request);
  }

  /** A reviewer's turn a restart cut off couldn't be picked back up; `round` is the one it works for. */
  async reviewerLost(chatId: string, round: string | undefined) {
    const chat = await this.host.load(chatId).catch(() => undefined);
    const state = chat && roundOf(chat.reviews, round);
    if (!chat || state?.status !== "reviewing") return;
    state.status = "stopped";
    await this.host.touch(chat, state.request);
  }

  /** Messages wait for the lead while the reviewers work. */
  reviewing(chat: ProjectChat) {
    return latestReview(chat)?.status === "reviewing";
  }

  /**
   * Before a message in a review thread, while no reviewer works: the
   * review follows the reviewed branch to the folder it's checked out in
   * now, or into a worktree of its own on it, so the lead's fixes land on
   * the branch. A fix request in a pull request's review gives it a local
   * branch first. The thread notes the move, and the lead hears of it.
   * Nothing it can't do holds up a question, which reads on where the
   * review is; only a fix that can't get onto the branch is refused, or one
   * of findings from a round that reviewed other code than the thread's.
   */
  async fixing(chat: ProjectChat, input: ProjectChatSend) {
    if (this.reviewing(chat)) return;
    await followFixes(this.host, chat, input);
  }

  /**
   * After any turn in a review or reviewer thread, or a reviewer's turn that
   * never got going: a reviewer finishing may hand over to the lead, and the
   * lead's first answer ends the review.
   */
  async finished(chatId: string, turn: { request?: string; answer?: string }) {
    const chat = await this.host.load(chatId).catch(() => undefined);
    if (!chat) return;
    if (chat.reviewer) {
      this.awaiting.delete(chat.id);
      if (this.host.waiting(chat.id)) {
        // Subagents still at work report in the turn they start, so its
        // session stays open for that, unless the review stopped meanwhile.
        const review = await this.host
          .load(chat.reviewer.parent)
          .catch(() => undefined);
        if (reviewerRound(review?.reviews, chat.reviewer)?.status === "stopped")
          await this.abandon(chat);
        else this.awaiting.add(chat.id);
      }
      // Its agent would idle until Relay quits; a message waiting for it, or
      // one sent since, picks its session back up.
      else if (!this.host.active(chat.id) && !queued(chat))
        this.host.close(chat.id);
      return this.reviewerDone(chat.reviewer.parent, chat.reviewer.round);
    }
    // A round its agent asked for mid-answer: the reviewers may have finished
    // while that answer ran, so the lead goes on now.
    const latest = latestReview(chat);
    if (latest?.status === "reviewing")
      return this.reviewerDone(chat.id, latest.request);
    // Only one round's lead can be on its first turn.
    const state = chat.reviews?.find((r) => r.status === "leading");
    if (!state) return;
    const answer = turn.answer
      ? chat.messages.find((m) => m.id === turn.answer)
      : undefined;
    // Only the lead's initial turn settles the review lifecycle.
    if (answer?.role === "assistant" && state.status === "leading") {
      if (answer.status === "complete") {
        state.status = "done";
        delete state.leadStopped;
      } else {
        state.status = answer.status === "cancelled" ? "stopped" : "failed";
        state.leadStopped = answer.id;
      }
      await this.host.touch(chat, answer.id);
    }
  }

  /** Asks `slots` for their reviews; one that can't start counts as done. */
  private ask(chat: ProjectChat, state: DeepReviewState, slots: number[]) {
    return sendReviewers(this.host, chat, state, slots, () =>
      this.reviewerDone(chat.id, state.request),
    );
  }

  /** Starts the next pass's reviewers; the lead waits for the last pass. */
  private async nextPass(chat: ProjectChat, state: DeepReviewState) {
    // Claimed before anything is awaited, so reviewers finishing together start it once.
    this.advancing.add(state.request);
    state.pass = (state.pass ?? 0) + 1;
    try {
      await this.host.touch(chat, state.request);
      await this.ask(chat, state, passSlots(state, state.pass));
    } finally {
      this.advancing.delete(state.request);
    }
  }

  /**
   * A reviewer's turn ended, or never started: once none is at work, waiting
   * for its subagents or has a message waiting, the next pass starts, or
   * after the last the lead takes every reviewer's latest answer.
   * `withReportsIn` goes on past a stopped reviewer, as long as one reported,
   * and skips the passes not started yet.
   */
  private async reviewerDone(
    parentId: string,
    round: string | undefined,
    withReportsIn = false,
  ) {
    const chat = await this.host.load(parentId).catch(() => undefined);
    const state = chat && roundOf(chat.reviews, round);
    if (!chat || !state || state.status !== "reviewing") return;
    // The answer that asked for this round still runs; its end comes back here.
    if (this.host.answering(chat.id)) return;
    const working = () =>
      state.reviewers.some(
        (r) => this.host.active(r.chatId) || this.host.waiting(r.chatId),
      );
    if (working()) return;
    const members = await Promise.all(
      state.reviewers.map((r) =>
        this.host.load(r.chatId).catch(() => undefined),
      ),
    );
    // Looked at again after the loads: another reviewer's end may have handed
    // over meanwhile, a message may have started one again, and one waiting
    // in a queue goes out once this step is done.
    if (
      state.status !== "reviewing" ||
      working() ||
      members.some(queued) ||
      this.advancing.has(state.request)
    )
      return;
    const reports = reviewReports(state, members);
    const halt = haltedReview(state, reports, withReportsIn);
    if (halt) {
      state.status = halt;
      await this.host.touch(chat, state.request);
      return;
    }
    if (!withReportsIn && hasNextPass(state)) return this.nextPass(chat, state);
    await startLead(this.host, chat, state, reports);
  }
}

/** The lead has the reports: it ran, or runs, its first turn. */
const leadStarted = (state: DeepReviewState) =>
  state.status === "leading" || state.status === "done" || !!state.leadStopped;
