import {
  forwardedArgs,
  handoffChatMethods,
  handoffFolderMethods,
  handoffHereOnlyMethods,
  handoffWorktreeMethods,
  inSetup,
  liveAway,
  type ChatSentTo,
  type HandoffChatMethod,
  type HandoffHereOnlyMethod,
  type HandoffMethod,
  type HeldSend,
} from "../../shared/handoff";
import {
  chatTriageSchema,
  projectChatSendSchema,
  type ChatSummary,
  type ChatTriage,
  type ProjectChatSend,
} from "../../shared/projects";
import type { VideoPart } from "../../shared/answer-images";
import { maxAudioBytes } from "../../shared/audio";
import { errorMessage } from "../../shared/error-message";
import type { SavedSecrets } from "../../shared/secret-request";
import { sharedHandoffTriage } from "../../shared/handoff-triage";
import { parseWorkspaceId } from "../../shared/workspaces";
import type { Store } from "../app/store";
import type { ProjectChats } from "../project-chats";
import type { ComputerInfos } from "./computer-infos";
import type { Computers } from "./computers";
import { listed, named, stays, summaryOf } from "./away";
import type { HandoffNotices } from "./notices";
import type { RemoteStatuses } from "./remote-statuses";
import { nameOf } from "./targets";
import { sendFor } from "./transfer";

const chatMethods = new Set<string>(handoffChatMethods);

/** Writing in the thread from here, which makes one only looked at a thread of yours. */
const writes = new Set<string>([
  "sendProjectChat",
  "respondProjectChat",
  "answerProjectChatQuestion",
] satisfies HandoffChatMethod[]);

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
    // One handed from here keeps its lead here; one of that computer's own has it there.
    if (method === "detachProjectChat") return !!chat?.sentTo?.home;
    if (method === "triageProjectChat") {
      const action = chatTriageSchema.safeParse(args[1]);
      if (!action.success || !sharedHandoffTriage(action.data)) return false;
    }
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
    if (method === "triageProjectChat")
      return this.triage(chat, chatTriageSchema.parse(args[1]));
    if (method === "detachProjectChat") return this.detach(chat);
    if (hereOnly(method))
      throw new Error(
        `This thread's files are on ${sentTo.computer}; the copy here is as it left.`,
      );
    if (method === "projectChatImage")
      return this.sentImage(sentTo, args as [string, string], here);
    if (method === "projectChatAudio")
      return this.sentAudio(sentTo, args as [string, string], here);
    if (method === "threadSecrets") return this.secretsThere(sentTo, args);
    if (folderMethods.has(method) && !sentTo.folder) {
      if (here) return here();
      throw new Error(`${sentTo.computer} runs an older Relay.`);
    }
    if (sentTo.peek && writes.has(method))
      await this.chats.handoffs.updateSentTo(chatId, sentTo.id, {
        peek: undefined,
      });
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
   * Detached on the thread's computer, where its lead is, which refuses
   * while the lead works; then here, as that computer no longer names it.
   */
  private async detach(chat: ChatSummary) {
    const sentTo = chat.sentTo!;
    await this.callThere(sentTo.computerId, sentTo.id, "detachProjectChat", [
      chat.id,
    ]);
    return this.chats.liveHandoff.started.letGo(chat.id);
  }

  /**
   * Shelf actions run on the thread's computer; undo never changes its local
   * archive mark. A snooze kept here alone stays here, and so does waking or
   * undoing it.
   */
  private async triage(chat: ChatSummary, action: ChatTriage) {
    if (action.kind === "restore") {
      if (chat.archivedAt !== action.from.archivedAt)
        throw new Error(
          "This thread changed since, so there's nothing to undo.",
        );
      const { archivedAt: _from, ...from } = action.from;
      const { archivedAt: _to, ...to } = action.to;
      action = { kind: "restore", from, to };
    }
    const sentTo = chat.sentTo!;
    if (action.kind === "snooze" && action.here) {
      if (action.until <= Date.now())
        throw new Error("Choose a future wake time.");
      await this.setSnoozeHere(chat, { at: Date.now(), until: action.until });
      return this.mirrored(chat);
    }
    if (this.endsSnoozeHere(sentTo, action)) {
      await this.setSnoozeHere(chat, undefined);
      return this.mirrored(chat);
    }
    const summary = (await this.callThere(
      sentTo.computerId,
      sentTo.id,
      "triageProjectChat",
      [chat.id, action],
    )) as ChatSummary;
    this.chats.liveHandoff.triaged(chat.id, summary);
    // Moved over there too, so the snooze kept here is behind it.
    if (sentTo.snoozedHere) await this.setSnoozeHere(chat, undefined);
    return this.mirrored(chat);
  }

  /** Waking the thread, or undoing its snooze, when the snooze was kept here alone. */
  private endsSnoozeHere(sentTo: ChatSentTo, action: ChatTriage) {
    const snoozedHere = sentTo.snoozedHere;
    if (!snoozedHere) return false;
    if (action.kind === "wake") return true;
    return (
      action.kind === "restore" && action.from.snoozedAt === snoozedHere.at
    );
  }

  private setSnoozeHere(
    chat: ChatSummary,
    snoozedHere: ChatSentTo["snoozedHere"],
  ) {
    return this.chats.handoffs.updateSentTo(chat.id, chat.sentTo!.id, {
      snoozedHere,
    });
  }

  /** The thread as this computer lists it now. */
  private mirrored(chat: ChatSummary) {
    const mirrored = this.chats
      .list(chat.projectId)
      .find((c) => c.id === chat.id);
    if (!mirrored)
      throw new Error("This thread was removed while its action ran.");
    return mirrored;
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
   * A sent image of the thread, from here once it was fetched: the computer
   * the thread is live on saved it, and the link there can drop.
   */
  private async sentImage(
    sentTo: NonNullable<ChatSummary["sentTo"]>,
    args: [chatId: string, imageId: string],
    here?: () => unknown,
  ) {
    const kept = await Promise.resolve(here?.()).catch(() => undefined);
    if (typeof kept === "string") return kept;
    const image = await this.callThere(
      sentTo.computerId,
      sentTo.id,
      "projectChatImage",
      args,
    );
    if (typeof image !== "string")
      throw new Error(`${sentTo.computer} sent the image back unreadable.`);
    await this.chats.files
      .keepImage(...args, image)
      .catch((e) =>
        console.warn("A thread's image from there wasn't kept:", e),
      );
    return image;
  }

  /**
   * A sent audio clip of the thread, streamed from here once downloaded in
   * chunks: the other computer's local media URL wouldn't resolve here, and
   * keeping the bytes lets playback keep working while the link is down.
   */
  private async sentAudio(
    sentTo: NonNullable<ChatSummary["sentTo"]>,
    args: [chatId: string, audioId: string],
    here?: () => unknown,
  ) {
    const kept = await Promise.resolve(here?.()).catch(() => undefined);
    if (typeof kept === "string") return kept;
    const chunks: Buffer[] = [];
    let offset = 0;
    let size = Infinity;
    while (offset < size) {
      const part = (await this.callThere(
        sentTo.computerId,
        sentTo.id,
        "projectChatAudioPart",
        [args[0], args[1], offset],
      )) as VideoPart;
      if (
        !part ||
        typeof part.size !== "number" ||
        typeof part.data !== "string" ||
        part.size <= 0 ||
        part.size > maxAudioBytes
      )
        throw new Error(`${sentTo.computer} sent the audio back unreadable.`);
      size = part.size;
      const chunk = Buffer.from(part.data, "base64");
      if (!chunk.length || offset + chunk.length > size)
        throw new Error(`${sentTo.computer} sent the audio back incomplete.`);
      chunks.push(chunk);
      offset += chunk.length;
    }
    await this.chats.files.keepAudio(
      args[0],
      args[1],
      Buffer.concat(chunks, size),
    );
    if (!here) throw new Error("Local audio handler is unavailable.");
    return here();
  }

  /** What the thread's project has saved on the computer it runs on, which the answer names. */
  private async secretsThere(
    sentTo: NonNullable<ChatSummary["sentTo"]>,
    args: unknown[],
  ): Promise<SavedSecrets> {
    const saved = (await this.callThere(
      sentTo.computerId,
      sentTo.id,
      "threadSecrets",
      args,
    )) as SavedSecrets;
    return { ...saved, computer: sentTo.computer };
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
    const there = { id: computerId, name: nameOf(this.computers, computerId) };
    return client.call(
      "handoffCall",
      handoffId,
      method as HandoffMethod,
      send
        ? [args[0], await sendFor(this.infos, there, client, send)]
        : forwardedArgs(args),
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
