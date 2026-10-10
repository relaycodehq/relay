// Runs a deep review: each reviewer in a hidden thread of its own, then the
// lead in the review thread itself, where it fixes findings with the user.
import { randomUUID } from "node:crypto";
import { reviewDiff } from "./review-diff";
import type {
  ChatMessage,
  Project,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import {
  extractFindings,
  reviewReports,
  reviewThreadTitle,
  type DeepReviewStart,
  type DeepReviewState,
  type FindingStatus,
  type ReviewerTask,
} from "../../shared/deep-review";
import {
  councilTurn,
  halted,
  lastAnswer,
  startSlots,
  unfinishedSlots,
} from "./council";
import { settleFixes, startFixing } from "./fixes";
import { addReport } from "./reports";
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
  /** A hidden thread for one reviewer. */
  createReviewer(parent: ProjectChat, task: ReviewerTask): Promise<ProjectChat>;
  send(chatId: string, input: ProjectChatSend): Promise<void>;
  /** Starts the lead's turn in the review thread; it runs on after this returns. */
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
  ): Promise<void>;
  active(chatId: string): boolean;
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
          parent: chat.id,
          slot,
          ...(codex ? { codex } : {}),
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

  /** Runs the reviewers that didn't finish, or the lead when they all did. */
  async resume(chatId: string) {
    const chat = await this.host.load(chatId);
    const state = chat.deepReview;
    if (!state) throw new Error("This thread has no review to continue.");
    if (
      this.host.active(chat.id) ||
      state.reviewers.some((r) => this.host.active(r.chatId))
    )
      throw new Error("This review is already running.");
    if (state.report)
      throw new Error("The review is done. Ask the lead to continue instead.");
    const unfinished = await unfinishedSlots(this.host, state.reviewers);
    state.status = "reviewing";
    await this.host.touch(chat, state.request);
    if (unfinished.length) await this.sendReviewers(chat, unfinished);
    else await this.reviewerDone(chat.id);
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

  /** A fix request marks its findings as being fixed; called before it's saved. */
  sent(chat: ProjectChat, input: ProjectChatSend) {
    startFixing(chat.deepReview, input);
  }

  async setFinding(
    chatId: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    const chat = await this.host.load(chatId);
    const report = reviewReports(chat.deepReview).find((r) =>
      r.findings.some((f) => f.id === findingId),
    );
    if (!report?.findings.some((f) => f.id === findingId))
      throw new Error("That finding is no longer in this review.");
    const statuses = (chat.deepReview!.statuses ??= {});
    if (statuses[findingId] === "fixing")
      throw new Error("The lead is fixing this one right now.");
    statuses[findingId] = status;
    await this.host.touch(chat, report.messageId);
  }

  /**
   * After any turn in a review or reviewer thread: a reviewer finishing may
   * hand over to the lead, and a lead's answer may carry the findings.
   */
  async finished(chatId: string, turn: { request?: string; answer?: string }) {
    const chat = await this.host.load(chatId).catch(() => undefined);
    if (!chat) return;
    if (chat.reviewer) {
      // A reviewer answers once; left running, its agent idles until Relay quits.
      this.host.close(chat.id);
      return this.reviewerDone(chat.reviewer.parent);
    }
    const state = chat.deepReview;
    if (!state) return;
    const answer = turn.answer
      ? chat.messages.find((m) => m.id === turn.answer)
      : undefined;
    const fix = settleFixes(state, turn.request, answer?.status === "complete");
    let changed = fix ? state.report?.messageId : undefined;
    // Every completed follow-up can publish a fresh batch under its answer.
    if (
      answer?.role === "assistant" &&
      !answer.parentId &&
      answer.status === "complete" &&
      (state.report || state.status === "leading" || state.status === "done")
    ) {
      const { body, report } = extractFindings(answer.body);
      if (
        report &&
        !reviewReports(state).some((r) => r.messageId === answer.id)
      ) {
        const root = await this.host.root(chat.projectId);
        answer.body = addReport(state, report, answer.id, body, root);
        answer.version++;
        changed = answer.id;
      }
    }
    // Only the lead's initial turn settles the review lifecycle.
    if (answer?.role === "assistant" && state.status === "leading") {
      if (answer.status === "complete") {
        state.status = "done";
      } else
        state.status = answer.status === "cancelled" ? "stopped" : "failed";
      changed = answer.id;
    }
    if (changed) await this.host.touch(chat, changed);
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
    let diff: Promise<string> | undefined;
    await startSlots(
      slots,
      async (slot) => {
        const reviewer = state.reviewers[slot]!;
        const { body } = reviewerTask(
          reviewer,
          state.scope,
          state.focus,
          reviewer.provider === "cursor"
            ? await (diff ??= this.host
                .root(chat.projectId)
                .then((root) => reviewDiff(root, state.scope)))
            : undefined,
        );
        await this.host.send(reviewer.chatId, {
          id: randomUUID(),
          body,
          to: reviewer.provider,
          provider: reviewer.provider,
          choice: reviewer.choice,
          ...councilTurn,
        });
      },
      () => this.reviewerDone(chat.id),
    );
  }

  private async reviewerDone(parentId: string) {
    const chat = await this.host.load(parentId).catch(() => undefined);
    const state = chat?.deepReview;
    if (!chat || !state || state.status !== "reviewing") return;
    if (state.reviewers.some((r) => this.host.active(r.chatId))) return;
    // Claimed before anything is awaited, so reviewers finishing together start one lead.
    state.status = "leading";
    const reports = await Promise.all(
      state.reviewers.map(async (reviewer, i) => ({
        number: i + 1,
        reviewer,
        answer: await lastAnswer(this.host, reviewer.chatId),
      })),
    );
    const halt = halted(reports.map((r) => r.answer));
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
