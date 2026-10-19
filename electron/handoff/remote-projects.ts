// Projects whose folder is on a paired computer (`Project.computer`): adding
// one from that computer's folders, and the calls about the project itself,
// rather than one of its threads, that run there. Its threads go there as
// live handoffs do; see Handoffs.sendHome.
import {
  handoffHereOnlyMethods,
  remoteProjectMethods,
  type RemoteProjectMethod,
} from "../../shared/handoff";
import type { AgentProvider } from "../../shared/agents";
import { onComputerMessage, type Project } from "../../shared/projects";
import type { ComputerFolders } from "../../shared/remote";
import type { Api } from "../../shared/types";
import type { Projects } from "../projects/projects";
import type { Computers } from "./computers";

const projectMethods = new Set<string>(remoteProjectMethods);
const hereOnlyMethods = new Set<string>(handoffHereOnlyMethods);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What a Relay from before `remoteProjectsBridge` answers a call it doesn't know. */
const unknownCall = (e: unknown) =>
  message(e) === "Phones can't do that." ||
  message(e) === "Computers can't do that.";

export class RemoteProjects {
  constructor(
    private computers: Computers,
    private projects: Projects,
  ) {}
  /** The folders in `dir` on the computer, `~` its home folder. */
  folders(computerId: string, dir: string): Promise<ComputerFolders> {
    return this.call(computerId, (client) =>
      client.call("computerFolders", dir),
    );
  }
  /** Adds the folder on the computer as a project there, and here as one that lives there. */
  async add(computerId: string, path: string) {
    const { id, name } = this.computers.get(computerId);
    const remote = await this.call(computerId, (client) =>
      client.call("computerAddProject", path),
    );
    return this.projects.addRemote(
      { id, name },
      {
        id: remote.id,
        name: remote.name,
        path: remote.folder ?? path,
        plain: remote.plain,
      },
    );
  }
  /** An agent's models as the computer's own copy of it lists them. */
  agentModels(computerId: string, provider: AgentProvider) {
    return this.call(
      computerId,
      (client) =>
        client.call("computerCall", "agentModels", [provider]) as Promise<
          Awaited<ReturnType<Api["agentModels"]>>
        >,
    );
  }
  /** Whether the call is about a project on another computer, by its id. */
  forwards(method: string, args: unknown[]) {
    if (
      !projectMethods.has(method) &&
      !hereOnlyMethods.has(method) &&
      method !== "watchWorkingTree"
    )
      return false;
    return !!this.projectIn(args[0]);
  }
  /**
   * Runs the call on the project there. One that opens its folder here is
   * refused; watching it here stops watching whatever was shown before
   * (`unwatch`), as the folder there isn't watched from here yet.
   */
  async forward(method: string, args: unknown[], unwatch: () => unknown) {
    const project = this.projectIn(args[0]);
    if (!project?.computer)
      throw new Error("This project is on this computer.");
    if (method === "watchWorkingTree") return unwatch();
    if (hereOnlyMethods.has(method))
      throw new Error(onComputerMessage(project));
    const { id, projectId } = project.computer;
    return this.call(id, (client) =>
      client.call(
        "projectCall",
        projectId,
        method as RemoteProjectMethod,
        args,
      ),
    );
  }
  /** The project a project id or its checkout's workspace id names, when it lives elsewhere. */
  private projectIn(first: unknown): Project | undefined {
    // A thread's workspace id goes with the thread, as a live handoff's.
    if (typeof first !== "string" || first.includes("/")) return undefined;
    try {
      const project = this.projects.get(first);
      return project.computer ? project : undefined;
    } catch {
      return undefined;
    }
  }
  private async call<T>(
    computerId: string,
    run: (client: Awaited<ReturnType<Computers["connected"]>>) => Promise<T>,
  ): Promise<T> {
    const { name } = this.computers.get(computerId);
    if (this.computers.status(computerId) !== "online")
      throw new Error(`${name} is offline.`);
    const client = await this.computers.connected(computerId);
    try {
      return await run(client);
    } catch (e) {
      if (unknownCall(e))
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      throw e;
    }
  }
}
