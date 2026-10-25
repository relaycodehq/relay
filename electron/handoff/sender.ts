import { randomUUID } from "node:crypto";
import {
  handoffBlocked,
  type HandoffHereOnlyMethod,
  type HandoffMethod,
  type HandoffRemoteStatus,
  type HandoffTarget,
  type HandoffView,
} from "../../shared/handoff";
import { onComputerMessage } from "../../shared/projects";
import type { Store } from "../app/store";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import { listed, liveOn, named, setupsOn, stays, summaryOf } from "./away";
import { ComputerInfos } from "./computer-infos";
import type { Computers } from "./computers";
import { HandoffFollowing } from "./following";
import { HandoffForwarding } from "./forwarding";
import { HandoffNotices } from "./notices";
import { RemoteStatuses } from "./remote-statuses";
import { HandoffSetups } from "./setups";
import { HandoffTargets, sharing } from "./targets";
import { HandoffTrips } from "./trips";

/**
 * Handing this computer's threads to the paired ones and bringing them back.
 * Each step leaves the thread's `sentTo` saying where it stands, with the
 * error when one failed, so a retry picks up with the same handoff id.
 *
 * The work is done by its parts: the trips there and back, the project's
 * setup there, following what the other computer writes, forwarding what's
 * asked here, its statuses and the notices it's owed.
 */
export class Handoffs {
  /** The handoff or bringing back under way for each thread. */
  private jobs = new Map<string, Promise<void>>();
  private infos: ComputerInfos;
  private places: HandoffTargets;
  private statuses: RemoteStatuses;
  private notices: HandoffNotices;
  private forwarding: HandoffForwarding;
  private following: HandoffFollowing;
  private setups: HandoffSetups;
  private trips: HandoffTrips;

  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private projects: Projects,
    /** Scratch space for bundles on their way, a folder per handoff. */
    dir: string,
    /** How long the other computer's answers are reused; tests ask every time. */
    reuse = { statusMs: 4000, infoMs: 3000 },
  ) {
    this.infos = new ComputerInfos(computers, reuse.infoMs);
    this.places = new HandoffTargets(store, computers, projects, this.infos);
    this.statuses = new RemoteStatuses(
      store,
      computers,
      projects,
      this.infos,
      reuse.statusMs,
    );
    this.notices = new HandoffNotices(computers);
    this.forwarding = new HandoffForwarding(
      store,
      computers,
      chats,
      this.infos,
      this.statuses,
      this.notices,
    );
    this.following = new HandoffFollowing(
      store,
      computers,
      chats,
      this.infos,
      (chatId) => void this.forwarding.flush(chatId),
      (chatId) => this.checkSetup(chatId),
    );
    this.setups = new HandoffSetups(
      store,
      computers,
      chats,
      projects,
      this.places,
      this.notices,
      this.following,
      (chatId) => this.checkSetup(chatId),
    );
    this.trips = new HandoffTrips(
      store,
      computers,
      chats,
      projects,
      this.infos,
      dir,
      this.setups,
      this.following,
      this.statuses,
      this.notices,
    );
    computers.onOnline((id) => {
      void this.notices.acknowledge(id);
      void this.notices.notifyAbandoned(id);
      void this.following.follow(id);
      void this.following.followSetups(id);
    });
    computers.onOffline((id) => {
      for (const c of [...liveOn(store, id), ...setupsOn(store, id)])
        this.chats.liveHandoff.setLive(c.id, undefined);
    });
    computers.onEvent((id, event) => this.following.event(id, event));
    // A thread of a project on another computer goes there with its first send.
    chats.startsThereWith((chatId, computerId) =>
      this.handOff(chatId, computerId),
    );
  }

  /** See HandoffForwarding. */
  forwards(
    method: string,
    args: unknown[],
  ): method is HandoffMethod | HandoffHereOnlyMethod {
    return this.forwarding.forwards(method, args);
  }

  forward(
    method: HandoffMethod | HandoffHereOnlyMethod,
    args: unknown[],
    here?: () => unknown,
  ) {
    return this.forwarding.forward(method, args, here);
  }

  runHere(chatId: string) {
    return this.forwarding.runHere(chatId);
  }

  dropHeld(chatId: string, sendId: string) {
    return this.forwarding.dropHeld(chatId, sendId);
  }

  /** The paired computers, and whether each has this thread's repository. */
  targets(chatId: string): Promise<HandoffTarget[]> {
    return this.places.forThread(summaryOf(this.store, chatId));
  }

  /** The paired computers a new thread in the project can start on. */
  startTargets(projectId: string): Promise<HandoffTarget[]> {
    return this.places.forStart(projectId);
  }

  /** One paired computer, and its copy of the project; see HandoffTargets. */
  targetOn(computerId: string, projectId: string | null, bridge: number) {
    return this.places.on(computerId, projectId, bridge);
  }

  views() {
    return this.statuses.views();
  }

  overview() {
    return this.statuses.overview();
  }

  /** Has the computer update Relay; it restarts, and its link comes back by itself. */
  update(computerId: string) {
    return this.infos.update(computerId);
  }

  async handOff(chatId: string, computerId: string) {
    // A thread that just came back is here already while its job still tells
    // the other computer so; the list may still say it's on its way back.
    const was = summaryOf(this.store, chatId).sentTo;
    if (this.jobs.has(chatId) && (!was || was.state === "returning"))
      await this.jobs.get(chatId);
    if (this.jobs.has(chatId))
      throw new Error("This thread is already on its way.");
    const chat = summaryOf(this.store, chatId);
    if (chat.sentTo)
      throw new Error(`This thread is on ${chat.sentTo.computer} already.`);
    // A thread of a project on another computer starts there, in its folder.
    const home = this.projects.get(chat.projectId).computer;
    if (home && home.id !== computerId)
      throw new Error(onComputerMessage(this.projects.get(chat.projectId)));
    const blocked = home ? undefined : handoffBlocked(chat);
    if (blocked) throw new Error(blocked);
    const others = sharing(this.store, chat);
    if (others)
      throw new Error(
        `${others} works in this worktree too; a shared worktree stays on this computer.`,
      );
    const computer = this.computers.get(computerId);
    const id = randomUUID();
    await this.chats.handoffs.mark(chatId, {
      id,
      computerId,
      computer: computer.name,
      at: Date.now(),
      ...(home ? { home: true as const } : {}),
    });
    const done = this.run(chatId, () =>
      this.trips.send(chatId, id, computerId),
    );
    // A refused start reaches whoever sent its first message.
    if (home) await done;
  }

  /** Once the handoff or bringing back under way for the thread is over, however it went. */
  async finished(chatId: string) {
    await this.jobs.get(chatId);
  }

  /** Sends a handoff that failed on its way again, with the same id. */
  async retry(chatId: string) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (sentTo?.state !== "sending" || this.jobs.has(chatId)) return;
    await this.chats.handoffs.updateSentTo(chatId, sentTo.id, {
      error: undefined,
    });
    // Back in its setup, it catches up on what the agent wrote meanwhile.
    if (sentTo.setup)
      return this.following.followSetups(sentTo.computerId, chatId);
    const done = this.run(chatId, () =>
      this.trips.send(chatId, sentTo.id, sentTo.computerId),
    );
    if (sentTo.home) await done;
  }

  /**
   * Brings the thread back, or tries again after the last attempt failed.
   * `park` brings it back even when its work clashes with the worktree,
   * leaving the work at its handoff ref for the thread to replay.
   */
  async bringBack(chatId: string, park = false) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo) throw new Error("This thread is already here.");
    if (sentTo.home) throw new Error(stays(sentTo.computer));
    if (sentTo.state === "sending")
      throw new Error(
        "The handoff hasn't finished. Try it again, or keep the thread here.",
      );
    if (this.jobs.has(chatId)) return;
    await this.chats.handoffs.updateSentTo(chatId, sentTo.id, {
      state: "returning",
      error: undefined,
      conflicts: undefined,
    });
    this.run(chatId, () =>
      this.trips.back(chatId, sentTo.id, sentTo.computerId, park),
    );
  }

  /**
   * Gives up on a handoff that never arrived, keeping the thread here. Only
   * the other computer saying it has no such thread proves that; unreachable,
   * it may have taken the thread with the answer lost on the way.
   */
  async keepHere(chatId: string) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo) return;
    if (sentTo.home) throw new Error(stays(sentTo.computer));
    if (sentTo.setup && sentTo.state === "sending")
      return this.startHere(chatId);
    if (sentTo.state !== "sending" || this.jobs.has(chatId))
      throw new Error(
        `${sentTo.computer} has this thread. Bring it back instead.`,
      );
    let status: HandoffRemoteStatus | null;
    try {
      status = await this.statuses.remote(sentTo, true);
    } catch {
      throw new Error(
        `Can't tell whether ${sentTo.computer} got this thread, because it can't be reached. Try again once it's back, or take the thread back without ${sentTo.computer}.`,
      );
    }
    if (status) {
      await this.chats.handoffs.updateSentTo(chatId, sentTo.id, {
        state: "away",
        error: undefined,
      });
      throw new Error(
        `${sentTo.computer} got this thread after all. Bring it back instead, or take the thread back without ${sentTo.computer}.`,
      );
    }
    await this.chats.handoffs.updateSentTo(chatId, sentTo.id, null);
  }

  /**
   * Takes the thread back without the computer that has it, for when that
   * one can't give it back. The thread unlocks here as it left; whatever was
   * done there stays there.
   */
  async abandon(chatId: string) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo) return;
    if (sentTo.home) throw new Error(stays(sentTo.computer));
    if (sentTo.state === "returning" && this.jobs.has(chatId))
      throw new Error(
        `It's being brought back from ${sentTo.computer} right now. If that fails, you can take it back without ${sentTo.computer}.`,
      );
    if (sentTo.setup)
      await this.setups.drop(chatId, sentTo.computerId, sentTo.setup);
    // Taken back mid-clone: the clone's job lets go of any setup it starts.
    else if (sentTo.state === "sending") await this.setups.dropMirror(chatId);
    if (!(await this.chats.handoffs.abandon(chatId, sentTo.id))) return;
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: taken back without it.`,
    );
    this.statuses.forget(sentTo.id);
    await this.notices.abandoned(sentTo.computerId, sentTo.id);
  }

  async view(chatId: string): Promise<HandoffView | null> {
    const { sentTo, projectId } = summaryOf(this.store, chatId);
    if (!sentTo) return null;
    const online = this.computers.status(sentTo.computerId) === "online";
    const remote =
      online && sentTo.state !== "sending"
        ? await this.statuses.remote(sentTo).catch(() => undefined)
        : this.statuses.known(sentTo.id);
    const cloning =
      sentTo.state === "sending"
        ? this.places.cloning(sentTo.computerId, projectId)
        : undefined;
    return {
      sentTo,
      online,
      ...(remote ? { remote } : {}),
      ...(cloning ? { cloning } : {}),
    };
  }

  /** See HandoffSetups.folder. */
  setupFolder(chatId: string, folder: string) {
    return this.setups.folder(chatId, folder);
  }

  /**
   * Gives up on the computer whose setup the thread waits for: the agent
   * there is told, and the thread stays here, its first message answered
   * here when nothing answered it yet.
   */
  async startHere(chatId: string) {
    await this.jobs.get(chatId);
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo?.setup || sentTo.state !== "sending")
      throw new Error(
        sentTo
          ? `It's on ${sentTo.computer} now. Bring it back instead.`
          : "This thread is here already.",
      );
    await this.setups.drop(chatId, sentTo.computerId, sentTo.setup);
    await this.chats.handoffs.updateSentTo(chatId, sentTo.id, null);
    console.info(
      `Handoff ${named(sentTo.id, sentTo.computer)}: stays here instead of its setup there.`,
    );
    await this.chats.answerHere(chatId);
  }

  /** Looks again whether the setup the thread waits on is done, and hands it off when it is. */
  private checkSetup(chatId: string) {
    const sentTo = listed(this.store, chatId)?.sentTo;
    if (!sentTo?.setup || sentTo.error || this.jobs.has(chatId)) return;
    this.run(chatId, () =>
      this.trips.send(chatId, sentTo.id, sentTo.computerId),
    );
  }

  /** Runs the thread's handoff job; the promise it returns fails with the job. */
  private run(chatId: string, job: () => Promise<void>) {
    const done = job();
    const running = done
      .catch((e) => console.warn("Handoff:", e))
      .finally(() => this.jobs.delete(chatId));
    this.jobs.set(chatId, running);
    return done;
  }
}
