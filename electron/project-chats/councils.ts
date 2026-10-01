import { randomUUID } from "node:crypto";
import type { ProjectChatEvent } from "../../shared/events";
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
import type { Projects } from "../projects";
import { Ultraplans } from "../ultraplan";
import type { ActiveTurns } from "./active";
import type { ThreadControl } from "./control";
import type { ProviderSessions } from "./sessions";
import type { ChatStorage } from "./storage";

export interface CouncilHost {
  send(id: string, input: ProjectChatSend): Promise<void>;
  /** Starts the lead's turn in the thread; it runs on after this returns. */
  lead(
    chat: ProjectChat,
    input: ProjectChatSend,
    prompt: string,
  ): Promise<void>;
  closing(): boolean;
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
    private storage: ChatStorage,
    private projects: Projects,
    private active: ActiveTurns,
    sessions: ProviderSessions,
    private control: ThreadControl,
    private emit: (event: ProjectChatEvent) => void,
    private host: CouncilHost,
  ) {
    this.reviews = new DeepReviews({
      load: (id) => this.storage.load(id),
      project: (id) => this.projects.get(id),
      root: (projectId) => this.projects.root(projectId),
      createReviewer: (parent, task) => this.createReviewer(parent, task),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      active: (id) => this.active.has(id),
      stop: (id) => this.active.get(id)?.abort.abort(),
      close: (id) => sessions.close(id),
      touch: (chat, messageId) => this.touch(chat, messageId),
      summary: (chat) => this.storage.updateSummary(chat),
    });
    this.ultraplans = new Ultraplans({
      load: (id) => this.storage.load(id),
      createThinker: (parent, task) => this.createThinker(parent, task),
      send: (id, input) => this.host.send(id, input),
      lead: (chat, input, prompt) => this.host.lead(chat, input, prompt),
      active: (id) => this.active.has(id),
      stop: (id) => this.active.get(id)?.abort.abort(),
      close: (id) => sessions.close(id),
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
    return this.control(id, async () => {
      if (this.host.closing()) throw new Error("Relay is closing.");
      this.projects.assertCheckoutAvailable(
        (await this.storage.load(id)).projectId,
      );
      await this.reviews.start(id, config, pull);
    });
  }

  resumeReview(id: string) {
    return this.control(id, async () => {
      if (this.host.closing()) throw new Error("Relay is closing.");
      await this.reviews.resume(id);
    });
  }

  setFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ) {
    return this.control(id, () =>
      this.reviews.setFinding(id, findingId, status),
    );
  }

  resumeUltraplan(id: string, request: string) {
    return this.control(id, async () => {
      if (this.host.closing()) throw new Error("Relay is closing.");
      await this.ultraplans.resume(id, request);
    });
  }

  /** Saves the chat and tells the renderer this message, and what hangs off it, changed. */
  private async touch(chat: ProjectChat, messageId: string) {
    const message = chat.messages.find((m) => m.id === messageId);
    if (message) message.version++;
    await this.storage.save(chat);
    if (message)
      this.emit({ chatId: chat.id, message: structuredClone(message) });
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
    await this.storage.add(chat);
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
    await this.storage.add(chat);
    return chat;
  }
}
