import { randomUUID } from "node:crypto";
import type {
  AgentProvider,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import type {
  DeepReviewStart,
  FindingStatus,
  ReviewerTask,
} from "../../shared/deep-review";
import type { ThinkerTask } from "../../shared/ultraplan";
import { DeepReviews, type PullInfo } from "../deep-review";
import { Ultraplans } from "./ultraplan";
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
 * Deep reviews and Ultraplans: several agents at work for one thread, each
 * in a hidden thread of its own, then a lead in the thread itself.
 */
export class Councils {
  private reviews: DeepReviews;
  private ultraplans: Ultraplans;
  /** What a deep review or an Ultraplan does after a turn ends; closing waits for it. */
  private steps = new Set<Promise<void>>();
  constructor(
    private core: ChatCore,
    private host: CouncilHost,
  ) {
    this.reviews = new DeepReviews({
      load: (id) => this.core.storage.load(id),
      project: (id) => this.core.projects.get(id),
      root: (projectId) => this.core.projects.root(projectId),
      createReviewer: (parent, task) => this.createReviewer(parent, task),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      active: (id) => this.core.active.has(id),
      stop: (id) => this.core.active.get(id)?.abort.abort(),
      close: (id) => this.core.sessions.close(id),
      touch: (chat, messageId) => this.touch(chat, messageId),
      summary: (chat) => this.core.storage.updateSummary(chat),
      discard: (chat) => this.core.storage.remove(chat),
    });
    this.ultraplans = new Ultraplans({
      load: (id) => this.core.storage.load(id),
      createThinker: (parent, task) => this.createThinker(parent, task),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      active: (id) => this.core.active.has(id),
      stop: (id) => this.core.active.get(id)?.abort.abort(),
      close: (id) => this.core.sessions.close(id),
      touch: (chat, messageId) => this.touch(chat, messageId),
    });
  }

  /** Deep review reviewers and Ultraplan thinkers hold new messages back. */
  busy(chat: ProjectChat) {
    return this.reviews.reviewing(chat) || this.ultraplans.working(chat);
  }

  /** A message went out in the thread. */
  sent(chat: ProjectChat, input: ProjectChatSend) {
    this.reviews.sent(chat, input);
  }

  /** Puts a council on `input`, whose brief the lead writes in `brief`. */
  begin(
    chat: ProjectChat,
    input: ProjectChatSend,
    lead: AgentProvider,
    brief: string,
  ) {
    this.ultraplans.begin(chat, input, lead, brief);
  }

  /** A turn in the thread ended; a review or council at work takes its next step. */
  step(id: string, turn: { request?: string; answer?: string }) {
    const step = Promise.all([
      this.reviews
        .finished(id, turn)
        .catch((e) => console.warn("Deep review could not continue:", e)),
      this.ultraplans
        .finished(id, turn)
        .catch((e) => console.warn("Ultraplan could not continue:", e)),
    ]).then(() => {});
    this.steps.add(step);
    void step.finally(() => this.steps.delete(step));
  }

  /** Steps still running, for closing. */
  stepping() {
    return [...this.steps];
  }

  /** Stop in the thread stops its reviewers and thinkers too. */
  async stop(chat: ProjectChat) {
    await this.reviews.stop(chat);
    await this.ultraplans.stop(chat);
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

  resumeUltraplan(id: string, request: string) {
    return this.core.control(id, async () => {
      if (this.core.closing()) throw new Error("Relay is closing.");
      await this.ultraplans.resume(id, request);
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

  /** A thinker's own thread, shown only inside its council. */
  private async createThinker(parent: ProjectChat, task: ThinkerTask) {
    const chat: ProjectChat = {
      id: randomUUID(),
      projectId: parent.projectId,
      scope: parent.scope,
      thinker: task,
      title: `Thinker ${task.slot + 1}`,
      // Its name is fixed; no title is generated for it.
      renamed: true,
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    };
    await this.core.storage.add(chat);
    return chat;
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
