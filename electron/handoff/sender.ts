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
  inSetup,
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
  type HandoffChatMethod,
  type HandoffMethod,
  type HandoffView,
  type HeldSend,
} from "../../shared/handoff";
import {
  projectChatSendSchema,
  type ProjectChatSend,
  type ChatMessage,
  type ChatSummary,
} from "../../shared/projects";
import {
  cloneBridge,
  setupBridge,
  folderHandoffBridge,
  handoffBridge,
  startHandoffBridge,
  liveHandoffBridge,
  skillsBridge,
  pastesBridge,
  type ComputerProject,
  type HandoffPart,
  type RemoteEvent,
} from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import { sentAgent } from "../../shared/recipient";
import { parseWorkspaceId } from "../../shared/workspaces";
import { git } from "../git/git";
import type { ProjectChats } from "../project-chats";
import { portableMessages } from "../project-chats/handoff";
import { receivePastes, sendPastes } from "./pastes";
import type { Projects } from "../projects/projects";
import type { Store } from "../app/store";
import { computerName, type Computers } from "./computers";
import { cloneUrl } from "./remote-setup";
import {
  bundleBranch,
  fetchBundle,
  hasCommit,
  landReturned,
  repositoryNames,
} from "../git/bundles";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
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

/** What another computer tells of a thread it took over live. */
const handoffNewsSchema = z.object({
  kind: z.enum(["waiting", "finished", "failed"]),
  title: z.string().max(1000),
  body: z.string().max(4000),
  byAgent: z.literal(true).optional(),
});

/**
 * Handing this computer's threads to the paired ones and bringing them back.
 * Each step leaves the thread's `sentTo` saying where it stands, with the
 * error when one failed, so a retry picks up with the same handoff id.
 */
export class Handoffs {
  private jobs = new Map<string, Promise<void>>();
  /** Attachment downloads must not let a later message overtake an earlier one. */
  private mirrors = new Map<string, Promise<void>>();
  /** Threads whose waiting sends are going out now. */
  private flushing = new Set<string>();
  private telling: Promise<unknown> = Promise.resolve();
  private statuses = new Map<
    string,
    { at: number; status: HandoffRemoteStatus | null }
  >();
  /** Each computer's version and update, as it last said; `null` for one too old to say. */
  private infos = new Map<string, { at: number; info: ComputerInfo | null }>();
  /** Clones of this computer's projects on paired ones, by computer and project id; a failed one keeps its error. */
  /** Setups being asked for, by computer and project, so threads failing together share one. */
  private startingSetups = new Map<string, Promise<string>>();
  private clones = new Map<
    string,
    {
      job: Promise<ComputerProject>;
      step: string;
      progress: number | null;
      error?: string;
    }
  >();
  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private projects: Projects,
    /** Scratch space for bundles on their way, a folder per handoff. */
    private dir: string,
    /** How long the other computer's answers are reused; tests ask every time. */
    private reuse = { statusMs: 4000, infoMs: 3000 },
  ) {
    computers.onOnline((id) => {
      void this.acknowledge(id);
      void this.notifyAbandoned(id);
      void this.follow(id);
      void this.followSetups(id);
    });
    computers.onOffline((id) => {
      for (const c of [...this.liveOn(id), ...this.setupsOn(id)])
        this.chats.setHandoffLive(c.id, undefined);
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
    return chat && (liveAway(chat) || inSetup(chat)) ? chat : undefined;
  }
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
    const waiting = send && (await this.chats.handoffOutbox(chatId)).length;
    if (online() && !waiting)
      try {
        const client = await this.computers.connected(sentTo.computerId);
        return await client.call(
          "handoffCall",
          sentTo.id,
          method,
          send
            ? [args[0], await this.sendFor(sentTo.computerId, client, send)]
            : args,
        );
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
  /** A call for the agent setting the thread's project up on the computer it's going to. */
  private async toSetup(chat: ChatSummary, method: string, args: unknown[]) {
    const sentTo = chat.sentTo!;
    if (this.computers.status(sentTo.computerId) !== "online")
      throw new Error(
        `${sentTo.computer} is offline. Answer its setup once it's back.`,
      );
    const client = await this.computers.connected(sentTo.computerId);
    const send =
      method === "sendProjectChat"
        ? projectChatSendSchema.parse(args[1])
        : undefined;
    return client.call(
      "handoffCall",
      sentTo.setup!,
      method as HandoffMethod,
      send
        ? [args[0], await this.sendFor(sentTo.computerId, client, send)]
        : args,
    );
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
            await this.sendFor(sentTo.computerId, client, next.input),
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
    if (!sentTo)
      return this.sendHere(chatId, await this.chats.takeHandoffSends(chatId));
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
          const carried = await this.receivePastes(
            computerId,
            client,
            messages.filter((m): m is ChatMessage => typeof m !== "string"),
          );
          let next = 0;
          await this.chats.handoffSynced(
            c.id,
            id,
            messages.map((m) => (typeof m === "string" ? m : carried[next++]!)),
          );
          this.chats.setHandoffLive(c.id, answer.live);
          void this.flush(c.id);
        }),
      );
    } catch (e) {
      console.warn("Live handoffs couldn't be followed:", e);
    }
  }
  /** Threads waiting on a setup on the computer, its agent at work there. */
  private setupsOn(computerId: string) {
    return (this.store.get().chats ?? []).filter(
      (c) => c.sentTo?.computerId === computerId && inSetup(c),
    );
  }
  /** Asks the computer to keep the setups under way there up to date here, and for what's missed. */
  private async followSetups(computerId: string, chatId?: string) {
    const chats = this.setupsOn(computerId).filter(
      (c) => !chatId || c.id === chatId,
    );
    if (!chats.length) return;
    try {
      const client = await this.computers.connected(computerId);
      await Promise.all(
        chats.map(async (c) => {
          const answer = await client.call(
            "handoffChat",
            c.sentTo!.setup!,
            await this.chats.setupHeld(c.id),
          );
          const messages = z
            .array(z.union([z.string(), handoffMessageSchema]))
            .parse(answer.messages) as (ChatMessage | string)[];
          await this.chats.setupSynced(c.id, messages);
          this.chats.setHandoffLive(c.id, answer.live);
          // It may have finished while this computer wasn't listening.
          this.checkSetup(c.id);
        }),
      );
    } catch (e) {
      console.warn("Setups on another computer couldn't be followed:", e);
    }
  }
  /** Looks again whether the setup the thread waits on is done, and hands it off when it is. */
  private checkSetup(chatId: string) {
    const sentTo = this.store.get().chats?.find((c) => c.id === chatId)?.sentTo;
    if (!sentTo?.setup || sentTo.error || this.jobs.has(chatId)) return;
    this.run(chatId, () => this.send(chatId, sentTo.id, sentTo.computerId));
  }
  /** What the agent setting a thread's project up there writes, and how it stands. */
  private setupEvent(chat: ChatSummary, event: RemoteEvent) {
    if (event.kind === "handoff") {
      this.chats.setHandoffLive(chat.id, event.live);
      return;
    }
    if (event.kind === "news") {
      const news = handoffNewsSchema.safeParse(event.item);
      if (news.success)
        this.chats.handoffNews(chat.id, chat.projectId, news.data);
      return;
    }
    if (event.kind !== "message") return;
    const parsed = handoffMessageSchema.safeParse(event.message);
    if (!parsed.success)
      return console.warn("A setup's message didn't read:", parsed.error);
    const message = parsed.data as ChatMessage;
    void this.chats
      .mirrorSetup(chat.id, message)
      .then(() => {
        if (message.role === "assistant" && message.status !== "streaming")
          this.checkSetup(chat.id);
      })
      .catch((e) => console.warn("A setup's message wasn't kept:", e));
  }
  /** What a computer says about the threads live on it. */
  private event(computerId: string, event: RemoteEvent) {
    const handoffId =
      event.kind === "message"
        ? event.chatId
        : event.kind === "handoff"
          ? event.id
          : event.kind === "news"
            ? event.item?.chatId
            : undefined;
    const chat =
      handoffId &&
      this.liveOn(computerId).find((c) => c.sentTo!.id === handoffId);
    if (!chat) {
      // Threads waiting on the same project there share its setup.
      for (const c of this.setupsOn(computerId))
        if (c.sentTo!.setup === handoffId) this.setupEvent(c, event);
      return;
    }
    if (event.kind === "handoff") {
      this.chats.setHandoffLive(chat.id, event.live);
      return;
    }
    // Its answers end there, so their news is told here as that computer decided it.
    if (event.kind === "news") {
      const news = handoffNewsSchema.safeParse(event.item);
      if (news.success)
        this.chats.handoffNews(chat.id, chat.projectId, news.data);
      else console.warn("A live handoff's news didn't read:", news.error);
      return;
    }
    if (event.kind !== "message") return;
    const parsed = handoffMessageSchema.safeParse(event.message);
    if (!parsed.success)
      return console.warn(
        "A live handoff's message didn't read:",
        parsed.error,
      );
    const prior = this.mirrors.get(chat.id) ?? Promise.resolve();
    const copying = prior
      .then(async () => {
        const live = parsed.data as ChatMessage;
        // A paste that won't copy leaves the message naming it as it was; the message itself is kept.
        const [message] = await this.computers
          .connected(computerId)
          .then((client) => this.receivePastes(computerId, client, [live]))
          .catch((e) => {
            console.warn("A live handoff's paste wasn't copied:", e);
            return [live];
          });
        await this.chats.mirrorHandoff(chat.id, handoffId, message!);
      })
      .catch((e) => console.warn("A live handoff's message wasn't kept:", e))
      .finally(() => {
        if (this.mirrors.get(chat.id) === copying) this.mirrors.delete(chat.id);
      });
    this.mirrors.set(chat.id, copying);
  }
  private summary(chatId: string): ChatSummary {
    const chat = this.store.get().chats?.find((c) => c.id === chatId);
    if (!chat) throw new Error("Chat not found.");
    return chat;
  }
  /** The paired computers, and whether each has this thread's repository. */
  targets(chatId: string): Promise<HandoffTarget[]> {
    return this.targetsIn(this.summary(chatId).projectId, handoffBridge);
  }
  /** The paired computers a new thread in the project can start on. */
  startTargets(projectId: string): Promise<HandoffTarget[]> {
    return this.targetsIn(projectId, startHandoffBridge);
  }
  /**
   * One paired computer, and its copy of the project; for no project, only
   * whether it's reachable. Either way it must speak `bridge`.
   */
  async targetOn(
    computerId: string,
    projectId: string | null,
    bridge: number,
  ): Promise<HandoffTarget> {
    const computer = this.computers.list().find((c) => c.id === computerId);
    if (!computer) throw new Error("This computer is no longer paired.");
    return this.targetFor(
      computer,
      projectId
        ? { id: projectId, repositories: await this.repositoriesOf(projectId) }
        : null,
      bridge,
    );
  }
  private async targetsIn(
    projectId: string,
    bridge: number,
  ): Promise<HandoffTarget[]> {
    const project = {
      id: projectId,
      repositories: await this.repositoriesOf(projectId),
    };
    return Promise.all(
      this.computers.list().map((c) => this.targetFor(c, project, bridge)),
    );
  }
  private repositoriesOf(projectId: string) {
    return this.projects
      .root(projectId)
      .then(repositoryNames)
      .catch((): string[] => []);
  }
  private async targetFor(
    c: ReturnType<Computers["list"]>[number],
    project: { id: string; repositories: string[] } | null,
    bridge: number,
  ): Promise<HandoffTarget> {
    const repositories = project?.repositories ?? null;
    const base = { id: c.id, name: c.name };
    if (c.status !== "online")
      return {
        ...base,
        online: false,
        problem: c.status === "denied" ? "Pair again" : "Offline",
      };
    if (repositories && !repositories.length)
      return { ...base, online: true, problem: "No Git remote to match" };
    try {
      const client = await this.computers.connected(c.id);
      const info = await this.info(c.id, client);
      if (outdated(info) || (info?.bridge ?? 0) < bridge)
        return { ...base, online: true, problem: "Needs a Relay update" };
      if (!repositories) return { ...base, online: true };
      const projects = await client.call("computerProjects");
      const match = projects.find((p) =>
        p.repositories.some((r) => repositories.includes(r)),
      );
      if (match)
        return {
          ...base,
          online: true,
          project: { id: match.id, name: match.name },
        };
      return {
        ...base,
        online: true,
        problem: `Not cloned on ${c.name}`,
        ...((info?.bridge ?? 0) >= cloneBridge
          ? { clone: repositories[0] }
          : {}),
      };
    } catch (e) {
      return { ...base, online: false, problem: message(e) };
    }
  }
  /**
   * Clones the project on a paired computer that lacks it, or joins the
   * clone under way; a failed one starts over. The computer clones it into
   * the folder its clones go to and adds it as a project.
   */
  private cloneOn(computerId: string, projectId: string) {
    const key = `${computerId}/${projectId}`;
    const running = this.clones.get(key);
    if (running && !running.error) return running.job;
    const clone = {
      step: "Starting",
      progress: null as number | null,
      error: undefined as string | undefined,
      job: Promise.resolve<ComputerProject>({
        id: "",
        name: "",
        repositories: [],
      }),
    };
    clone.job = this.clone(computerId, projectId, (step, progress) => {
      clone.step = step;
      clone.progress = progress;
    }).then(
      (made) => {
        this.clones.delete(key);
        return made;
      },
      (e: unknown) => {
        clone.error = message(e);
        throw e;
      },
    );
    this.clones.set(key, clone);
    return clone.job;
  }
  private async clone(
    computerId: string,
    projectId: string,
    onStep: (step: string, progress: number | null) => void,
  ) {
    const name = this.nameOf(computerId);
    const url = await cloneUrl(await this.projects.root(projectId));
    if (!url)
      throw new Error(
        `This project has no Git remote ${name} could clone it from.`,
      );
    for (;;) {
      const client = await this.computers.connected(computerId);
      const answer = await client.call("cloneProject", url).catch((e) => {
        throw unsupportedCall(e)
          ? new Error(`${name} needs a Relay update to clone projects.`)
          : e;
      });
      if (answer.done) return answer.project;
      onStep(answer.step, answer.progress);
    }
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
  /** A send as a computer this old takes it: one before `skillsBridge` refuses its pills' skills. */
  private async sendFor(
    computerId: string,
    client: RemoteClient,
    send: ProjectChatSend,
  ) {
    const [carried] = await sendPastes(
      [send],
      client,
      async () =>
        ((await this.info(computerId, client))?.bridge ?? 0) >= pastesBridge,
    );
    if (!send.skills) return carried!;
    const info = await this.info(computerId, client).catch(() => null);
    if ((info?.bridge ?? 0) >= skillsBridge) return carried!;
    const { skills: _, ...older } = carried!;
    return older;
  }
  private async receivePastes(
    computerId: string,
    client: RemoteClient,
    messages: ChatMessage[],
  ) {
    const info = await this.info(computerId, client);
    return receivePastes(messages, client, (info?.bridge ?? 0) >= pastesBridge);
  }
  private async info(computerId: string, client: RemoteClient, fresh = false) {
    const cached = this.infos.get(computerId);
    if (!fresh && cached && Date.now() - cached.at < this.reuse.infoMs)
      return cached.info;
    const info = await client.call("computerInfo").catch((e) => {
      if (message(e) === unknownCall) return null;
      throw e;
    });
    this.infos.set(computerId, { at: Date.now(), info });
    return info;
  }
  async handOff(chatId: string, computerId: string) {
    // A thread that just came back is here already while its job still tells
    // the other computer so.
    if (this.jobs.has(chatId) && !this.summary(chatId).sentTo)
      await this.jobs.get(chatId);
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
    if (sentTo.setup && sentTo.state === "sending")
      return this.startHere(chatId);
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
    if (sentTo.setup)
      await this.dropSetup(chatId, sentTo.computerId, sentTo.setup);
    if (!(await this.chats.abandonHandoff(chatId, sentTo.id))) return;
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: taken back without it.`,
    );
    this.statuses.delete(sentTo.id);
    await this.saveAbandoned(sentTo.computerId, sentTo.id);
    void this.notifyAbandoned(sentTo.computerId);
  }
  async view(chatId: string): Promise<HandoffView | null> {
    const { sentTo, projectId } = this.summary(chatId);
    if (!sentTo) return null;
    const online = this.computers.status(sentTo.computerId) === "online";
    const remote =
      online && sentTo.state !== "sending"
        ? await this.remote(sentTo).catch(() => undefined)
        : this.statuses.get(sentTo.id)?.status;
    const clone =
      sentTo.state === "sending"
        ? this.clones.get(`${sentTo.computerId}/${projectId}`)
        : undefined;
    return {
      sentTo,
      online,
      ...(remote ? { remote } : {}),
      ...(clone && !clone.error
        ? { cloning: { step: clone.step, progress: clone.progress } }
        : {}),
    };
  }
  /** The other computer's view of the thread, asked at most every few seconds. */
  private async remote(
    sentTo: NonNullable<ChatSummary["sentTo"]>,
    fresh = false,
  ) {
    const cached = this.statuses.get(sentTo.id);
    if (!fresh && cached && Date.now() - cached.at < this.reuse.statusMs)
      return cached.status;
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
    await this.computers.setPending(computerId, "abandoned", (known) => [
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
      const client = await this.computers.connected(computerId);
      const info = await this.info(computerId, client, true);
      if (outdated(info))
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      const repositories = await repositoryNames(
        await this.projects.root(this.summary(chatId).projectId),
      );
      if (!repositories.length)
        throw new Error(
          `This project has no Git remote, so ${name} can't find its copy.`,
        );
      // Until the project is there, the thread stays as it is here, its
      // agent stopped: what the user says now goes to the setup's agent.
      await this.chats.haltForHandoff(chatId);
      if (!this.onHandoff(chatId, id)) return;
      const ready = await this.readied(
        chatId,
        id,
        computerId,
        client,
        info!.bridge,
        repositories,
      );
      if (!ready) return;
      if (!this.onHandoff(chatId, id)) return;
      const { chat, root, tip } = await this.chats.leave(chatId, name);
      if (!this.onHandoff(chatId, id)) return;
      const worktree = chat.worktree!;
      const input = chat.lastInput;
      if (!input)
        throw new Error("Send a message before handing the thread off.");
      // Nothing answered it here: its first message starts it there.
      const start =
        !chat.messages.some((m) => m.role === "assistant") &&
        info!.bridge >= startHandoffBridge;
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
        messages: await sendPastes(
          portableMessages(chat.messages),
          client,
          info!.bridge >= pastesBridge,
        ),
        git: {
          branch: worktree.branch!,
          tip,
          bundle: false,
          ...(worktree.from ? { from: worktree.from } : {}),
          ...(worktree.start ? { start: worktree.start } : {}),
        },
        ...(start ? { start: true as const } : {}),
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
              // A start's first message comes back from there as its own.
              kept: start ? 0 : chat.messages.length,
              ...(start ? { start: true as const } : {}),
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
  /**
   * Whether the thread's project is on the computer: there already, cloned
   * now, or set up since by the agent there. When the clone fails, an agent
   * there sets it up while the thread waits, talking to it, until a later
   * look finds the project there. One too old to clone says what's missing
   * as the thread arrives.
   */
  private async readied(
    chatId: string,
    id: string,
    computerId: string,
    client: RemoteClient,
    bridge: number,
    repositories: string[],
  ) {
    const { projectId, sentTo } = this.summary(chatId);
    if (sentTo?.setup) {
      const answer = await client.call(
        "setupProgress",
        sentTo.setup,
        repositories,
      );
      if (!answer.done) return false;
      await this.setupDone(chatId, id, sentTo.setup, answer.project);
      return true;
    }
    const projects = await client.call("computerProjects");
    if (
      projects.some((p) => p.repositories.some((r) => repositories.includes(r)))
    )
      return true;
    if (bridge < cloneBridge) return true;
    const name = this.nameOf(computerId);
    await this.chats.beginSetup(chatId, name, this.projects.get(projectId).name);
    try {
      return await this.setUp(
        chatId,
        id,
        computerId,
        client,
        bridge,
        repositories,
      );
    } catch (e) {
      // A setup that never got its agent ends here, not left cloning.
      if (!this.summary(chatId).sentTo?.setup)
        await this.chats.updateSetup(chatId, {
          state: "dropped",
          ended: Date.now(),
          error: message(e),
        });
      throw e;
    }
  }
  /** Clones the project there, or failing that, starts or joins the agent setting it up. */
  private async setUp(
    chatId: string,
    id: string,
    computerId: string,
    client: RemoteClient,
    bridge: number,
    repositories: string[],
  ) {
    const { projectId } = this.summary(chatId);
    const name = this.nameOf(computerId);
    const under = this.setupOf(computerId, projectId, chatId);
    if (under) {
      await this.joinSetup(chatId, id, computerId, under);
      return false;
    }
    let failed: string;
    try {
      const made = await this.cloneOn(computerId, projectId);
      await this.chats.updateSetup(chatId, {
        state: "done",
        ended: Date.now(),
        project: made.name,
        ...(made.folder ? { folder: made.folder } : {}),
      });
      return true;
    } catch (e) {
      failed = message(e);
    }
    const url = await cloneUrl(await this.projects.root(projectId));
    const input = (await this.chats.get(chatId)).lastInput;
    if (!url || !input) throw new Error(failed);
    if (bridge < setupBridge)
      throw new Error(
        `${failed} ${name} runs an older Relay, which can't set the project up itself: update it from Settings → Computers, or clone the project there, then try again.`,
      );
    // Another thread's clone failing alongside this one starts the one setup.
    const key = `${computerId}/${projectId}`;
    let starting = this.startingSetups.get(key);
    if (!starting) {
      const setup = randomUUID();
      starting = client
        .call("setupProject", setup, {
          url,
          repositories,
          error: failed,
          settings: {
            provider: sentAgent(input),
            choice: input.choice,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            ...(input.contextWindow
              ? { contextWindow: input.contextWindow }
              : {}),
          },
        })
        .then(() => setup)
        .finally(() => this.startingSetups.delete(key));
      this.startingSetups.set(key, starting);
      console.info(
        `Handoff ${named(id, name)}: its clone failed, an agent there sets it up.`,
      );
    }
    await this.joinSetup(chatId, id, computerId, await starting, failed);
    return false;
  }
  /** The setup under way on the computer for the project, for another thread waiting on it. */
  private setupOf(computerId: string, projectId: string, besides: string) {
    const chat = this.setupsOn(computerId).find(
      (c) => c.projectId === projectId && c.id !== besides,
    );
    return chat?.sentTo!.setup;
  }
  /** The thread waits on the setup, talking to its agent and following it. */
  private async joinSetup(
    chatId: string,
    id: string,
    computerId: string,
    setup: string,
    error?: string,
  ) {
    await this.chats.updateSetup(chatId, {
      state: "agent",
      ...(error ? { error } : {}),
    });
    await this.chats.updateSentTo(chatId, id, { setup });
    void this.followSetups(computerId, chatId);
  }
  /** The setup's agent got the project there: the thread goes on, and its thread there settles. */
  private async setupDone(
    chatId: string,
    id: string,
    setup: string,
    project: ComputerProject,
  ) {
    const { computerId } = this.summary(chatId).sentTo!;
    await this.chats.updateSetup(chatId, {
      state: "done",
      ended: Date.now(),
      project: project.name,
      ...(project.folder ? { folder: project.folder } : {}),
    });
    await this.chats.updateSentTo(chatId, id, { setup: undefined });
    this.chats.setHandoffLive(chatId, undefined);
    for (const c of this.setupsOn(computerId))
      if (c.sentTo!.setup === setup) this.checkSetup(c.id);
    void this.computers
      .connected(computerId)
      .then((client) => client.call("handedBack", setup))
      .catch((e) => console.warn("A finished setup wasn't settled there:", e));
  }
  /**
   * The folder on the computer a waiting thread's setup is for that holds
   * the project's clone: added there, and the handoff goes on. False when
   * it holds no clone of it.
   */
  async setupFolder(chatId: string, folder: string) {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo?.setup || sentTo.state !== "sending")
      throw new Error("This thread isn't waiting on a setup.");
    const client = await this.computers.connected(sentTo.computerId);
    const repositories = await repositoryNames(
      await this.projects.root(this.summary(chatId).projectId),
    );
    const answer = await client.call(
      "setupProgress",
      sentTo.setup,
      repositories,
      folder,
    );
    if (!answer.done) return false;
    if (sentTo.error)
      await this.chats.updateSentTo(chatId, sentTo.id, { error: undefined });
    this.checkSetup(chatId);
    return true;
  }
  /**
   * Gives up on the computer whose setup the thread waits for: the agent
   * there is told, and the thread stays here, its first message answered
   * here when nothing answered it yet.
   */
  async startHere(chatId: string) {
    await this.jobs.get(chatId);
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo?.setup || sentTo.state !== "sending")
      throw new Error(
        sentTo
          ? `It's on ${sentTo.computer} now. Bring it back instead.`
          : "This thread is here already.",
      );
    await this.dropSetup(chatId, sentTo.computerId, sentTo.setup);
    await this.chats.updateSentTo(chatId, sentTo.id, null);
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: stays here instead of its setup there.`,
    );
    await this.chats.answerHere(chatId);
  }
  /** The setup's agent there is let go, even across a restart. */
  private async dropSetup(chatId: string, computerId: string, setup: string) {
    await this.chats.updateSetup(chatId, {
      state: "dropped",
      ended: Date.now(),
    });
    this.chats.setHandoffLive(chatId, undefined);
    const shared = this.setupsOn(computerId).some(
      (c) => c.id !== chatId && c.sentTo!.setup === setup,
    );
    if (shared) return;
    await this.saveAbandoned(computerId, setup);
    void this.notifyAbandoned(computerId);
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
      const messages = await this.receivePastes(
        computerId,
        client,
        readReturned(
          await readFile(json, "utf8"),
          this.computers.get(computerId).name,
        ),
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
      // Another takeback can save a notice while this one's call is pending.
      // Remove only this run's delivered ids from the latest saved list.
      const delivered = new Set(ids.filter((each) => !left.includes(each)));
      await this.computers.setPending(computerId, kind, (pending) =>
        [...new Set([...pending, ...left])].filter(
          (each) => !delivered.has(each),
        ),
      );
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
