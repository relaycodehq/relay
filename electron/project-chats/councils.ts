import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  threadWorktree,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import type { PullRef } from "../../shared/types";
import {
  reviewerRound,
  workingReview,
  type DeepReviewStart,
  type ResumeReview,
  type ReviewerTask,
} from "../../shared/deep-review";
import type { AgentProvider } from "../../shared/agents";
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
 * Deep reviews: several agents at work for one thread, each in a thread of
 * its own listed under it, then a lead in the thread itself.
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
      createReviewer: (parent, reviewer) =>
        this.createReviewer(parent, reviewer),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      // A reviewer whose cut-off turn is being picked back up is at work too.
      active: (id) =>
        this.core.active.has(id) || this.core.sessions.resumingIn(id),
      // Only agents report back: a dev server it left up never ends.
      waiting: (id) =>
        this.core.sessions
          .pending(id)
          .some(({ item }) => item.kind === "task" && item.agent),
      live: (id) => this.core.sessions.live(id),
      finished: async (id) => {
        await this.core.active.finished(id);
        // A turn's end takes a review step; going on before it lands races it.
        await Promise.allSettled(this.stepping());
      },
      windDown: async (id) => {
        await this.core.active.finished(id);
        // A reviewer's end goes on in its thread: its queue, then another step.
        await this.core.control(id, async () => {});
        await Promise.allSettled(this.stepping());
      },
      stop: (id) => this.stopReviewer(id),
      close: (id) => this.core.sessions.close(id),
      touch: (chat, messageId) => this.touch(chat, messageId),
      discard: (chat) => this.core.storage.remove(chat),
    });
    // Closing ends every session; reviews cut off then are stopped on the next start.
    core.sessions.onPending(() => {
      if (!core.closing()) void this.track(this.reviews.sessionsChanged());
    });
  }

  /** Deep review reviewers hold new messages back. */
  busy(chat: ProjectChat) {
    return this.reviews.reviewing(chat);
  }

  /** A message is about to go out in the thread; a review follows its branch to the folder it's checked out in. */
  fixing(chat: ProjectChat, input: ProjectChatSend) {
    return this.reviews.fixing(chat, input);
  }

  /**
   * Where a review thread, or one of its reviewers, works when the reviewed
   * code isn't in the project's checkout; undefined otherwise. A worktree
   * Relay made and has since cleaned up is made again, unless `make` is
   * false: then it's undefined too.
   */
  async root(chat: ProjectChat, make = true) {
    const state = chat.reviewer
      ? reviewerRound(
          (await this.core.storage.load(chat.reviewer.parent).catch(() => null))
            ?.reviews,
          chat.reviewer,
        )
      : chat.scope.kind === "review"
        ? workingReview(chat)
        : // Any other thread keeps working where it did.
          undefined;
    // A round that made no checkout has its reviewers work where the thread did.
    if (chat.reviewer && state?.scope.folder && !state.scope.checkout)
      return state.scope.folder;
    const checkout = state?.scope.checkout;
    if (!checkout || !state.scope.head) return;
    if (!make)
      return (await stat(checkout.path).catch(() => null))
        ? checkout.path
        : undefined;
    return ensureReviewCheckout(
      await this.core.projects.root(chat.projectId),
      checkout,
      state.scope.head,
    );
  }

  /**
   * Removes the worktrees Relay made for reviews whose thread is gone,
   * archived or settled, unless they hold work Git couldn't give back or
   * another thread works in them.
   */
  sweepCheckouts(done: (chatId: string) => boolean) {
    return sweepReviewCheckouts(
      this.worktrees,
      done,
      this.core.store.get().chats,
    );
  }

  /**
   * Relay restarted with the turns of the threads in `kept` still going: a
   * review whose reviewers are among them waits on them again.
   */
  async reattached(kept: string[]) {
    const reviews = new Set<string>();
    for (const id of kept) {
      const chat = await this.core.storage.load(id).catch(() => undefined);
      if (chat?.reviewer) reviews.add(chat.reviewer.parent);
    }
    const ids = new Set(kept);
    for (const review of reviews)
      await this.track(this.reviews.reattached(review, ids));
  }

  /** A reviewer's turn a restart cut off couldn't be picked back up. */
  reviewerLost(chat: ProjectChat) {
    if (!chat.reviewer) return;
    return this.track(this.reviews.reviewerLost(chat.reviewer.parent));
  }

  /** A turn in the thread ended; a review at work takes its next step, settling once it has. */
  step(id: string, turn: { request?: string; answer?: string }) {
    return this.track(this.reviews.finished(id, turn));
  }

  private track(work: Promise<void>) {
    const step = work.catch((e) =>
      console.warn("Deep review could not continue:", e),
    );
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

  /** A turn is about to start in a thread; a reviewer's may take its stopped review back up. */
  memberStarting(chat: ProjectChat) {
    return this.reviews
      .memberStarting(chat)
      .catch((e) => console.warn("Could not reopen the deep review:", e));
  }

  startReview(
    id: string,
    config: DeepReviewStart,
    options: {
      folder?: string;
      pull?: (ref: PullRef) => Promise<PullInfo>;
      duringTurn?: boolean;
    },
  ) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      const chat = await this.core.storage.load(id);
      // As a message would: a thread in a worktree of its own isn't held up.
      if (!chat.worktree && !threadWorktree(chat))
        this.core.projects.assertCheckoutAvailable(chat.projectId);
      await this.reviews.start(id, config, options);
    });
  }

  resumeReview(id: string, only?: ResumeReview) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      await this.reviews.resume(id, only);
    });
  }

  /** Saves the chat and tells the renderer this message, and what hangs off it, changed. */
  private async touch(chat: ProjectChat, messageId: string) {
    const message = chat.messages.find((m) => m.id === messageId);
    if (message) message.version++;
    await this.core.storage.save(chat);
    if (message)
      this.core.emit({ chatId: chat.id, message: structuredClone(message) });
  }

  /**
   * A reviewer's own thread, listed under its review the way a thread its
   * agent started is. It works in the review's checkout, never a worktree
   * of its own, and only reads.
   */
  private async createReviewer(
    parent: ProjectChat,
    {
      task,
      title,
      by,
    }: { task: ReviewerTask; title: string; by: AgentProvider },
  ) {
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId: parent.projectId,
      scope: { kind: "review" },
      reviewer: task,
      startedBy: { chatId: parent.id, agent: by },
      title,
      // Its name says which reviewer it is; no title is generated for it.
      renamed: true,
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    };
    await this.core.storage.add(chat).catch(async (error: unknown) => {
      // It may have been saved before the failure; don't leave a stray on disk.
      await this.core.storage.remove(chat).catch(() => {});
      throw error;
    });
    return chat;
  }

  /** As the reviewer's own Stop: its turn ends and nothing queued for it goes out. */
  private stopReviewer(id: string) {
    const chat = this.core.storage.cached(id);
    if (chat?.queue?.length && !chat.queuePaused) {
      chat.queuePaused = true;
      void this.core.storage
        .save(chat)
        .catch((e) => console.warn("Could not hold a reviewer's queue:", e));
    }
    this.core.active.stop(id);
  }
}
