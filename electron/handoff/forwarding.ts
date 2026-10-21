import {
  handoffChatMethods,
  handoffFolderMethods,
  handoffHereOnlyMethods,
  handoffWorktreeMethods,
  inSetup,
  liveAway,
  type HandoffChatMethod,
  type HandoffHereOnlyMethod,
  type HandoffMethod,
  type HeldSend,
} from "../../shared/handoff";
import {
  projectChatSendSchema,
  type ChatSummary,
  type ProjectChatSend,
} from "../../shared/projects";
import { errorMessage } from "../../shared/error-message";
import { parseWorkspaceId } from "../../shared/workspaces";
import type { Store } from "../app/store";
import type { ProjectChats } from "../project-chats";
import type { ComputerInfos } from "./computer-infos";
import type { Computers } from "./computers";
import { listed, named, stays, summaryOf } from "./away";
import type { HandoffNotices } from "./notices";
import type { RemoteStatuses } from "./remote-statuses";
import { sendFor } from "./transfer";

const chatMethods = new Set<string>(handoffChatMethods);
/**
 * The calls a thread waiting on a setup makes to the setup's agent: talking
 * to it, answering it, stopping it. The rest are about the thread's own
 * messages, still here.
 */
const setupMethods = new Set<string>([
  "sendProjectChat",
  "projectChatQueueAction",
  "respondProjectChat",
  "answerProjectChatQuestion",
  "setProjectChatQuestionDismissed",
  "cancelProjectChat",
  "stopProjectChatPending",
] satisfies HandoffChatMethod[]);
/** Calls that run there only once the other computer speaks `folderHandoffBridge`. */
const folderMethods = new Set<string>([
  ...handoffFolderMethods,
  ...handoffWorktreeMethods,
]);
const hereOnlyMethods = new Set<string>(handoffHereOnlyMethods);
const hereOnly = (method: string): method is HandoffHereOnlyMethod =>
  hereOnlyMethods.has(method);

/**
 * The calls this computer makes for a thread that's live on another one:
 * run there, held here while that computer is away and sent once it's back,
 * or carried on here when it won't be back.
 */
export class HandoffForwarding {
  /** Threads whose waiting sends are going out now. */
  private flushing = new Set<string>();

  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private infos: ComputerInfos,
    private statuses: RemoteStatuses,
    private notices: HandoffNotices,
  ) {}

  /**
   * Whether the call is for a thread live on another computer, so runs there
   * or not at all. One waiting on a setup there talks to the setup's agent;
   * its folder is still here.
   */
  forwards(
    method: string,
    args: unknown[],
  ): method is HandoffMethod | HandoffHereOnlyMethod {
    if (
      !chatMethods.has(method) &&
      !folderMethods.has(method) &&
      !hereOnly(method)
    )
      return false;
    const chat = this.liveAwayIn(args[0]);
    return !!chat && (liveAway(chat) || setupMethods.has(method));
  }

  /**
   * Runs the call on the computer the thread is live on. A send waits here
   * while that computer is away, and behind any send already waiting. A call
   * on its folder runs `here` instead when that computer is too old to take
   * it, on the copy the thread left behind.
   */
  async forward(
    method: HandoffMethod | HandoffHereOnlyMethod,
    args: unknown[],
    here?: () => unknown,
  ) {
    const chat = this.liveAwayIn(args[0]);
    if (!chat) throw new Error("This thread isn't live on another computer.");
    const chatId = chat.id;
    const sentTo = chat.sentTo!;
    if (inSetup(chat)) return this.toSetup(chat, method, args);
    if (hereOnly(method))
      throw new Error(
        `This thread's files are on ${sentTo.computer}; the copy here is as it left.`,
      );
    if (folderMethods.has(method) && !sentTo.folder) {
      if (here) return here();
      throw new Error(`${sentTo.computer} runs an older Relay.`);
    }
    const online = () => this.computers.status(sentTo.computerId) === "online";
    const send =
      method === "sendProjectChat"
        ? projectChatSendSchema.parse(args[1])
        : undefined;
    const waiting =
      send && (await this.chats.liveHandoff.outbox(chatId)).length;
    if (online() && !waiting)
      try {
        return await this.callThere(
          sentTo.computerId,
          sentTo.id,
          method,
          args,
          send,
        );
      } catch (e) {
        // Turned down there, rather than lost on the way.
        if (!send || online()) throw e;
      }
    if (!send)
      throw new Error(
        `${sentTo.computer} is offline. The thread carries on once it's back.`,
      );
    await this.chats.liveHandoff.hold(chatId, sentTo.id, send);
    if (online()) void this.flush(chatId);
  }

  /** Sends what waited for the computer a thread is live on, oldest first. */
  async flush(chatId: string) {
    if (this.flushing.has(chatId)) return;
    this.flushing.add(chatId);
    try {
      for (;;) {
        const chat = listed(this.store, chatId);
        const sentTo = chat && liveAway(chat) ? chat.sentTo! : undefined;
        if (!sentTo || this.computers.status(sentTo.computerId) !== "online")
          return;
        const next = (await this.chats.liveHandoff.outbox(chatId)).find(
          (h) => !h.error,
        );
        if (!next) return;
        try {
          await this.callThere(
            sentTo.computerId,
            sentTo.id,
            "sendProjectChat",
            [chatId],
            next.input,
          );
          await this.chats.liveHandoff.settle(chatId, next.input.id);
        } catch (e) {
          if (this.computers.status(sentTo.computerId) !== "online") return;
          await this.chats.liveHandoff.settle(
            chatId,
            next.input.id,
            errorMessage(e),
          );
        }
      }
    } catch (e) {
      console.warn("A live handoff's waiting messages didn't go out:", e);
    } finally {
      this.flushing.delete(chatId);
    }
  }

  /**
   * Carries on a live thread here while its computer is offline, with what
   * waited for it sent here. That computer keeps its copy and is told. On a
   * thread already back, sends here what didn't go out last time.
   */
  async runHere(chatId: string) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo)
      return this.sendHere(
        chatId,
        await this.chats.liveHandoff.takeOut(chatId),
      );
    if (!sentTo.live || sentTo.state !== "away")
      throw new Error("This thread isn't live on another computer.");
    if (sentTo.home) throw new Error(stays(sentTo.computer));
    if (this.computers.status(sentTo.computerId) === "online")
      throw new Error(
        `${sentTo.computer} is back. Bring the thread back instead, with what it did there.`,
      );
    const held = await this.chats.handoffs.takeBack(chatId, sentTo.id);
    if (!held) return;
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: runs here while it's offline.`,
    );
    this.statuses.forget(sentTo.id);
    await this.notices.abandoned(sentTo.computerId, sentTo.id);
    await this.sendHere(chatId, held);
  }

  /** Drops a send that waits for the computer a live thread is on. */
  async dropHeld(chatId: string, sendId: string) {
    await this.chats.liveHandoff.settle(chatId, sendId);
  }

  /** The thread live on another computer a call is about, by its id or its own worktree's workspace id. */
  private liveAwayIn(first: unknown) {
    if (typeof first !== "string") return undefined;
    const { chatId, worktree } = first.includes("/")
      ? parseWorkspaceId(first)
      : { chatId: first, worktree: undefined };
    // An agent's own worktree beside the thread's isn't what went across.
    if (!chatId || worktree) return undefined;
    const chat = listed(this.store, chatId);
    return chat && (liveAway(chat) || inSetup(chat)) ? chat : undefined;
  }

  /** A call for the agent setting the thread's project up on the computer it's going to. */
  private async toSetup(chat: ChatSummary, method: string, args: unknown[]) {
    const sentTo = chat.sentTo!;
    if (this.computers.status(sentTo.computerId) !== "online")
      throw new Error(
        `${sentTo.computer} is offline. Answer its setup once it's back.`,
      );
    return this.callThere(
      sentTo.computerId,
      sentTo.setup!,
      method as HandoffMethod,
      args,
      method === "sendProjectChat"
        ? projectChatSendSchema.parse(args[1])
        : undefined,
    );
  }

  /**
   * Runs `method` on the thread `handoffId` there. A `send` goes in place of
   * the call's second argument, with its pastes as that computer takes them.
   */
  private async callThere(
    computerId: string,
    handoffId: string,
    method: HandoffMethod | HandoffHereOnlyMethod,
    args: unknown[],
    send?: ProjectChatSend,
  ) {
    const client = await this.computers.connected(computerId);
    return client.call(
      "handoffCall",
      handoffId,
      method as HandoffMethod,
      send
        ? [args[0], await sendFor(this.infos, computerId, client, send)]
        : args,
    );
  }

  /**
   * Nothing runs here yet: the first goes out, the rest queue behind it.
   * The one that fails, and every one after it, wait in the thread again.
   */
  private async sendHere(chatId: string, held: HeldSend[]) {
    for (const [i, { input }] of held.entries()) {
      const { delivery: _, ...send } = input;
      try {
        await this.chats.sendYours(chatId, send);
      } catch (e) {
        await this.chats.liveHandoff.putBack(
          chatId,
          held.slice(i),
          errorMessage(e),
        );
        return;
      }
    }
  }
}
