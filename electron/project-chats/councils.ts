import { randomUUID } from "node:crypto";
import type { ProjectChat, ProjectChatSend } from "../../shared/projects";
import type {
  DeepReviewStart,
  FindingStatus,
  ReviewerTask,
} from "../../shared/deep-review";
import {
  DeepReviews,
  ensureReviewCheckout,
  sweepReviewCheckouts,
  type PullInfo,
} from "../deep-review";
import type { ChatCore } from "./core";

export interface CouncilHost {
  send(id: string, input: ProjectChatSend): Promise<void>;
  /** Starts the lead's turn in the thread; it runs on after this returns. */
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
  ): Promise<void>;
}

/**
 * Deep reviews: several agents at work for one thread, each in a hidden
 * thread of its own, then a lead in the thread itself.
 */
export class Councils {
  private reviews: DeepReviews;
  /** What a deep review does after a turn ends; closing waits for it. */
  private steps = new Set<Promise<void>>();
  constructor(
    private core: ChatCore,
    private host: CouncilHost,
    /** The folder Relay makes worktrees in. */
    private worktrees: string,
  ) {
    this.reviews = new DeepReviews({
      load: (id) => this.core.storage.load(id),
      project: (id) => this.core.projects.get(id),
      root: (projectId) => this.core.projects.root(projectId),
      worktrees,
      createReviewer: (parent, task) => this.createReviewer(parent, task),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      active: (id) => this.core.active.has(id),
      stop: (id) => this.core.active.get(id)?.abort.abort(),
      close: (id) => this.core.sessions.close(id),
      touch: (chat, messageId) => this.touch(chat, messageId),
      discard: (chat) => this.core.storage.remove(chat),
    });
  }

  /** Deep review reviewers hold new messages back. */
  busy(chat: ProjectChat) {
    return this.reviews.reviewing(chat);
  }

  /** A message is about to go out in the thread; a fix request readies the review's folder or refuses. */
  fixing(chat: ProjectChat, input: ProjectChatSend) {
    return this.reviews.fixing(chat, input);
  }

  /** A message went out in the thread. */
  sent(chat: ProjectChat, input: ProjectChatSend) {
    this.reviews.sent(chat, input);
  }

  /**
   * Where a review thread, or one of its reviewers, works when the reviewed
   * code isn't in the project's checkout; undefined otherwise. A worktree
   * Relay made and has since cleaned up is made again.
   */
  async root(chat: ProjectChat) {
    const state = chat.reviewer
      ? (await this.core.storage.load(chat.reviewer.parent).catch(() => null))
          ?.deepReview
      : chat.deepReview;
    const checkout = state?.scope.checkout;
    if (!checkout || !state.scope.head) return;
    return ensureReviewCheckout(
      await this.core.projects.root(chat.projectId),
      checkout,
      state.scope.head,
    );
  }

  /**
   * Removes the worktrees Relay made for reviews whose thread is gone,
   * archived or settled, unless they hold work Git couldn't give back.
   */
  sweepCheckouts(done: (chatId: string) => boolean) {
    return sweepReviewCheckouts(this.worktrees, done);
  }

  /** A turn in the thread ended; a review at work takes its next step, settling once it has. */
  step(id: string, turn: { request?: string; answer?: string }) {
    const step = this.reviews
      .finished(id, turn)
      .catch((e) => console.warn("Deep review could not continue:", e));
    this.steps.add(step);
    void step.finally(() => this.steps.delete(step));
    return step;
  }

  /** Steps still running, for closing. */
  stepping() {
    return [...this.steps];
  }

  /** Stop in the thread stops its reviewers too. */
  async stop(chat: ProjectChat) {
    await this.reviews.stop(chat);
  }

  startReview(id: string, config: DeepReviewStart, pull?: PullInfo) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      this.core.projects.assertCheckoutAvailable(
        (await this.core.storage.load(id)).projectId,
      );
      await this.reviews.start(id, config, pull);
    });
  }

  resumeReview(id: string) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      await this.reviews.resume(id);
    });
  }

  setFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    return this.core.control(id, () =>
      this.reviews.setFinding(id, findingId, status),
    );
  }

  /** Saves the chat and tells the renderer this message, and what hangs off it, changed. */
  private async touch(chat: ProjectChat, messageId: string) {
    const message = chat.messages.find((m) => m.id === messageId);
    if (message) message.version++;
    await this.core.storage.save(chat);
    if (message)
      this.core.emit({ chatId: chat.id, message: structuredClone(message) });
  }

  /** A reviewer's own thread, shown only inside its review. */
  private async createReviewer(parent: ProjectChat, task: ReviewerTask) {
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId: parent.projectId,
      scope: { kind: "review" },
      reviewer: task,
      title: `Reviewer ${task.slot + 1}`,
      // Its name is fixed; no title is generated for it.
      renamed: true,
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    };
    await this.core.storage.add(chat).catch(async (error: unknown) => {
      // It may have been saved before the failure; don't leave it hidden on disk.
      await this.core.storage.remove(chat).catch(() => {});
      throw error;
    });
    return chat;
  }
}
