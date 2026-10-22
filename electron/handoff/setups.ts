import { randomUUID } from "node:crypto";
import { errorMessage } from "../../shared/error-message";
import {
  cloneBridge,
  setupBridge,
  type ComputerProject,
} from "../../shared/remote";
import { Unanswered, type RemoteClient } from "../../shared/remote-client";
import type { Store } from "../app/store";
import { repositoryNames } from "../git/bundles";
import type { ProjectChats } from "../project-chats";
import type { Projects } from "../projects/projects";
import { named, onHandoff, setupsOn, summaryOf } from "./away";
import type { Computers } from "./computers";
import type { HandoffFollowing } from "./following";
import type { HandoffNotices } from "./notices";
import { cloneUrl } from "./remote-setup";
import { nameOf, type HandoffTargets } from "./targets";
import { settingsOf } from "./transfer";

/**
 * Gets a thread's project onto the computer it's going to: there already,
 * cloned now, or set up by an agent there while the thread waits, talking
 * to it. Threads of the same project share the one setup.
 */
export class HandoffSetups {
  /**
   * Setups being asked for, by computer and project, so threads failing
   * together share one, with the threads waiting to join it.
   */
  private starting = new Map<
    string,
    { job: Promise<string>; waiting: Set<string> }
  >();

  constructor(
    private store: Store,
    private computers: Computers,
    private chats: ProjectChats,
    private projects: Projects,
    private places: HandoffTargets,
    private notices: HandoffNotices,
    private following: HandoffFollowing,
    /** The setup the thread waits on may be done: look again. */
    private checkSetup: (chatId: string) => void,
  ) {}

  /**
   * Whether the thread's project is on the computer: there already, cloned
   * now, or set up since by the agent there. When the clone fails, an agent
   * there sets it up while the thread waits, talking to it, until a later
   * look finds the project there. One too old to clone says what's missing
   * as the thread arrives.
   */
  async readied(
    chatId: string,
    id: string,
    computerId: string,
    client: RemoteClient,
    bridge: number,
    repositories: string[],
  ) {
    const { projectId, sentTo } = summaryOf(this.store, chatId);
    if (sentTo?.setup) {
      const answer = await client.call(
        "setupProgress",
        sentTo.setup,
        repositories,
      );
      if (!answer.done) return false;
      await this.done(chatId, id, sentTo.setup, answer.project);
      return true;
    }
    const projects = await client.call("computerProjects");
    if (
      projects.some((p) => p.repositories.some((r) => repositories.includes(r)))
    )
      return true;
    if (bridge < cloneBridge) return true;
    await this.chats.setupMirror.begin(
      chatId,
      nameOf(this.computers, computerId),
      this.projects.get(projectId).name,
    );
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
      if (!summaryOf(this.store, chatId).sentTo?.setup)
        await this.dropMirror(chatId, errorMessage(e));
      throw e;
    }
  }

  /**
   * The folder on the computer a waiting thread's setup is for that holds
   * the project's clone: added there, and the handoff goes on. False when
   * it holds no clone of it.
   */
  async folder(chatId: string, folder: string) {
    const sentTo = summaryOf(this.store, chatId).sentTo;
    if (!sentTo?.setup || sentTo.state !== "sending")
      throw new Error("This thread isn't waiting on a setup.");
    const client = await this.computers.connected(sentTo.computerId);
    const repositories = await repositoryNames(
      await this.projects.root(summaryOf(this.store, chatId).projectId),
    );
    const answer = await client.call(
      "setupProgress",
      sentTo.setup,
      repositories,
      folder,
    );
    if (!answer.done) return false;
    if (sentTo.error)
      await this.chats.handoffs.updateSentTo(chatId, sentTo.id, {
        error: undefined,
      });
    this.checkSetup(chatId);
    return true;
  }

  /** The setup's agent there is let go, even across a restart, unless another thread still waits on it. */
  async drop(chatId: string, computerId: string, setup: string) {
    await this.dropMirror(chatId);
    this.chats.liveHandoff.setLive(chatId, undefined);
    const shared = setupsOn(this.store, computerId).some(
      (c) => c.id !== chatId && c.sentTo!.setup === setup,
    );
    if (!shared) await this.notices.abandoned(computerId, setup);
  }

  /** The setup shown in the thread ends without its project. */
  dropMirror(chatId: string, error?: string) {
    return this.chats.setupMirror.update(chatId, {
      state: "dropped",
      ended: Date.now(),
      ...(error ? { error } : {}),
    });
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
    const { projectId } = summaryOf(this.store, chatId);
    const name = nameOf(this.computers, computerId);
    const under = this.setupOf(computerId, projectId, chatId);
    if (under) {
      await this.join(chatId, id, computerId, under);
      return false;
    }
    let failed: string;
    try {
      const made = await this.places.clone(computerId, projectId);
      if (!onHandoff(this.store, chatId, id)) return false;
      await this.chats.setupMirror.update(chatId, {
        state: "done",
        ended: Date.now(),
        project: made.name,
        ...(made.folder ? { folder: made.folder } : {}),
      });
      return true;
    } catch (e) {
      // Lost on the way, it says nothing of what git could do there: the
      // handoff fails, to be tried again, rather than paying an agent.
      if (
        e instanceof Unanswered ||
        this.computers.status(computerId) !== "online"
      )
        throw e;
      failed = errorMessage(e);
    }
    if (!onHandoff(this.store, chatId, id)) return false;
    // Another thread's setup may have started while this clone failed.
    const started = this.setupOf(computerId, projectId, chatId);
    if (started) {
      await this.join(chatId, id, computerId, started, failed);
      return false;
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
    let starting = this.starting.get(key);
    if (!starting) {
      const setup = randomUUID();
      const job = client
        .call("setupProject", setup, {
          url,
          repositories,
          error: failed,
          settings: settingsOf(input),
        })
        .then(() => setup);
      starting = { job, waiting: new Set() };
      this.starting.set(key, starting);
      console.info(
        `Handoff ${named(id, name)}: its clone failed, an agent there sets it up.`,
      );
    }
    // Kept until every thread waiting has joined, so none starts a second one.
    starting.waiting.add(chatId);
    try {
      const setup = await starting.job;
      if (onHandoff(this.store, chatId, id))
        await this.join(chatId, id, computerId, setup, failed);
      // Taken back meanwhile: the agent goes, unless another thread follows it.
      else if (
        starting.waiting.size === 1 &&
        !setupsOn(this.store, computerId).some((c) => c.sentTo!.setup === setup)
      )
        await this.notices.abandoned(computerId, setup);
      return false;
    } finally {
      starting.waiting.delete(chatId);
      if (!starting.waiting.size && this.starting.get(key) === starting)
        this.starting.delete(key);
    }
  }

  /** The setup under way on the computer for the project, for another thread waiting on it. */
  private setupOf(computerId: string, projectId: string, besides: string) {
    const chat = setupsOn(this.store, computerId).find(
      (c) => c.projectId === projectId && c.id !== besides,
    );
    return chat?.sentTo!.setup;
  }

  /** The thread waits on the setup, talking to its agent and following it. */
  private async join(
    chatId: string,
    id: string,
    computerId: string,
    setup: string,
    error?: string,
  ) {
    await this.chats.setupMirror.update(chatId, {
      state: "agent",
      ...(error ? { error } : {}),
    });
    await this.chats.handoffs.updateSentTo(chatId, id, { setup });
    void this.following.followSetups(computerId, chatId);
  }

  /** The setup's agent got the project there: the thread goes on, and its thread there settles. */
  private async done(
    chatId: string,
    id: string,
    setup: string,
    project: ComputerProject,
  ) {
    const { computerId } = summaryOf(this.store, chatId).sentTo!;
    await this.chats.setupMirror.update(chatId, {
      state: "done",
      ended: Date.now(),
      project: project.name,
      ...(project.folder ? { folder: project.folder } : {}),
    });
    await this.chats.handoffs.updateSentTo(chatId, id, { setup: undefined });
    this.chats.liveHandoff.setLive(chatId, undefined);
    for (const c of setupsOn(this.store, computerId))
      if (c.sentTo!.setup === setup) this.checkSetup(c.id);
    void this.computers
      .connected(computerId)
      .then((client) => client.call("handedBack", setup))
      .catch((e) => console.warn("A finished setup wasn't settled there:", e));
  }
}
