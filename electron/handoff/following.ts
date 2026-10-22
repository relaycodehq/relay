import { z } from "zod";
import { handoffMessageSchema } from "../../shared/handoff";
import type { ChatMessage, ChatSummary } from "../../shared/projects";
import type { RemoteEvent } from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import type { Store } from "../app/store";
import type { ProjectChats } from "../project-chats";
import type { ComputerInfos } from "./computer-infos";
import type { Computers } from "./computers";
import { liveOn, setupsOn } from "./away";
import { readMirrored, receivePastesFrom } from "./transfer";

/** What another computer tells of a thread it took over live. */
const handoffNewsSchema = z.object({
  kind: z.enum(["waiting", "finished", "failed"]),
  title: z.string().max(1000),
  body: z.string().max(4000),
  byAgent: z.literal(true).optional(),
});

/**
 * Keeps here what the other computer writes in the threads live on it, and
 * in the setups threads wait on there: caught up on when it comes online,
 * then kept up to date by its events.
 */
export class HandoffFollowing {
  /** Attachment downloads must not let a later message overtake an earlier one. */
  private mirrors = new Map<string, Promise<void>>();

  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private infos: ComputerInfos,
    /** Sends what waited for the thread's computer. */
    private flush: (chatId: string) => void,
    /** The setup the thread waits on may be done: look again. */
    private checkSetup: (chatId: string) => void,
  ) {}

  /** Asks the computer to keep these threads up to date here, and for what's missed. */
  follow(computerId: string, chatId?: string) {
    return this.each(
      computerId,
      liveOn(this.store, computerId),
      chatId,
      "Live handoffs couldn't be followed:",
      async (client, c) => {
        const { id } = c.sentTo!;
        const known = await this.chats.liveHandoff.held(c.id);
        const answer = await client.call("handoffChat", id, known);
        const messages = readMirrored(answer.messages);
        const carried = await receivePastesFrom(
          this.infos,
          computerId,
          client,
          messages.filter((m): m is ChatMessage => typeof m !== "string"),
        );
        let next = 0;
        await this.chats.liveHandoff.synced(
          c.id,
          id,
          messages.map((m) => (typeof m === "string" ? m : carried[next++]!)),
        );
        this.chats.liveHandoff.setLive(c.id, answer.live);
        this.flush(c.id);
      },
    );
  }

  /** Asks the computer to keep the setups under way there up to date here, and for what's missed. */
  followSetups(computerId: string, chatId?: string) {
    return this.each(
      computerId,
      setupsOn(this.store, computerId),
      chatId,
      "Setups on another computer couldn't be followed:",
      async (client, c) => {
        const answer = await client.call(
          "handoffChat",
          c.sentTo!.setup!,
          await this.chats.setupMirror.held(c.id),
        );
        await this.chats.setupMirror.synced(
          c.id,
          readMirrored(answer.messages),
        );
        this.chats.liveHandoff.setLive(c.id, answer.live);
        // It may have finished while this computer wasn't listening.
        this.checkSetup(c.id);
      },
    );
  }

  /** What a computer says about the threads live on it, or the setups threads wait on there. */
  event(computerId: string, event: RemoteEvent) {
    const handoffId =
      event.kind === "message"
        ? event.chatId
        : event.kind === "handoff"
          ? event.id
          : event.kind === "news"
            ? event.item?.chatId
            : undefined;
    if (!handoffId) return;
    const chat = liveOn(this.store, computerId).find(
      (c) => c.sentTo!.id === handoffId,
    );
    if (chat) return this.liveEvent(computerId, chat, handoffId, event);
    // Threads waiting on the same project there share its setup.
    for (const c of setupsOn(this.store, computerId))
      if (c.sentTo!.setup === handoffId) this.setupEvent(c, event);
  }

  private liveEvent(
    computerId: string,
    chat: ChatSummary,
    handoffId: string,
    event: RemoteEvent,
  ) {
    const message = this.stateOrMessage(chat, event, "A live handoff's");
    if (!message) return;
    const prior = this.mirrors.get(chat.id) ?? Promise.resolve();
    const copying = prior
      .then(async () => {
        // A paste that won't copy leaves the message naming it as it was; the message itself is kept.
        const [carried] = await this.computers
          .connected(computerId)
          .then((client) =>
            receivePastesFrom(this.infos, computerId, client, [message]),
          )
          .catch((e) => {
            console.warn("A live handoff's paste wasn't copied:", e);
            return [message];
          });
        await this.chats.liveHandoff.mirror(chat.id, handoffId, carried!);
      })
      .catch((e) => console.warn("A live handoff's message wasn't kept:", e))
      .finally(() => {
        if (this.mirrors.get(chat.id) === copying) this.mirrors.delete(chat.id);
      });
    this.mirrors.set(chat.id, copying);
  }

  /** What the agent setting a thread's project up there writes, and how it stands. */
  private setupEvent(chat: ChatSummary, event: RemoteEvent) {
    const message = this.stateOrMessage(chat, event, "A setup's");
    if (!message) return;
    void this.chats.setupMirror
      .mirror(chat.id, message)
      .then(() => {
        if (message.role === "assistant" && message.status !== "streaming")
          this.checkSetup(chat.id);
      })
      .catch((e) => console.warn("A setup's message wasn't kept:", e));
  }

  /**
   * Takes in whether the thread runs there and the news its answers end
   * with, as that computer decided it; returns a message it wrote, to keep.
   */
  private stateOrMessage(
    chat: ChatSummary,
    event: RemoteEvent,
    whose: string,
  ): ChatMessage | undefined {
    if (event.kind === "handoff") {
      this.chats.liveHandoff.setLive(chat.id, event.live);
      return;
    }
    if (event.kind === "news") {
      const news = handoffNewsSchema.safeParse(event.item);
      if (news.success)
        this.chats.handoffNews(chat.id, chat.projectId, news.data);
      else console.warn(`${whose} news didn't read:`, news.error);
      return;
    }
    if (event.kind !== "message") return;
    const parsed = handoffMessageSchema.safeParse(event.message);
    if (!parsed.success) {
      console.warn(`${whose} message didn't read:`, parsed.error);
      return;
    }
    return parsed.data as ChatMessage;
  }

  private async each(
    computerId: string,
    chats: ChatSummary[],
    only: string | undefined,
    failure: string,
    follow: (client: RemoteClient, chat: ChatSummary) => Promise<void>,
  ) {
    const which = chats.filter((c) => !only || c.id === only);
    if (!which.length) return;
    try {
      const client = await this.computers.connected(computerId);
      await Promise.all(which.map((c) => follow(client, c)));
    } catch (e) {
      console.warn(failure, e);
    }
  }
}
