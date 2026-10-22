// Projects whose folder is on a paired computer (`Project.computer`): adding
// one from that computer's folders, and the calls about the project itself,
// rather than one of its threads, that run there, its shells among them.
// Its threads go there as live handoffs do; see Handoffs.sendHome.
import {
  handoffHereOnlyMethods,
  remoteProjectMethods,
  type RemoteProjectMethod,
} from "../../shared/handoff";
import type { AgentProvider } from "../../shared/agents";
import { onComputerMessage, type Project } from "../../shared/projects";
import type {
  ComputerCallMethod,
  ComputerFolders,
  TerminalOp,
} from "../../shared/remote";
import { computerAddingMethods, remoteAddingBridge } from "../../shared/remote";
import { draftTerminalKey, terminalSlotKey } from "../../shared/terminals";
import type { Api } from "../../shared/types";
import type { Projects } from "../projects/projects";
import type { Computers } from "./computers";
import { RemoteShells } from "./remote-shells";
import { errorMessage } from "../../shared/error-message";

const projectMethods = new Set<string>(remoteProjectMethods);
const hereOnlyMethods = new Set<string>(handoffHereOnlyMethods);
/** The terminal calls about a shell already open, and what the computer it runs on calls them. */
const shellOps = new Map<string, TerminalOp>([
  ["writeTerminal", "write"],
  ["resizeTerminal", "resize"],
  ["ackTerminal", "ack"],
  ["closeTerminal", "close"],
  ["prefillTerminal", "prefill"],
  ["prefillSignIn", "prefillSignIn"],
]);
/**
 * What the sidebar asks of every project at launch: a WSL distribution asleep
 * isn't woken for it, and gets the last answer, or this.
 */
const whileAsleep = new Map<string, unknown>([["projectIcon", null]]);
const addingMethods = new Set<string>(computerAddingMethods);
type Client = Awaited<ReturnType<Computers["connected"]>>;
/** What a Relay from before `remoteProjectsBridge` answers a call it doesn't know. */
const unknownCall = (e: unknown) =>
  errorMessage(e) === "Phones can't do that." ||
  errorMessage(e) === "Computers can't do that.";

export class RemoteProjects {
  private shells: RemoteShells;
  /** The last answers to `whileAsleep` calls, by method and project. */
  private answered = new Map<string, unknown>();
  /** Connections to a Relay new enough for setup calls; an older one may update, so it's asked again. */
  private canAdd = new WeakSet<Client>();
  constructor(
    private computers: Computers,
    private projects: Projects,
  ) {
    this.shells = new RemoteShells(computers, (id, run) => this.call(id, run));
  }
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
  /** Keep a newly created project here with the identity of its actual computer. */
  adopt(computerId: string, project: Project) {
    const { id, name } = this.computers.get(computerId);
    return this.projects.addRemote({ id, name }, project);
  }
  async clone(computerId: string, url: string, into: string) {
    const answer = await this.call(computerId, async (client) => {
      await this.requireAdding(client);
      return client.call("cloneProject", url, into);
    });
    if (!answer.done) return answer;
    const { id, name } = this.computers.get(computerId);
    return {
      done: true as const,
      project: await this.projects.addRemote(
        { id, name },
        {
          id: answer.project.id,
          name: answer.project.name,
          path: answer.project.folder!,
          plain: answer.project.plain,
        },
      ),
    };
  }
  /** An agent's models as the computer's own copy of it lists them. */
  agentModels(computerId: string, provider: AgentProvider) {
    return this.ask(computerId, "agentModels", provider) as ReturnType<
      Api["agentModels"]
    >;
  }
  /** One of `computerCallMethods`, as the computer answers it for itself. */
  ask<M extends ComputerCallMethod>(
    computerId: string,
    method: M,
    ...args: Parameters<Api[M]>
  ) {
    return this.call(computerId, async (client) => {
      if (addingMethods.has(method)) await this.requireAdding(client);
      return client.call("computerCall", method, args);
    }) as ReturnType<Api[M]>;
  }
  private async requireAdding(client: Client) {
    if (this.canAdd.has(client)) return;
    const info = await client.call("computerInfo");
    if (info.bridge < remoteAddingBridge)
      throw new Error(
        "Update Relay on the other computer in Settings → Computers, then try again.",
      );
    this.canAdd.add(client);
  }
  /** Whether the call is about a project on another computer, by its id. */
  forwards(method: string, args: unknown[]) {
    if (shellOps.has(method)) return this.shells.has(String(args[0]));
    if (
      method !== "openTerminal" &&
      method !== "adoptTerminal" &&
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
    const op = shellOps.get(method);
    if (op) return this.shells.run(op, String(args[0]), args.slice(1));
    const project = this.projectIn(args[0]);
    if (!project?.computer)
      throw new Error("This project is on this computer.");
    if (method === "openTerminal") return this.openShell(project, args);
    if (method === "adoptTerminal")
      return this.shells.adopt(
        project.computer.id,
        draftTerminalKey(project.id),
        String(args[1]),
      );
    if (method === "watchWorkingTree") return unwatch();
    if (hereOnlyMethods.has(method))
      throw new Error(onComputerMessage(project));
    const { id, projectId } = project.computer;
    const kept = whileAsleep.has(method) && `${method}:${project.id}`;
    if (kept && this.computers.asleep(id))
      return this.answered.has(kept)
        ? this.answered.get(kept)
        : whileAsleep.get(method);
    const answer = await this.call(id, (client) =>
      client.call(
        "projectCall",
        projectId,
        method as RemoteProjectMethod,
        args,
      ),
    );
    if (kept) this.answered.set(kept, answer);
    return answer;
  }
  /** Opens the thread's shell in the project's folder there, as `openTerminal` would here. */
  private openShell(project: Project, args: unknown[]) {
    const [, chatId, size, fresh, slot] = args;
    const key = terminalSlotKey(
      typeof chatId === "string" ? chatId : draftTerminalKey(project.id),
      typeof slot === "string" ? slot : "",
    );
    const { id, projectId } = project.computer!;
    return this.shells.open(
      id,
      projectId,
      key,
      size as { cols: number; rows: number },
      fresh === true,
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
    run: (client: Client) => Promise<T>,
  ): Promise<T> {
    const { name } = this.computers.get(computerId);
    // Connecting, as when Relay just started, it waits a little for it.
    const status = this.computers.status(computerId);
    // A WSL distribution WSL stopped: connected() says so, and how to start it.
    const stopped = this.computers
      .list()
      .some((c) => c.id === computerId && c.stopped);
    if (!stopped && (status === "offline" || status === "denied"))
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
