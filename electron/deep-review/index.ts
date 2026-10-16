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
  reviewerTitle,
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
  queued,
  startSlots,
  unfinishedSlots,
} from "./council";
import { leadPrompt, requestText, reviewerTask } from "./prompts";
import { resolveScope, type PullInfo } from "./scope";
import {
  checkOutForFixes,
  discardReviewCheckout,
  openReviewCheckout,
} from "./checkout";
export {
  ensureReviewCheckout,
  reviewCheckoutsIn,
  sweepReviewCheckouts,
} from "./checkout";

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
  constructor(private host: DeepReviewHost) {}

  async start(chatId: string, config: DeepReviewStart, pull?: PullInfo) {
    const chat = await this.host.load(chatId);
    if (chat.scope.kind !== "review")
      throw new Error("Start a deep review from a new deep review thread.");
    if (chat.deepReview || chat.messages.length)
      throw new Error("This thread already holds a review.");
    const project = this.host.project(chat.projectId);
    if (
      config.target.kind === "pr" &&
      (project.repository?.owner !== config.target.ref.owner ||
        project.repository?.name !== config.target.ref.name)
    )
      throw new Error("This pull request belongs to a different project.");
    const root = await this.host.root(chat.projectId);
    const scope = await resolveScope(root, config.target, project, pull);
    // Reviewers read the code around the changes, so they work where it's
    // checked out. Without that they still read it from Git.
    const checkout = await openReviewCheckout(
      root,
      scope,
      this.host.worktrees,
      chat.id,
    ).catch((e: unknown) => {
      console.warn("Could not check out the reviewed code for review:", e);
      return undefined;
    });
    if (checkout) scope.checkout = checkout;
    const discardCheckout = () =>
      checkout ? discardReviewCheckout(checkout) : undefined;
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
          task: { parent: chat.id, slot, ...(codex ? { codex } : {}) },
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
    chat.title = reviewThreadTitle(scope);
    chat.updated = Date.now();
    chat.branch = scope.branch ?? chat.branch;
    chat.deepReview = state;
    try {
      await this.host.touch(chat, request.id);
    } catch (error) {
      // The loaded thread is the cached one, so put it back as it was.
      chat.messages.splice(chat.messages.indexOf(request), 1);
      Object.assign(chat, before);
      delete chat.deepReview;
      await Promise.allSettled([
        ...created.map((c) => this.host.discard(c)),
        discardCheckout(),
      ]);
      throw error;
    }
    await this.sendReviewers(chat, [...state.reviewers.keys()]);
  }

  /**
   * Runs the reviewers that didn't finish, or the lead when they all did.
   * `slot` runs that reviewer's task again on its own while the others go
   * on, the lead waiting for it; `lead` hands a stopped review to the lead
   * with the reports that are in.
   */
  async resume(chatId: string, only?: ResumeReview) {
    const stopped = (await this.host.load(chatId)).deepReview;
    if (!stopped) throw new Error("This thread has no review to continue.");
    // A stopped answer reads as stopped while its agent winds down; going on
    // waits for that rather than refusing.
    await Promise.all([
      this.host.finished(chatId),
      ...stopped.reviewers.map((r) => this.host.windDown(r.chatId)),
    ]);
    const chat = await this.host.load(chatId);
    const state = chat.deepReview;
    if (!state) throw new Error("This thread has no review to continue.");
    if (only && "slot" in only) return this.rerun(chat, state, only.slot);
    if (only?.lead) return this.leadNow(chat, state);
    if (
      this.host.active(chat.id) ||
      state.reviewers.some((r) => this.host.active(r.chatId))
    )
      throw new Error("This review is already running.");
    if (chat.findings?.reports.length)
      throw new Error("The review is done. Ask the lead to continue instead.");
    const unfinished = await unfinishedSlots(this.host, state.reviewers);
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    if (unfinished.length) await this.sendReviewers(chat, unfinished);
    else await this.reviewerDone(chat.id);
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
    await this.reviewerDone(chat.id, true);
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
    await this.sendReviewers(chat, [slot]);
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
    const state = chat?.deepReview;
    if (
      !chat ||
      !state ||
      state.reviewers[task.slot]?.chatId !== member.id ||
      (state.status !== "stopped" && state.status !== "failed") ||
      leadStarted(state) ||
      chat.findings?.reports.length
    )
      return;
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
  }

  /** Stop in the review thread stops the reviewers too. */
  async stop(chat: ProjectChat) {
    const state = chat.deepReview;
    if (state?.status !== "reviewing") return;
    state.status = "stopped";
    for (const r of state.reviewers) this.host.stop(r.chatId);
    await this.host.touch(chat, state.request);
  }

  /** Messages wait for the lead while the reviewers work. */
  reviewing(chat: ProjectChat) {
    return chat.deepReview?.status === "reviewing";
  }

  /**
   * Before a fix request in a review whose worktree Relay made, checks the
   * reviewed branch out there; throws when it can't, so nothing is sent.
   */
  async fixing(chat: ProjectChat, input: ProjectChatSend) {
    const checkout = chat.deepReview?.scope.checkout;
    if (input.fixes?.length && checkout) await checkOutForFixes(checkout);
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
      // Its agent would idle until Relay quits; a message waiting for it, or
      // one sent since, picks its session back up.
      if (!this.host.active(chat.id) && !queued(chat)) this.host.close(chat.id);
      return this.reviewerDone(chat.reviewer.parent);
    }
    const state = chat.deepReview;
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

  private async sendReviewers(chat: ProjectChat, slots: number[]) {
    const state = chat.deepReview!;
    try {
      await this.startReviewers(chat, slots);
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

  private async startReviewers(chat: ProjectChat, slots: number[]) {
    const state = chat.deepReview!;
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
      () => this.reviewerDone(chat.id),
    );
  }

  /**
   * A reviewer's turn ended, or never started: once none is at work or has
   * a message waiting, the lead takes every reviewer's latest answer.
   * `withReportsIn` goes on past a stopped reviewer, as long as one reported.
   */
  private async reviewerDone(parentId: string, withReportsIn = false) {
    const chat = await this.host.load(parentId).catch(() => undefined);
    const state = chat?.deepReview;
    if (!chat || !state || state.status !== "reviewing") return;
    const working = () =>
      state.reviewers.some((r) => this.host.active(r.chatId));
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
        leadPrompt(state, reports),
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
