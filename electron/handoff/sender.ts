import { inputBlocksThread } from "../../shared/thread-state";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  handoffBlocked,
  handoffChatMethods,
  handoffChunk,
  handoffFolderMethods,
  handoffHereOnlyMethods,
  handoffWorktreeMethods,
  liveAway,
  handoffMessageSchema,
  handoffMessagesSchema,
  needsFullBundle,
  type ComputerInfo,
  type AwayThread,
  type ComputersOverview,
  type HandoffRemoteStatus,
  type HandoffTarget,
  type HandoffThread,
  type HandoffHereOnlyMethod,
  type HandoffMethod,
  type HandoffView,
  type HeldSend,
} from "../../shared/handoff";
import {
  projectChatSendSchema,
  type ChatMessage,
  type ChatSummary,
} from "../../shared/projects";
import {
  folderHandoffBridge,
  handoffBridge,
  liveHandoffBridge,
  type HandoffPart,
  type RemoteEvent,
} from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import { sentAgent } from "../../shared/recipient";
import { parseWorkspaceId } from "../../shared/workspaces";
import { git } from "../git/git";
import type { ProjectChats } from "../project-chats";
import { portableMessages } from "../project-chats/handoff";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import { computerName, type Computers } from "./computers";
import {
  bundleBranch,
  fetchBundle,
  hasCommit,
  landReturned,
  repositoryNames,
} from "../git/bundles";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const chatMethods = new Set<string>(handoffChatMethods);
/** Calls that run there only once the other computer speaks `folderHandoffBridge`. */
const folderMethods = new Set<string>([
  ...handoffFolderMethods,
  ...handoffWorktreeMethods,
]);
const hereOnlyMethods = new Set<string>(handoffHereOnlyMethods);
const hereOnly = (method: string): method is HandoffHereOnlyMethod =>
  hereOnlyMethods.has(method);
/** A handoff as main.log names it: its id's start, never the thread's title. */
const named = (id: string, computer: string) =>
  `${id.slice(0, 8)} with ${computer}`;
const seconds = (since: number) =>
  `${((Date.now() - since) / 1000).toFixed(1)}s`;
/** What a Relay from before bridge 10 answers a call it doesn't know. */
const unknownCall = "Phones can't do that.";
/** A call a Relay doesn't know: from before bridge 10, or before the call was added. */
const unsupportedCall = (e: unknown) =>
  message(e) === unknownCall || message(e) === "Computers can't do that.";

/**
 * Handing this computer's threads to the paired ones and bringing them back.
 * Each step leaves the thread's `sentTo` saying where it stands, with the
 * error when one failed, so a retry picks up with the same handoff id.
 */
export class Handoffs {
  private jobs = new Map<string, Promise<void>>();
  /** Threads whose waiting sends are going out now. */
  private flushing = new Set<string>();
  private telling: Promise<unknown> = Promise.resolve();
  private statuses = new Map<
    string,
    { at: number; status: HandoffRemoteStatus | null }
  >();
  /** Each computer's version and update, as it last said; `null` for one too old to say. */
  private infos = new Map<string, { at: number; info: ComputerInfo | null }>();
  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private projects: Projects,
    /** Scratch space for bundles on their way, a folder per handoff. */
    private dir: string,
  ) {
    computers.onOnline((id) => {
      void this.acknowledge(id);
      void this.notifyAbandoned(id);
      void this.follow(id);
    });
    computers.onOffline((id) => {
      for (const c of this.liveOn(id)) this.chats.setHandoffLive(c.id, undefined);
    });
    computers.onEvent((id, event) => this.event(id, event));
  }
  /** The thread live on another computer a call is about, by its id or its own worktree's workspace id. */
  private liveAwayIn(first: unknown) {
    if (typeof first !== "string") return undefined;
    const { chatId, worktree } = first.includes("/")
      ? parseWorkspaceId(first)
      : { chatId: first, worktree: undefined };
    // An agent's own worktree beside the thread's isn't what went across.
    if (!chatId || worktree) return undefined;
    const chat = this.store.get().chats?.find((c) => c.id === chatId);
    return chat && liveAway(chat) ? chat : undefined;
  }
  /** Whether the call is for a thread live on another computer, so runs there or not at all. */
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
    return !!this.liveAwayIn(args[0]);
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
    const waiting = send && (await this.chats.handoffOutbox(chatId)).length;
    if (online() && !waiting)
      try {
        const client = await this.computers.connected(sentTo.computerId);
        return await client.call("handoffCall", sentTo.id, method, args);
      } catch (e) {
        // Turned down there, rather than lost on the way.
        if (!send || online()) throw e;
      }
    if (!send)
      throw new Error(
        `${sentTo.computer} is offline. The thread carries on once it's back.`,
      );
    await this.chats.holdHandoffSend(chatId, sentTo.id, send);
    if (online()) void this.flush(chatId);
  }
  /** Sends what waited for the computer a thread is live on, oldest first. */
  private async flush(chatId: string) {
    if (this.flushing.has(chatId)) return;
    this.flushing.add(chatId);
    try {
      for (;;) {
        const chat = this.store.get().chats?.find((c) => c.id === chatId);
        const sentTo = chat && liveAway(chat) ? chat.sentTo! : undefined;
        if (!sentTo || this.computers.status(sentTo.computerId) !== "online")
          return;
        const next = (await this.chats.handoffOutbox(chatId)).find(
          (h) => !h.error,
        );
        if (!next) return;
        try {
          const client = await this.computers.connected(sentTo.computerId);
          await client.call("handoffCall", sentTo.id, "sendProjectChat", [
            chatId,
            next.input,
          ]);
          await this.chats.settleHandoffSend(chatId, next.input.id);
        } catch (e) {
          if (this.computers.status(sentTo.computerId) !== "online") return;
          await this.chats.settleHandoffSend(chatId, next.input.id, message(e));
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
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) return this.sendHere(chatId, await this.chats.takeHandoffSends(chatId));
    if (!sentTo.live || sentTo.state !== "away")
      throw new Error("This thread isn't live on another computer.");
    if (this.computers.status(sentTo.computerId) === "online")
      throw new Error(
        `${sentTo.computer} is back. Bring the thread back instead, with what it did there.`,
      );
    const held = await this.chats.runHandoffHere(chatId, sentTo.id);
    if (!held) return;
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: runs here while it's offline.`,
    );
    this.statuses.delete(sentTo.id);
    await this.saveAbandoned(sentTo.computerId, sentTo.id);
    void this.notifyAbandoned(sentTo.computerId);
    await this.sendHere(chatId, held);
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
        await this.chats.putBackHandoffSends(chatId, held.slice(i), message(e));
        return;
      }
    }
  }
  /** Drops a send that waits for the computer a live thread is on. */
  async dropHeld(chatId: string, sendId: string) {
    await this.chats.settleHandoffSend(chatId, sendId);
  }
  /** Threads live on the computer, rather than on their way or coming back. */
  private liveOn(computerId: string) {
    return (this.store.get().chats ?? []).filter(
      (c) => c.sentTo?.computerId === computerId && liveAway(c),
    );
  }
  /** Asks the computer to keep these threads up to date here, and for what's missed. */
  private async follow(computerId: string, chatId?: string) {
    const chats = this.liveOn(computerId).filter(
      (c) => !chatId || c.id === chatId,
    );
    if (!chats.length) return;
    try {
      const client = await this.computers.connected(computerId);
      await Promise.all(
        chats.map(async (c) => {
          const { id } = c.sentTo!;
          const known = await this.chats.handoffHeld(c.id);
          const answer = await client.call("handoffChat", id, known);
          const messages = z
            .array(z.union([z.string(), handoffMessageSchema]))
            .parse(answer.messages) as (ChatMessage | string)[];
          await this.chats.handoffSynced(c.id, id, messages);
          this.chats.setHandoffLive(c.id, answer.live);
          void this.flush(c.id);
        }),
      );
    } catch (e) {
      console.warn("Live handoffs couldn't be followed:", e);
    }
  }
  /** What a computer says about the threads live on it. */
  private event(computerId: string, event: RemoteEvent) {
    const handoffId =
      event.kind === "message"
        ? event.chatId
        : event.kind === "handoff"
          ? event.id
          : undefined;
    const chat =
      handoffId &&
      this.liveOn(computerId).find((c) => c.sentTo!.id === handoffId);
    if (!chat) return;
    if (event.kind === "handoff") {
      this.chats.setHandoffLive(chat.id, event.live);
      return;
    }
    if (event.kind !== "message") return;
    const parsed = handoffMessageSchema.safeParse(event.message);
    if (!parsed.success)
      return console.warn("A live handoff's message didn't read:", parsed.error);
    void this.chats
      .mirrorHandoff(chat.id, handoffId, parsed.data as ChatMessage)
      .catch((e) => console.warn("A live handoff's message wasn't kept:", e));
  }
  private summary(chatId: string): ChatSummary {
    const chat = this.store.get().chats?.find((c) => c.id === chatId);
    if (!chat) throw new Error("Chat not found.");
    return chat;
  }
  /** The paired computers, and whether each has this thread's repository. */
  async targets(chatId: string): Promise<HandoffTarget[]> {
    const chat = this.summary(chatId);
    const repositories = await this.projects
      .root(chat.projectId)
      .then(repositoryNames)
      .catch((): string[] => []);
    return Promise.all(
      this.computers.list().map(async (c): Promise<HandoffTarget> => {
        const base = { id: c.id, name: c.name };
        if (c.status !== "online")
          return {
            ...base,
            online: false,
            problem: c.status === "denied" ? "Pair again" : "Offline",
          };
        if (!repositories.length)
          return { ...base, online: true, problem: "No Git remote to match" };
        try {
          const client = await this.computers.connected(c.id);
          if (outdated(await this.info(c.id, client)))
            return { ...base, online: true, problem: "Needs a Relay update" };
          const projects = await client.call("computerProjects");
          const match = projects.find((p) =>
            p.repositories.some((r) => repositories.includes(r)),
          );
          return match
            ? {
                ...base,
                online: true,
                project: { id: match.id, name: match.name },
              }
            : { ...base, online: true, problem: `Not cloned on ${c.name}` };
        } catch (e) {
          return { ...base, online: false, problem: message(e) };
        }
      }),
    );
  }
  /**
   * Asks each online computer about the threads it has from here, unless
   * they were asked about within seconds; `withInfo` asks its version too.
   * Returns the threads that are away.
   */
  private async refresh(withInfo: boolean) {
    const away = (this.store.get().chats ?? []).filter((c) => c.sentTo);
    await Promise.all(
      this.computers
        .list()
        .filter((c) => c.status === "online")
        .map(async (c) => {
          const ids = away
            .map((a) => a.sentTo!)
            .filter((s) => s.computerId === c.id && s.state !== "sending")
            .map((s) => s.id);
          const stale = ids.some(
            (id) => Date.now() - (this.statuses.get(id)?.at ?? 0) > 4000,
          );
          if (!stale && !withInfo) return;
          try {
            const client = await this.computers.connected(c.id);
            if (withInfo) await this.info(c.id, client);
            if (!stale) return;
            const found = await client.call("handoffStatus", ids);
            for (const id of ids) this.remember(id, found[id] ?? null);
          } catch {
            // Offline after all; the last known states stand.
          }
        }),
    );
    return away;
  }
  /** The other computer's clock stays there: how long its turn ran becomes since when, here. */
  private remember(id: string, status: HandoffRemoteStatus | null) {
    const at = Date.now();
    this.statuses.set(id, {
      at,
      status:
        status?.runningFor === undefined
          ? status
          : { ...status, runningSince: at - status.runningFor },
    });
    return this.statuses.get(id)!.status;
  }
  /** Every thread that's away, as its strip shows it, for the sidebar's cards. */
  async views(): Promise<Record<string, HandoffView>> {
    const away = await this.refresh(false);
    return Object.fromEntries(
      away.map((chat) => {
        const sentTo = chat.sentTo!;
        const remote = this.statuses.get(sentTo.id)?.status;
        const online = this.computers.status(sentTo.computerId) === "online";
        return [chat.id, { sentTo, online, ...(remote ? { remote } : {}) }];
      }),
    );
  }
  /** Each paired computer with the threads this one handed it, statuses fresh within seconds. */
  async overview(): Promise<ComputersOverview> {
    const away = await this.refresh(true);
    const computers = this.computers.list();
    const projectName = (id: string) => {
      try {
        return this.projects.get(id).name;
      } catch {
        return "Removed project";
      }
    };
    const thread = (chat: ChatSummary): AwayThread => {
      const sentTo = chat.sentTo!;
      const remote = this.statuses.get(sentTo.id)?.status;
      const state = sentTo.error
        ? "failed"
        : sentTo.state !== "away"
          ? sentTo.state
          : !remote
            ? "unknown"
            : inputBlocksThread(remote)
              ? "waiting"
              : remote.running
                ? "working"
                : remote.failed
                  ? "stopped"
                  : "finished";
      return {
        chatId: chat.id,
        projectId: chat.projectId,
        project: projectName(chat.projectId),
        title: remote?.title ?? chat.title,
        state,
        since:
          (state === "finished" || state === "stopped") && remote
            ? remote.updated
            : sentTo.at,
        ...(sentTo.error || remote?.failed
          ? { error: sentTo.error ?? remote?.failed }
          : {}),
        ...(sentTo.error && !sentTo.conflicts?.length
          ? { retry: sentTo.state === "sending" ? "send" : "return" }
          : {}),
      };
    };
    return {
      name: computerName(),
      computers: computers.map((c) => {
        const known = c.status === "online" ? this.infos.get(c.id) : undefined;
        const info = known?.info;
        return {
          ...c,
          ...(info ? { version: info.version, update: info.update } : {}),
          ...(known && outdated(info) ? { outdated: true } : {}),
          threads: away
            .filter((a) => a.sentTo!.computerId === c.id)
            .map(thread),
        };
      }),
    };
  }
  /** Has the computer update Relay; it restarts, and its link comes back by itself. */
  async update(computerId: string) {
    const client = await this.computers.connected(computerId);
    if ((await this.info(computerId, client, true)) === null)
      throw new Error(
        `${this.computers.get(computerId).name} runs a Relay too old to update from here. Update it there once.`,
      );
    const update = await client.call("updateNow");
    const known = this.infos.get(computerId)?.info;
    if (known)
      this.infos.set(computerId, {
        at: Date.now(),
        info: { ...known, update },
      });
    return update;
  }
  /** The computer's version and update, asked at most every few seconds. */
  private async info(computerId: string, client: RemoteClient, fresh = false) {
    const cached = this.infos.get(computerId);
    if (!fresh && cached && Date.now() - cached.at < 3000) return cached.info;
    const info = await client.call("computerInfo").catch((e) => {
      if (message(e) === unknownCall) return null;
      throw e;
    });
    this.infos.set(computerId, { at: Date.now(), info });
    return info;
  }
  async handOff(chatId: string, computerId: string) {
    if (this.jobs.has(chatId))
      throw new Error("This thread is already on its way.");
    const chat = this.summary(chatId);
    if (chat.sentTo)
      throw new Error(`This thread is on ${chat.sentTo.computer} already.`);
    const blocked = handoffBlocked(chat);
    if (blocked) throw new Error(blocked);
    const computer = this.computers.get(computerId);
    const id = randomUUID();
    await this.chats.markHandoff(chatId, {
      id,
      computerId,
      computer: computer.name,
      at: Date.now(),
    });
    this.run(chatId, () => this.send(chatId, id, computerId));
  }
  /** Once the handoff or bringing back under way for the thread is over, however it went. */
  async finished(chatId: string) {
    await this.jobs.get(chatId);
  }
  /** Sends a handoff that failed on its way again, with the same id. */
  async retry(chatId: string) {
    const sentTo = this.summary(chatId).sentTo;
    if (sentTo?.state !== "sending" || this.jobs.has(chatId)) return;
    await this.chats.updateSentTo(chatId, sentTo.id, { error: undefined });
    this.run(chatId, () => this.send(chatId, sentTo.id, sentTo.computerId));
  }
  /**
   * Brings the thread back, or tries again after the last attempt failed.
   * `park` brings it back even when its work clashes with the worktree,
   * leaving the work at its handoff ref for the thread to replay.
   */
  async bringBack(chatId: string, park = false) {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) throw new Error("This thread is already here.");
    if (sentTo.state === "sending")
      throw new Error(
        "The handoff hasn't finished. Try it again, or keep the thread here.",
      );
    if (this.jobs.has(chatId)) return;
    await this.chats.updateSentTo(chatId, sentTo.id, {
      state: "returning",
      error: undefined,
      conflicts: undefined,
    });
    this.run(chatId, () =>
      this.back(chatId, sentTo.id, sentTo.computerId, park),
    );
  }
  /**
   * Gives up on a handoff that never arrived, keeping the thread here. Only
   * the other computer saying it has no such thread proves that; unreachable,
   * it may have taken the thread with the answer lost on the way.
   */
  async keepHere(chatId: string) {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) return;
    if (sentTo.state !== "sending" || this.jobs.has(chatId))
      throw new Error(
        `${sentTo.computer} has this thread. Bring it back instead.`,
      );
    let status: HandoffRemoteStatus | null;
    try {
      status = await this.remote(sentTo, true);
    } catch {
      throw new Error(
        `Can't tell whether ${sentTo.computer} got this thread, because it can't be reached. Try again once it's back, or take the thread back without ${sentTo.computer}.`,
      );
    }
    if (status) {
      await this.chats.updateSentTo(chatId, sentTo.id, {
        state: "away",
        error: undefined,
      });
      throw new Error(
        `${sentTo.computer} got this thread after all. Bring it back instead, or take the thread back without ${sentTo.computer}.`,
      );
    }
    await this.chats.updateSentTo(chatId, sentTo.id, null);
  }
  /**
   * Takes the thread back without the computer that has it, for when that
   * one can't give it back. The thread unlocks here as it left; whatever was
   * done there stays there.
   */
  async abandon(chatId: string) {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) return;
    if (sentTo.state === "returning" && this.jobs.has(chatId))
      throw new Error(
        `It's being brought back from ${sentTo.computer} right now. If that fails, you can take it back without ${sentTo.computer}.`,
      );
    if (!(await this.chats.abandonHandoff(chatId, sentTo.id))) return;
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: taken back without it.`,
    );
    this.statuses.delete(sentTo.id);
    await this.saveAbandoned(sentTo.computerId, sentTo.id);
    void this.notifyAbandoned(sentTo.computerId);
  }
  async view(chatId: string): Promise<HandoffView | null> {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) return null;
    const online = this.computers.status(sentTo.computerId) === "online";
    const remote =
      online && sentTo.state !== "sending"
        ? await this.remote(sentTo).catch(() => undefined)
        : this.statuses.get(sentTo.id)?.status;
    return { sentTo, online, ...(remote ? { remote } : {}) };
  }
  /** The other computer's view of the thread, asked at most every few seconds. */
  private async remote(
    sentTo: NonNullable<ChatSummary["sentTo"]>,
    fresh = false,
  ) {
    const cached = this.statuses.get(sentTo.id);
    if (!fresh && cached && Date.now() - cached.at < 4000) return cached.status;
    const client = await this.computers.connected(sentTo.computerId);
    return this.remember(
      sentTo.id,
      (await client.call("handoffStatus", [sentTo.id]))[sentTo.id] ?? null,
    );
  }
  private run(chatId: string, job: () => Promise<void>) {
    const running = job()
      .catch((e) => console.warn("Handoff:", e))
      .finally(() => this.jobs.delete(chatId));
    this.jobs.set(chatId, running);
  }
  /** Keeps the notice for the computer until it has heard, even across a restart. */
  private async saveAbandoned(computerId: string, id: string) {
    const known = this.computers.get(computerId).abandoned ?? [];
    await this.computers.setPending(computerId, "abandoned", [
      ...new Set([...known, id]),
    ]);
  }
  /** Whether the thread is still on this handoff, rather than taken back. */
  private onHandoff(chatId: string, id: string) {
    return (
      this.store.get().chats?.find((c) => c.id === chatId)?.sentTo?.id === id
    );
  }
  /** Stop, note and commit here, then the thread and its code across. */
  private async send(chatId: string, id: string, computerId: string) {
    const folder = join(this.dir, id);
    const started = Date.now();
    try {
      if (!this.onHandoff(chatId, id)) return;
      const { name } = this.computers.get(computerId);
      const { chat, root, tip } = await this.chats.leave(chatId, name);
      if (!this.onHandoff(chatId, id)) return;
      const worktree = chat.worktree!;
      const input = chat.lastInput;
      if (!input)
        throw new Error("Send a message before handing the thread off.");
      const repositories = await repositoryNames(root);
      if (!repositories.length)
        throw new Error(
          `This project has no Git remote, so ${name} can't find its copy.`,
        );
      const client = await this.computers.connected(computerId);
      const info = await this.info(computerId, client, true);
      if (outdated(info))
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      const thread: HandoffThread = {
        from: computerName(),
        repositories,
        title: chat.title,
        scope: chat.scope,
        settings: {
          provider: sentAgent(input),
          choice: input.choice,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          ...(input.contextWindow
            ? { contextWindow: input.contextWindow }
            : {}),
        },
        messages: portableMessages(chat.messages),
        git: {
          branch: worktree.branch!,
          tip,
          bundle: false,
          ...(worktree.from ? { from: worktree.from } : {}),
          ...(worktree.start ? { start: worktree.start } : {}),
        },
      };
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const bundle = join(folder, "bundle");
      const across = async (full: boolean) => {
        await rm(bundle, { force: true });
        thread.git.bundle =
          (await bundleBranch(root, thread.git.branch, bundle, { full })) !==
          false;
        const json = join(folder, "thread");
        await writeFile(json, JSON.stringify(thread), { mode: 0o600 });
        await upload(client, id, "thread", json);
        if (thread.git.bundle) await upload(client, id, "bundle", bundle);
        await client.call("receiveHandoff", id);
      };
      try {
        await across(false);
      } catch (e) {
        // The other side lacks what the lean bundle builds on.
        if (message(e) !== needsFullBundle) throw e;
        await across(true);
      }
      const live = info!.bridge >= liveHandoffBridge;
      await this.chats.updateSentTo(chatId, id, {
        state: "away",
        error: undefined,
        ...(live
          ? {
              live: true,
              kept: chat.messages.length,
              ...(info!.bridge >= folderHandoffBridge ? { folder: true } : {}),
            }
          : {}),
      });
      await rm(folder, { recursive: true, force: true });
      console.info(
        `Handoff ${named(id, name)}: sent in ${seconds(started)}${thread.git.bundle ? "" : ", no bundle needed"}${live ? ", live" : ""}.`,
      );
      if (live) void this.follow(computerId, chatId);
    } catch (e) {
      console.warn(
        `Handoff ${named(id, this.nameOf(computerId))} didn't go out:`,
        message(e),
      );
      await this.chats.updateSentTo(chatId, id, { error: message(e) });
    }
  }
  private nameOf(computerId: string) {
    try {
      return this.computers.get(computerId).name;
    } catch {
      return "a computer no longer paired";
    }
  }
  /** The other side stops, notes and commits; its work comes back into this worktree. */
  private async back(
    chatId: string,
    id: string,
    computerId: string,
    park: boolean,
  ) {
    const folder = join(this.dir, id);
    const ref = `refs/relay/handoffs/${id}`;
    const started = Date.now();
    try {
      const path = this.summary(chatId).worktree?.path;
      if (!path)
        throw new Error("The thread's worktree is gone on this computer.");
      const client = await this.computers.connected(computerId);
      const back = await client.call("handBack", id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const json = join(folder, "thread");
      await download(client, id, "thread", back.thread, json);
      const messages = readReturned(
        await readFile(json, "utf8"),
        this.computers.get(computerId).name,
      );
      if (back.bundle) {
        const bundle = join(folder, "bundle");
        await download(client, id, "bundle", back.bundle, bundle);
        if ((await fetchBundle(path, bundle, back.branch, ref)) !== back.tip)
          throw new Error("The bundle doesn't hold the returned commit.");
      } else if (!(await hasCommit(path, back.tip)))
        throw new Error("The returned commit is missing here.");
      if (!park) {
        const computer = this.computers.get(computerId).name;
        const conflicts = await landReturned(path, back.tip, computer).catch(
          (e) => {
            throw new Error(
              `Its work couldn't land in the worktree (${message(e)}). It's kept at ${ref}.`,
            );
          },
        );
        if (conflicts.length) {
          console.warn(
            `Handoff ${named(id, computer)}: came back clashing in ${conflicts.length} file(s), kept at ${ref}.`,
          );
          await this.chats.updateSentTo(chatId, id, {
            error: `Its work and what was committed here meanwhile both change ${conflicts.join(", ")}. It's kept at ${ref}.`,
            conflicts,
          });
          return;
        }
        await git(path, ["update-ref", "-d", ref]).catch(() => {});
      }
      await this.chats.returned(chatId, id, messages);
      console.info(
        `Handoff ${named(id, this.nameOf(computerId))}: back in ${seconds(started)}${park ? ", parked" : ""}.`,
      );
      this.statuses.delete(id);
      await rm(folder, { recursive: true, force: true });
      await this.acknowledge(computerId, id);
    } catch (e) {
      console.warn(
        `Handoff ${named(id, this.nameOf(computerId))} didn't come back:`,
        message(e),
      );
      await this.chats.updateSentTo(chatId, id, { error: message(e) });
    }
  }
  /** Tells the other computer its copies came back, including any it missed. */
  private acknowledge(computerId: string, id?: string) {
    return this.tell(computerId, "unacknowledged", id);
  }
  /** Tells the other computer a thread was taken back without it, including any it missed. */
  private notifyAbandoned(computerId: string, id?: string) {
    return this.tell(computerId, "abandoned", id);
  }
  /**
   * Says `kind` of word about `id` and every one still waiting to be said to
   * the computer. What doesn't get through stays saved for when it's online;
   * a Relay too old to know the call is a lost cause, so that's let go.
   */
  private tell(
    computerId: string,
    kind: "unacknowledged" | "abandoned",
    id?: string,
  ) {
    const run = async () => {
      let computer;
      try {
        computer = this.computers.get(computerId);
      } catch {
        return;
      }
      const ids = [
        ...new Set([...(computer[kind] ?? []), ...(id ? [id] : [])]),
      ];
      if (!ids.length) return;
      const method = kind === "abandoned" ? "handoffAbandoned" : "handedBack";
      const left: string[] = [];
      let client: RemoteClient | undefined;
      try {
        client = await this.computers.connected(computerId);
      } catch {
        left.push(...ids);
      }
      for (const each of client ? ids : []) {
        try {
          await client!.call(method, each);
        } catch (e) {
          if (!unsupportedCall(e)) left.push(each);
        }
      }
      await this.computers.setPending(computerId, kind, left);
    };
    // One at a time, so a later run can't write over what an earlier one saved.
    const next = this.telling.then(run, run);
    this.telling = next.catch(() => undefined);
    return next;
  }
}

/** The thread as it came back, or an error naming what's wrong, before anything of it is applied. */
function readReturned(text: string, computer: string): ChatMessage[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${computer} sent the thread back unreadable.`);
  }
  const parsed = handoffMessagesSchema.safeParse(json);
  if (parsed.success) return parsed.data as ChatMessage[];
  const [issue] = parsed.error.issues;
  const [at, ...field] = issue!.path;
  const where =
    typeof at === "number"
      ? `message ${at + 1}${field.length ? `'s ${field.join(".")}` : ""}`
      : "the message list";
  throw new Error(
    `${computer} sent the thread back in a form this Relay can't read (${where}: ${issue!.message}). Nothing was changed here.`,
  );
}

/** Too old to take threads from this computer: before bridge 10, or before the handoffs this one makes. */
export const outdated = (info: ComputerInfo | null | undefined) =>
  info === null || (!!info && info.bridge < handoffBridge);

async function upload(
  client: RemoteClient,
  id: string,
  part: HandoffPart,
  file: string,
) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(handoffChunk);
    for (let offset = 0; ;) {
      const { bytesRead } = await handle.read(buffer, 0, handoffChunk, offset);
      if (!bytesRead && offset) return;
      await client.call(
        "handoffUpload",
        id,
        part,
        offset,
        buffer.subarray(0, bytesRead).toString("base64"),
      );
      offset += bytesRead;
      if (bytesRead < handoffChunk) return;
    }
  } finally {
    await handle.close();
  }
}

async function download(
  client: RemoteClient,
  id: string,
  part: HandoffPart,
  size: number,
  file: string,
) {
  const handle = await open(file, "w", 0o600);
  try {
    for (let offset = 0; offset < size;) {
      const bytes = Buffer.from(
        await client.call("handoffDownload", id, part, offset),
        "base64",
      );
      if (!bytes.length) throw new Error("The download ended early.");
      await handle.write(bytes);
      offset += bytes.length;
    }
  } finally {
    await handle.close();
  }
}
