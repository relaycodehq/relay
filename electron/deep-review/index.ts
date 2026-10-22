// Runs a deep review: each reviewer in a thread of its own, listed under the
// review like a thread its agent started, where the user can follow, steer,
// stop or continue it; then the lead in the review thread itself, where it
// fixes findings with the user.
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  Project,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import type { AgentProvider } from "../../shared/agents";
import {
  latestReview,
  reviewerRound,
  reviewerTitle,
  roundOf,
  workingReview,
  reviewRunning,
  reviewThreadTitle,
  type DeepReviewStart,
  type DeepReviewState,
  type ResumeReview,
  type ReviewerTask,
} from "../../shared/deep-review";
import { hasCouncilReport, memberAnswer } from "../../shared/council";
import {
  councilTurn,
  halted,
  lastAnswer,
  queued,
  startSlots,
  unfinishedSlots,
} from "./council";
import { leadPrompt, requestText, reviewerTask } from "./prompts";
import { resolveScope, type PullInfo } from "./scope";
import type { PullRef } from "../../shared/types";
import {
  discardReviewCheckout,
  followReviewedBranch,
  openReviewCheckout,
} from "./checkout";
import { noteWorkspaceMove } from "../../shared/workspace-moves";
import { fixesFit, roundsOfFindings } from "./rounds";
export {
  ensureReviewCheckout,
  reviewCheckoutsIn,
  sweepReviewCheckouts,
} from "./checkout";

export { migrateReviewRounds } from "./rounds";
export { forgePulls } from "./pull-info";
export type { PullInfo };

export interface DeepReviewHost {
  load(id: string): Promise<ProjectChat>;
  project(id: string): Project;
  root(projectId: string): Promise<string>;
  /** The folder Relay makes worktrees in; reviews make theirs in a folder of their own there. */
  worktrees: string;
  /** A reviewer's thread, listed under the review as if `by`, its lead, had started it. */
  createReviewer(
    parent: ProjectChat,
    reviewer: { task: ReviewerTask; title: string; by: AgentProvider },
  ): Promise<ProjectChat>;
  send(chatId: string, input: ProjectChatSend): Promise<void>;
  /** Starts the lead's turn in the review thread; it runs on after this returns. */
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
  ): Promise<void>;
  active(chatId: string): boolean;
  /** Its agent has subagents at work in the background; they start another turn when they end. */
  waiting(chatId: string): boolean;
  /** Its agent's session still runs, so what it waits for can start a turn. */
  live(chatId: string): boolean;
  /** Waits for a turn that's stopped or finished to give its thread back, and the review step its end takes. */
  finished(chatId: string): Promise<void>;
  /** As `finished`, for a reviewer, and what its end does after: its queue and the review's next step. */
  windDown(chatId: string): Promise<void>;
  /** Stops a reviewer's turn and holds what's queued for it, as its own Stop does. */
  stop(chatId: string): void;
  /** Ends a thread's agent processes; it resumes their sessions if it runs again. */
  close(chatId: string): void;
  /** Saves the thread and tells the renderer this message, and so the review, changed. */
  touch(chat: ProjectChat, messageId: string): Promise<void>;
  /** Deletes a reviewer thread whose review never started. */
  discard(chat: ProjectChat): Promise<void>;
}

export class DeepReviews {
  /** Reviewers whose turn ended with their subagents still at work. */
  private awaiting = new Set<string>();
  constructor(private host: DeepReviewHost) {}

  /**
   * Starts a round in `folder`, where the thread works now: the project's
   * checkout, its own worktree, or the folder an earlier round of a deep
   * review moved it to. A deep review's own thread checks out the reviewed
   * code when that folder doesn't have it. `pull` asks the forge about a
   * pull request. `duringTurn` is a round its agent asked for mid-answer:
   * the lead's turn waits for that answer to end.
   */
  async start(
    chatId: string,
    config: DeepReviewStart,
    {
      folder,
      pull: pullInfo,
      duringTurn = false,
    }: {
      folder?: string;
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
    const root = folder ?? (await this.host.root(chat.projectId));
    const scope = await resolveScope(root, config.target, project, pull);
    // Reviewers read the code around the changes, so they work where it's
    // checked out. Without that they still read it from Git. Another
    // thread's agent stays in its own folder, so nothing is checked out.
    const checkout = own
      ? await openReviewCheckout(
          root,
          scope,
          this.host.worktrees,
          chat.id,
          pull?.headBranch,
        ).catch((e: unknown) => {
          console.warn("Could not check out the reviewed code for review:", e);
          return undefined;
        })
      : undefined;
    if (checkout) scope.checkout = checkout;
    else scope.folder = root;
    // An earlier round's folder stays when this one doesn't start.
    const kept = chat.reviews?.some(
      (r) => r.scope.checkout?.path === checkout?.path,
    );
    const discardCheckout = () =>
      checkout && !kept ? discardReviewCheckout(checkout) : undefined;
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
    };
    // Reviewers first: the thread only holds the review once all of them exist.
    const created: ProjectChat[] = [];
    try {
      for (const [slot, reviewer] of config.reviewers.entries()) {
        const { codex } = reviewerTask(reviewer, scope, state.focus);
        const child = await this.host.createReviewer(chat, {
          task: {
            parent: chat.id,
            round: request.id,
            slot,
            ...(codex ? { codex } : {}),
          },
          title: reviewerTitle(slot, reviewer),
          by: config.lead.provider,
        });
        created.push(child);
        state.reviewers.push({ ...reviewer, chatId: child.id });
      }
    } catch (error) {
      await Promise.allSettled([
        ...created.map((c) => this.host.discard(c)),
        discardCheckout(),
      ]);
      throw error;
    }
    const before = {
      title: chat.title,
      updated: chat.updated,
      branch: chat.branch,
    };
    chat.messages.push(request);
    // A review's own thread is named after what its first round covers.
    if (own && first) chat.title = reviewThreadTitle(scope);
    chat.updated = Date.now();
    if (own) chat.branch = scope.branch ?? chat.branch;
    (chat.reviews ??= []).push(state);
    try {
      await this.host.touch(chat, request.id);
    } catch (error) {
      // The loaded thread is the cached one, so put it back as it was.
      chat.messages.splice(chat.messages.indexOf(request), 1);
      Object.assign(chat, before);
      chat.reviews.pop();
      if (!chat.reviews.length) delete chat.reviews;
      await Promise.allSettled([
        ...created.map((c) => this.host.discard(c)),
        discardCheckout(),
      ]);
      throw error;
    }
    await this.sendReviewers(chat, state, [...state.reviewers.keys()]);
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
    const unfinished = await unfinishedSlots(this.host, state.reviewers);
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    if (unfinished.length) await this.sendReviewers(chat, state, unfinished);
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
    if (leadStarted(state))
      throw new Error("The lead has the reports. Ask the lead instead.");
    if (this.host.active(reviewer.chatId))
      throw new Error("This reviewer is already at work.");
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    await this.sendReviewers(chat, state, [slot]);
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
    for (const r of state.reviewers)
      if (
        !kept.has(r.chatId) &&
        !hasCouncilReport(await lastAnswer(this.host, r.chatId))
      )
        return this.reviewerLost(chat.id);
  }

  /** A reviewer's turn a restart cut off couldn't be picked back up. */
  async reviewerLost(chatId: string) {
    const chat = await this.host.load(chatId).catch(() => undefined);
    const state = chat && latestReview(chat);
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
    const state = workingReview(chat);
    const checkout = state?.scope.checkout;
    if (!state?.scope.head || !checkout || this.reviewing(chat)) return;
    const fixing = !!input.fixes?.length;
    // A later round moved the thread on to other code; fixed there, these
    // findings would land on the wrong branch.
    const elsewhere =
      fixing &&
      roundsOfFindings(chat, input.fixes!).find((r) => !fixesFit(r, state));
    if (elsewhere)
      throw new Error(
        `Those findings are from the review of ${elsewhere.scope.label}, and this thread works on ${state.scope.label} now. Review ${elsewhere.scope.label} again to fix them there.`,
      );
    const next = await followReviewedBranch(
      await this.host.root(chat.projectId),
      checkout,
      {
        head: state.scope.head,
        dir: this.host.worktrees,
        chatId: chat.id,
        fixing,
      },
    ).catch((e: unknown) => {
      console.warn("Could not follow the reviewed branch:", e);
      if (!fixing) return checkout;
      const branch = checkout.branch ?? checkout.pr?.head;
      throw new Error(
        `Relay couldn't check out ${branch ?? "the reviewed branch"} for the fix. Check it out in a folder of your own and ask again; the review follows it there.`,
      );
    });
    if (next === checkout) return;
    state.scope.checkout = next;
    if (next.path !== checkout.path) {
      noteWorkspaceMove(chat, {
        how: "switched",
        to: next.path,
        ...(next.branch ? { branch: next.branch } : {}),
      });
      // The lead's session hears it too: its first turn wasn't one that
      // notes what it heard. A session not told of an earlier move yet
      // still works where that one started.
      const pending = chat.movedIn;
      chat.movedIn = {
        from: pending?.from ?? checkout.path,
        to: next.path,
        owed: [
          ...new Set([
            ...(pending?.owed ?? []),
            ...Object.keys(chat.scopeHeard ?? {}),
            `${state.lead.provider}:main`,
            ...(input.provider ? [`${input.provider}:main`] : []),
          ]),
        ],
        selected: true,
      };
      // Its session started in the old folder.
      this.host.close(chat.id);
    }
    await this.host.touch(chat, state.request);
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

  private async sendReviewers(
    chat: ProjectChat,
    state: DeepReviewState,
    slots: number[],
  ) {
    try {
      await this.startReviewers(chat, state, slots);
    } catch (error) {
      // Nothing is running that would ever hand over to the lead, so leave
      // the review where Resume picks it up.
      if (
        state.status === "reviewing" &&
        !state.reviewers.some((r) => this.host.active(r.chatId))
      ) {
        state.status = "failed";
        await this.host
          .touch(chat, state.request)
          .catch((e) => console.warn("Could not save the failed review:", e));
      }
      throw error;
    }
  }

  private async startReviewers(
    chat: ProjectChat,
    state: DeepReviewState,
    slots: number[],
  ) {
    await startSlots(
      slots,
      async (slot) => {
        const reviewer = state.reviewers[slot]!;
        const { body } = reviewerTask(reviewer, state.scope, state.focus);
        await this.host.send(reviewer.chatId, {
          id: randomUUID(),
          body,
          to: reviewer.provider,
          provider: reviewer.provider,
          choice: reviewer.choice,
          ...councilTurn,
          // Signed by the review, whose name opens it from the reviewer's thread.
          fromThread: { id: chat.id, name: "Deep review" },
        });
      },
      () => this.reviewerDone(chat.id, state.request),
    );
  }

  /**
   * A reviewer's turn ended, or never started: once none is at work, waiting
   * for its subagents or has a message waiting, the lead takes every
   * reviewer's latest answer.
   * `withReportsIn` goes on past a stopped reviewer, as long as one reported.
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
    if (this.host.active(chat.id)) return;
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
    if (state.status !== "reviewing" || working() || members.some(queued))
      return;
    // Claimed before anything else is awaited, so reviewers finishing together start one lead.
    state.status = "leading";
    const reports = state.reviewers.map((reviewer, i) => ({
      number: i + 1,
      reviewer,
      answer: members[i] && memberAnswer(members[i].messages),
    }));
    const answers = reports.map((r) => r.answer);
    const halt = withReportsIn
      ? answers.some(hasCouncilReport)
        ? undefined
        : "failed"
      : halted(answers);
    if (halt) {
      state.status = halt;
      await this.host.touch(chat, state.request);
      return;
    }
    try {
      await this.host.lead(
        chat,
        {
          id: randomUUID(),
          body: `@${state.lead.provider}`,
          to: state.lead.provider,
          provider: state.lead.provider,
          choice: state.lead.choice,
          runtimeMode: state.runtimeMode,
          interactionMode: "default",
        },
        leadPrompt(state, reports, chat),
      );
    } catch (e) {
      // The lead never started; Resume tries again.
      state.status = "stopped";
      throw e;
    } finally {
      await this.host.touch(chat, state.request);
    }
  }
}

/** The lead has the reports: it ran, or runs, its first turn. */
const leadStarted = (state: DeepReviewState) =>
  state.status === "leading" || state.status === "done" || !!state.leadStopped;
