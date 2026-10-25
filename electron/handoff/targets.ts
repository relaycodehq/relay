import {
  sharedWith,
  threadsSharing,
  type ChatSummary,
} from "../../shared/projects";
import type { HandoffTarget } from "../../shared/handoff";
import {
  cloneBridge,
  liveHandoffBridge,
  startHandoffBridge,
  type ComputerProject,
} from "../../shared/remote";
import { errorMessage } from "../../shared/error-message";
import type { Store } from "../app/store";
import { repositoryNames } from "../git/bundles";
import type { Projects } from "../projects/projects";
import {
  outdated,
  unsupportedCall,
  type ComputerInfos,
} from "./computer-infos";
import type { Computers } from "./computers";
import { cloneUrl } from "./remote-setup";

/** Who else works in the thread's worktree, by title; undefined when nobody does. */
export function sharing(store: Store, chat: ChatSummary) {
  const others = threadsSharing(store.get().chats ?? [], chat);
  return others.length ? sharedWith(others) : undefined;
}

/** A paired computer's name, or what to call one that's gone. */
export function nameOf(computers: Computers, computerId: string) {
  try {
    return computers.get(computerId).name;
  } catch {
    return "a computer no longer paired";
  }
}

/**
 * Where a thread or a project can go: each paired computer, whether it's
 * reachable and new enough, and its copy of the project, cloning one on a
 * computer that lacks it.
 */
export class HandoffTargets {
  /** Clones of this computer's projects on paired ones, by computer and project id; a failed one keeps its error. */
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
    private projects: Projects,
    private infos: ComputerInfos,
  ) {}

  /** The paired computers, and whether each has this thread's repository. */
  async forThread(chat: ChatSummary): Promise<HandoffTarget[]> {
    const targets = await this.inProject(chat.projectId, liveHandoffBridge);
    // A worktree other threads work in stays here, wherever it could go.
    return sharing(this.store, chat)
      ? targets.map((t) => ({ ...t, problem: "Shared with another thread" }))
      : targets;
  }

  /** The paired computers a new thread in the project can start on. */
  forStart(projectId: string): Promise<HandoffTarget[]> {
    return this.inProject(projectId, startHandoffBridge);
  }

  /**
   * One paired computer, and its copy of the project; for no project, only
   * whether it's reachable. Either way it must speak `bridge`.
   */
  async on(
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

  private async inProject(
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
    // A WSL distribution asleep wakes on `connected` below.
    if (c.status !== "online" && !c.asleep)
      return {
        ...base,
        online: false,
        problem:
          c.status === "denied"
            ? "Pair again"
            : c.stopped
              ? "WSL stopped it"
              : "Offline",
      };
    if (repositories && !repositories.length)
      return { ...base, online: true, problem: "No Git remote to match" };
    try {
      const client = await this.computers.connected(c.id);
      const info = await this.infos.get(c.id, client);
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
      return { ...base, online: false, problem: errorMessage(e) };
    }
  }

  /**
   * Clones the project on a paired computer that lacks it, or joins the
   * clone under way; a failed one starts over. The computer clones it into
   * the folder its clones go to and adds it as a project.
   */
  clone(computerId: string, projectId: string) {
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
    clone.job = this.cloneThere(computerId, projectId, (step, progress) => {
      clone.step = step;
      clone.progress = progress;
    }).then(
      (made) => {
        this.clones.delete(key);
        return made;
      },
      (e: unknown) => {
        clone.error = errorMessage(e);
        throw e;
      },
    );
    this.clones.set(key, clone);
    return clone.job;
  }

  /** How far the clone under way has got; undefined when none is, or it failed. */
  cloning(computerId: string, projectId: string) {
    const clone = this.clones.get(`${computerId}/${projectId}`);
    return clone && !clone.error
      ? { step: clone.step, progress: clone.progress }
      : undefined;
  }

  private async cloneThere(
    computerId: string,
    projectId: string,
    onStep: (step: string, progress: number | null) => void,
  ) {
    const name = nameOf(this.computers, computerId);
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
}
