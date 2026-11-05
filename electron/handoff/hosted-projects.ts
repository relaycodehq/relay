// Projects of this computer that another computer shows as its own: their
// folders listed and added, threads started in them, and their calls and
// shells run here for that computer.
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { z } from "zod";
import { remoteProjectMethods } from "../../shared/handoff";
import type { Project } from "../../shared/projects";
import {
  computerCallMethods,
  type ComputerFolders,
  type ComputerMethod,
  type ComputerProject,
  type HomeThread,
  terminalOps,
} from "../../shared/remote";
import {
  terminalSessionPickSchema,
  type TerminalSessionPick,
} from "../../shared/terminal-sessions";
import { idSchema } from "../../shared/validation";
import { repositoryNames } from "../git/bundles";
import { expandHome, listFolders } from "../projects/folder-inspect";
import { ComputerShells } from "./computer-shells";
import { followedBy } from "./live-threads";
import type { ReceiverHost } from "./receiver";
import { folderSchema, homeThreadSchema } from "./schemas";
import { fromHome } from "./setup-agent";

const hostedMethods = new Set<string>([
  "computerFolders",
  "computerAddProject",
  "startInProject",
  "resumeInProject",
  "computerCall",
  "projectCall",
  "projectTerminal",
  "terminalCall",
]);

/** Whether the call is about hosting a project here for another computer. */
export const isHostedMethod = (method: ComputerMethod) =>
  hostedMethods.has(method);

export class HostedProjects {
  /** Threads being started in a project here, by id, so a repeat waits for the first. */
  private starting = new Map<string, Promise<{ chatId: string }>>();
  /** The shells other computers opened in projects here. */
  readonly shells = new ComputerShells();

  constructor(private host: ReceiverHost) {}

  async handle(
    method: ComputerMethod,
    args: unknown[],
    device: { id: string; name: string },
  ): Promise<unknown> {
    switch (method) {
      case "computerFolders":
        return this.folders(folderSchema.parse(args[0]));
      case "computerAddProject": {
        if (!this.host.adding)
          throw new Error("This Relay can't add projects.");
        const path = folderSchema.parse(args[0]);
        return this.describe(await this.host.adding.addAt(path));
      }
      case "startInProject": {
        const id = idSchema.parse(args[0]);
        let job = this.starting.get(id);
        if (!job) {
          job = this.startIn(
            id,
            idSchema.parse(args[1]),
            homeThreadSchema.parse(args[2]) as HomeThread,
            device,
          ).finally(() => this.starting.delete(id));
          this.starting.set(id, job);
        }
        return job;
      }
      case "resumeInProject":
        return this.resume(
          idSchema.parse(args[0]),
          terminalSessionPickSchema.parse(args[1]),
          device.id,
        );
      case "computerCall": {
        const method = z.enum(computerCallMethods).parse(args[0]);
        const rest = z.array(z.unknown()).max(9).parse(args[1]);
        if (!this.host.dispatch) throw new Error("This Relay can't do that.");
        return this.host.dispatch(method, rest);
      }
      case "projectCall": {
        const project = await this.own(idSchema.parse(args[0]));
        const method = z.enum(remoteProjectMethods).parse(args[1]);
        const rest = z.array(z.unknown()).max(9).parse(args[2]).slice(1);
        if (!this.host.dispatch) throw new Error("This Relay can't do that.");
        return this.host.dispatch(method, [project.id, ...rest]);
      }
      case "projectTerminal": {
        const project = await this.own(idSchema.parse(args[0]));
        const cwd = await this.host.root(project.id);
        return this.shells.open(device.id, cwd, args.slice(1));
      }
      case "terminalCall":
        return this.shells.call(
          device.id,
          z.enum(terminalOps).parse(args[0]),
          z.string().parse(args[1]),
          z.array(z.unknown()).max(4).parse(args[2]),
        );
    }
  }

  /** A project of this computer's own, not one another computer hosts or a Scratchpad's. */
  private async own(projectId: string) {
    const project = (await this.host.projects()).find(
      (p) => p.id === projectId && !p.scratch && !p.computer,
    );
    if (!project) throw new Error("This computer has no such project.");
    return project;
  }

  /** The folders in `dir`, the ones that are projects here already marked. */
  private async folders(dir: string): Promise<ComputerFolders> {
    const resolved = await realpath(expandHome(dir));
    const projects = (await this.host.projects()).filter(
      (p) => !p.scratch && !p.computer,
    );
    const folders = await listFolders(resolved);
    return {
      home: homedir(),
      dir: resolved,
      folders: folders.map((f) => {
        const project = projects.find((p) => p.path === f.path);
        return project
          ? { ...f, project: { id: project.id, name: project.name } }
          : f;
      }),
    };
  }

  /**
   * A thread another computer starts in a project of this one that it shows
   * as its own: its first message runs here as the thread's first turn, in
   * the project's checkout, and that computer follows it live by `id`.
   */
  private async startIn(
    id: string,
    projectId: string,
    thread: HomeThread,
    device: { id: string; name: string },
  ) {
    const known = this.host.chats.handoffs.handedOver(id);
    if (known) return { chatId: known.id };
    const project = await this.own(projectId);
    const chat = await this.host.chats.handoffs.adoptHome(project.id, thread, {
      id,
      computer: thread.from,
      deviceId: device.id,
      at: Date.now(),
    });
    console.info(
      `Thread ${id.slice(0, 8)} from ${device.name}: started in ${project.name}.`,
    );
    return { chatId: chat.id };
  }

  /**
   * A session saved in the project's folder here, carried on in its checkout
   * for the computer asking, which follows its thread by the id it lists it by.
   */
  private async resume(
    projectId: string,
    pick: TerminalSessionPick,
    deviceId: string,
  ) {
    const project = await this.own(projectId);
    const { chat, created } = await this.host.chats.continueTerminalSession(
      project.id,
      pick,
      "checkout",
    );
    const chatId = followedBy(chat, deviceId);
    if (!chatId)
      throw new Error(
        "That session goes on in a thread here that can't be opened from another computer.",
      );
    return { chatId, created };
  }

  private async describe(project: Project): Promise<ComputerProject> {
    return {
      id: project.id,
      name: project.name,
      repositories: project.plain
        ? []
        : await this.host
            .root(project.id)
            .then(repositoryNames)
            .catch(() => []),
      folder: fromHome(project.path),
      ...(project.plain ? { plain: true as const } : {}),
    };
  }
}
