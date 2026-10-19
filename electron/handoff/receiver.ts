import {
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  handoffFolderMethods,
  handoffMethods,
  remoteProjectMethods,
  handoffChunk,
  handoffMessagesSchema,
  maxHandoffBundle,
  maxHandoffThread,
  needsFullBundle,
  type HandBack,
  type HandoffRemoteStatus,
  type HandoffThread,
} from "../../shared/handoff";
import {
  chatScopeSchema,
  knownMessagesSchema,
  projectChatSendSchema,
  type ChatMessage,
} from "../../shared/projects";
import {
  computerCallMethods,
  remoteBridgeVersion,
  type ComputerFolders,
  type ComputerMethod,
  type ComputerProject,
  type HomeThread,
  type SetupRequest,
} from "../../shared/remote";
import type { ApiMethod } from "../../shared/types";
import type { NewsItem } from "../../shared/thread-news";
import type { UpdateState } from "../../shared/updates";
import { idSchema } from "../../shared/validation";
import { workspaceId } from "../../shared/workspaces";
import { branchNameProblem } from "../../shared/branch-names";
import { git } from "../git/git";
import type { ProjectChats } from "../project-chats";
import { adoptWorktree, newBranchProblem } from "../git/worktrees";
import {
  bundleBranch,
  fetchBundle,
  fetchRemotes,
  hasCommit,
  repositoryNames,
} from "../git/bundles";
import { LiveFeed, type FeedLink } from "./live-feed";
import { CloneRequests, type CloneHost } from "./remote-setup";
import { SetupAgents } from "./setup-agent";
import { readPaste, writePasteChunk } from "../drafts";
import { expandHome, listFolders } from "../projects/folder-inspect";
import { fromHome } from "./setup-agent";

const folderMethods = new Set<string>(handoffFolderMethods);
const partSchema = z.enum(["thread", "bundle"]);
const base64 = z
  .string()
  .max(Math.ceil(handoffChunk / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
const shaSchema = z.string().regex(/^[0-9a-f]{40,64}$/);
// Any name git takes: a thread's branch may be one the user chose.
const branchSchema = z
  .string()
  .max(250)
  .refine((b) => !branchNameProblem(b));
const repositoriesSchema = z.array(z.string().max(300)).min(1).max(20);
const settingsSchema = projectChatSendSchema.pick({
  provider: true,
  choice: true,
  runtimeMode: true,
  interactionMode: true,
  contextWindow: true,
});
const setupRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(2000),
    repositories: repositoriesSchema,
    error: z.string().max(8000),
    settings: settingsSchema,
  })
  .strict();
const threadSchema = z
  .object({
    from: z.string().trim().min(1).max(80),
    repositories: repositoriesSchema,
    title: z.string().max(200),
    scope: chatScopeSchema,
    settings: settingsSchema,
    messages: handoffMessagesSchema,
    git: z
      .object({
        branch: branchSchema,
        tip: shaSchema,
        bundle: z.boolean(),
        from: branchSchema.optional(),
        start: shaSchema.optional(),
      })
      .strict(),
    start: z.literal(true).optional(),
  })
  .strict();
const homeThreadSchema = threadSchema
  .pick({
    from: true,
    title: true,
    scope: true,
    settings: true,
    messages: true,
  })
  .strict();
const folderSchema = z.string().trim().min(1).max(4096);

export interface ReceiverHost {
  projects(): Promise<import("../../shared/projects").Project[]>;
  root(projectId: string): Promise<string>;
  chats: ProjectChats;
  /** Where threads' worktrees live, as ProjectChats makes them. */
  worktrees: string;
  /** Scratch space for uploads and downloads, a folder per handoff. */
  dir: string;
  /** The managed paste folder; defaults to this process's configured store. */
  pastes?: string;
  /** This Relay's version. */
  version(): string;
  /** Runs an Api call, as the window would; a live handoff's calls go through it. */
  dispatch?(method: ApiMethod, args: unknown[]): Promise<unknown>;
  /** Clones a paired computer asks for, as the add-project palette makes them. */
  adding?: Omit<CloneHost, "repositories"> & {
    addAt(path: string): Promise<import("../../shared/projects").Project>;
  };
  /** Its updater, which a paired computer may set going. */
  updates?: {
    state(): UpdateState;
    check(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<UpdateState>;
  };
}

/**
 * The computer taking threads over: uploads land in a folder per handoff,
 * then the bundle's branch becomes a worktree and the conversation a thread
 * whose agent carries on. Everything here is keyed by the handoff's id, so a
 * sender that lost an answer can simply ask again.
 */
export class HandoffReceiver {
  /** Hand-backs being readied; an update waits for them as for arrivals. */
  private handingBack = new Set<string>();
  private receiving = new Map<
    string,
    Promise<{ chatId: string; project: string }>
  >();
  /** Threads being started in a project here, by id, so a repeat waits for the first. */
  private starting = new Map<string, Promise<{ chatId: string }>>();
  private feed: LiveFeed;
  private clones?: CloneRequests;
  private setups?: SetupAgents;
  constructor(private host: ReceiverHost) {
    this.feed = new LiveFeed(host.chats);
    const { adding, dispatch } = host;
    if (!adding) return;
    this.clones = new CloneRequests({
      defaultFolder: () => adding.defaultFolder(),
      clone: (url, into, onStep) => adding.clone(url, into, onStep),
      repositories: (p) => host.root(p.id).then(repositoryNames),
    });
    if (dispatch)
      this.setups = new SetupAgents({
        handedOver: (id) => host.chats.handedOver(id),
        adoptSetup: (projectId, title, cameFrom, input) =>
          host.chats.adoptSetup(projectId, title, cameFrom, input),
        scratch: () =>
          dispatch("createScratch", []) as Promise<{ id: string }>,
        defaultFolder: () => adding.defaultFolder(),
        addAt: (path) => adding.addAt(path),
        projects: () => this.projects(),
      });
  }
  /** How the computers threads came from are reached; the phone remote's server. */
  connect(link: FeedLink) {
    this.feed.connect(link);
  }
  /** A message written in a thread here. */
  chatEvent(event: { chatId: string; message: ChatMessage }) {
    this.feed.message(event.chatId, event.message);
  }
  /** Something here is news: a finished or failed answer, a thread that needs you. */
  news(item: NewsItem) {
    this.feed.news(item);
  }
  /** A project's threads may read differently. */
  chatsChanged(projectId: string) {
    this.feed.changed(projectId);
  }
  /** A thread is arriving or going back; an update waits for it. */
  get busy() {
    return this.receiving.size > 0 || this.handingBack.size > 0;
  }
  async handle(
    method: ComputerMethod,
    args: unknown[],
    device: { id: string; name: string },
  ): Promise<unknown> {
    switch (method) {
      case "uploadPaste":
        return writePasteChunk(
          idSchema.parse(args[0]),
          z.number().int().min(1).max(999).parse(args[1]),
          z
            .number()
            .int()
            .min(0)
            .max(200 * 1024 * 1024)
            .parse(args[2]),
          Buffer.from(base64.parse(args[3]), "base64"),
          this.host.pastes,
        );
      case "downloadPaste":
        return readPaste(
          z.string().max(32768).parse(args[0]),
          z
            .number()
            .int()
            .min(0)
            .max(200 * 1024 * 1024)
            .parse(args[1]),
          handoffChunk,
          this.host.pastes,
        );
      case "computerProjects":
        return this.projects();
      case "cloneProject": {
        if (!this.clones) throw new Error("This Relay can't clone projects.");
        const url = z.string().trim().min(1).max(2000).parse(args[0]);
        return this.clones.ask(url, device.name);
      }
      case "setupProject": {
        if (!this.setups) throw new Error("This Relay can't set projects up.");
        return this.setups.start(
          idSchema.parse(args[0]),
          setupRequestSchema.parse(args[1]) as SetupRequest,
          device,
        );
      }
      case "setupProgress": {
        if (!this.setups) throw new Error("This Relay can't set projects up.");
        this.mine(idSchema.parse(args[0]), device.id);
        return this.setups.progress(
          repositoriesSchema.parse(args[1]),
          args[2] == null
            ? undefined
            : z.string().trim().min(1).max(4096).parse(args[2]),
        );
      }
      case "handoffUpload":
        return this.upload(
          idSchema.parse(args[0]),
          partSchema.parse(args[1]),
          z.number().int().min(0).parse(args[2]),
          base64.parse(args[3]),
        );
      case "receiveHandoff": {
        const id = idSchema.parse(args[0]);
        let job = this.receiving.get(id);
        if (!job) {
          const started = Date.now();
          job = this.receive(id, device)
            .then(
              (receipt) => {
                console.info(
                  `Handoff ${id.slice(0, 8)} from ${device.name}: arrived in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
                );
                return receipt;
              },
              (e: unknown) => {
                console.warn(
                  `Handoff ${id.slice(0, 8)} from ${device.name} didn't arrive:`,
                  e instanceof Error ? e.message : e,
                );
                throw e;
              },
            )
            .finally(() => this.receiving.delete(id));
          this.receiving.set(id, job);
        }
        return job;
      }
      case "handoffStatus":
        return this.status(z.array(idSchema).max(200).parse(args[0]));
      case "handBack": {
        const id = idSchema.parse(args[0]);
        this.handingBack.add(id);
        try {
          const back = await this.handBack(id, device.id);
          console.info(
            `Handoff ${id.slice(0, 8)} from ${device.name}: handed back.`,
          );
          return back;
        } catch (e) {
          console.warn(
            `Handoff ${id.slice(0, 8)} from ${device.name} couldn't go back:`,
            e instanceof Error ? e.message : e,
          );
          throw e;
        } finally {
          this.handingBack.delete(id);
        }
      }
      case "computerInfo":
        return {
          version: this.host.version(),
          bridge: remoteBridgeVersion,
          update: this.host.updates?.state() ?? {
            status: "off",
            current: this.host.version(),
          },
        };
      case "updateNow":
        return this.update();
      case "handoffDownload":
        this.mine(idSchema.parse(args[0]), device.id);
        return this.download(
          idSchema.parse(args[0]),
          partSchema.parse(args[1]),
          z.number().int().min(0).parse(args[2]),
        );
      case "handoffAbandoned":
        return this.abandoned(idSchema.parse(args[0]), device.id);
      case "handoffChat": {
        const id = idSchema.parse(args[0]);
        const chat = this.mine(id, device.id);
        const known =
          args[1] == null ? undefined : knownMessagesSchema.parse(args[1]);
        return this.feed.follow(chat, known);
      }
      case "handoffCall": {
        const chat = this.mine(idSchema.parse(args[0]), device.id);
        const method = z.enum(handoffMethods).parse(args[1]);
        const rest = z.array(z.unknown()).max(9).parse(args[2]).slice(1);
        if (!this.host.dispatch) throw new Error("This Relay can't do that.");
        // A folder call names the thread's worktree as this computer has it.
        const first = folderMethods.has(method)
          ? workspaceId(chat.projectId, chat.id)
          : chat.id;
        return this.host.dispatch(method, [
          first,
          ...(await this.host.chats.handoffArgs(chat.id, rest)),
        ]);
      }
      case "handedBack": {
        const id = idSchema.parse(args[0]);
        const chat = this.mine(id, device.id);
        await this.host.chats.handedBack(chat.id);
        await rm(join(this.host.dir, id), { recursive: true, force: true });
        return;
      }
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
    const known = this.host.chats.handedOver(id);
    if (known) return { chatId: known.id };
    const project = await this.own(projectId);
    const chat = await this.host.chats.adoptHome(project.id, thread, {
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
   * Checks for Relay's latest release and, when there is one, downloads it
   * and restarts into it, in the background; the answer is the state as it
   * starts. The agent host keeps this computer's agents going through the
   * restart, and the bridge comes back with it.
   */
  private async update(): Promise<UpdateState> {
    const updates = this.host.updates;
    if (!updates) throw new Error("This Relay can't update itself.");
    if (this.busy)
      throw new Error("A thread is on its way. Try again when it's arrived.");
    let state = updates.state();
    if (state.status === "off")
      throw new Error(
        "This Relay is a development build; it doesn't update itself.",
      );
    if (state.status === "idle" || state.status === "error")
      state = await updates.check();
    if (state.status === "available") {
      if (state.install === "manual")
        throw new Error(
          state.reason ??
            "This copy can't replace itself. Install the new version on it by hand.",
        );
      void updates
        .download()
        .then((next) => (next.status === "ready" ? updates.install() : next))
        .catch((e) => console.warn("Update from a paired computer failed:", e));
      return updates.state();
    }
    if (state.status === "ready") {
      void updates.install().catch((e) => console.warn("Update failed:", e));
      return updates.state();
    }
    return state;
  }
  private async projects(): Promise<ComputerProject[]> {
    const projects = (await this.host.projects()).filter(
      (p) => !p.plain && !p.scratch && !p.computer,
    );
    return Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        repositories: await this.host
          .root(p.id)
          .then(repositoryNames)
          .catch(() => []),
      })),
    );
  }
  private async describe(
    project: import("../../shared/projects").Project,
  ): Promise<ComputerProject> {
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
  private async upload(
    id: string,
    part: "thread" | "bundle",
    offset: number,
    data: string,
  ) {
    const bytes = Buffer.from(data, "base64");
    const limit = part === "bundle" ? maxHandoffBundle : maxHandoffThread;
    if (offset + bytes.length > limit)
      throw new Error("This handoff is too large.");
    const folder = join(this.host.dir, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, part);
    if (offset === 0) return writeFile(file, bytes, { mode: 0o600 });
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    // A chunk sent again after a lost answer is already here.
    if (offset + bytes.length <= size) return;
    if (offset !== size)
      throw new Error(`The upload is out of step: expected byte ${size}.`);
    const handle = await open(file, "a");
    try {
      await handle.write(bytes);
    } finally {
      await handle.close();
    }
  }
  private async receive(id: string, device: { id: string; name: string }) {
    const known = this.host.chats.handedOver(id);
    if (known) return this.receipt(known.id, known.projectId);
    const folder = join(this.host.dir, id);
    const thread = threadSchema.parse(
      JSON.parse(await readFile(join(folder, "thread"), "utf8")),
    ) as HandoffThread;
    const project = await this.projectFor(thread.repositories);
    const root = await this.host.root(project.id);
    await fetchRemotes(root);
    const ref = `refs/relay/handoffs/${id}`;
    let tip: string;
    if (thread.git.bundle)
      tip = await fetchBundle(
        root,
        join(folder, "bundle"),
        thread.git.branch,
        ref,
      );
    else if (await hasCommit(root, thread.git.tip)) tip = thread.git.tip;
    else throw new Error(needsFullBundle);
    if (tip !== thread.git.tip)
      throw new Error("The bundle doesn't hold the handed-off commit.");
    // A thread here before, and handed back since, left its branch behind.
    const copy = await this.host.chats.returnedCopy(
      project.id,
      thread.git.branch,
      tip,
    );
    const over = copy && "worktree" in copy ? copy : undefined;
    const renamed =
      copy && "problem" in copy
        ? copy.problem
        : !over && (await newBranchProblem(root, thread.git.branch));
    const worktree = await adoptWorktree(
      root,
      this.host.worktrees,
      thread.git.branch.replace(/^relay\//, ""),
      tip,
      {
        from: thread.git.from,
        start: thread.git.start,
        branch: thread.git.branch,
        ...(over ? { over: over.worktree } : {}),
      },
    );
    if (over) await this.host.chats.passedOn(over.id);
    await git(root, ["update-ref", "-d", ref]).catch(() => {});
    const chat = await this.host.chats.adopt(
      project.id,
      thread,
      { id, computer: thread.from, deviceId: device.id, at: Date.now(), tip },
      worktree,
      renamed || undefined,
    );
    await rm(folder, { recursive: true, force: true });
    return this.receipt(chat.id, project.id);
  }
  private async receipt(chatId: string, projectId: string) {
    const project = (await this.host.projects()).find(
      (p) => p.id === projectId,
    );
    return { chatId, project: project?.name ?? "" };
  }
  private async projectFor(repositories: string[]) {
    const wanted = new Set(repositories.map((r) => r.toLowerCase()));
    for (const p of await this.projects())
      if (p.repositories.some((r) => wanted.has(r))) return p;
    throw new Error(
      `No project here has ${repositories[0]}. Clone it and add it to Relay first.`,
    );
  }
  /** The sender took the thread back: whatever came is released, whatever's still coming is dropped. */
  private async abandoned(id: string, deviceId: string) {
    // An arrival under way finishes first, so it's the one that's released.
    await this.receiving.get(id)?.catch(() => undefined);
    const chat = this.host.chats.handedOver(id);
    if (chat?.cameFrom?.deviceId === deviceId) {
      await this.host.chats.handoffAbandoned(chat.id);
      console.info(
        `Handoff ${id.slice(0, 8)} from ${chat.cameFrom.computer}: taken back without this computer.`,
      );
    }
    await rm(join(this.host.dir, id), { recursive: true, force: true });
  }
  private mine(id: string, deviceId: string) {
    const chat = this.host.chats.handedOver(id);
    if (!chat || chat.cameFrom?.deviceId !== deviceId)
      throw new Error("This computer has no such thread from you.");
    return chat;
  }
  private async status(ids: string[]) {
    const result: Record<string, HandoffRemoteStatus | null> = {};
    for (const id of ids) {
      // Asked mid-arrival, "no such thread" would be a lie a moment later.
      await this.receiving.get(id)?.catch(() => undefined);
      const found = this.host.chats.handedOver(id);
      const live =
        found &&
        this.host.chats.list(found.projectId).find((c) => c.id === found.id);
      if (!found || !live) {
        result[id] = null;
        continue;
      }
      result[id] = {
        title: live.title,
        running: !!live.running,
        waiting: !!live.waiting,
        ...(live.asking ? { asking: true as const } : {}),
        ...(live.blocked ? { blocked: true as const } : {}),
        settled: !!live.settledAt,
        updated: live.updated,
        ...(await this.host.chats.latestTurn(found.id)),
        returned: !!live.cameFrom?.returnedAt,
      };
    }
    return result;
  }
  private async handBack(id: string, deviceId: string): Promise<HandBack> {
    const chat = this.mine(id, deviceId);
    const back = await this.host.chats.handBack(chat.id, deviceId);
    const folder = join(this.host.dir, id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const thread = Buffer.from(JSON.stringify(back.messages));
    await writeFile(join(folder, "back-thread"), thread, { mode: 0o600 });
    const file = join(folder, "back-bundle");
    await rm(file, { force: true });
    const bundle =
      back.tip !== back.since &&
      (await bundleBranch(back.root, back.branch, file, {
        since: back.since,
      }));
    return {
      tip: back.tip,
      branch: back.branch,
      thread: thread.length,
      bundle: bundle || 0,
    };
  }
  private async download(
    id: string,
    part: "thread" | "bundle",
    offset: number,
  ) {
    const handle = await open(join(this.host.dir, id, `back-${part}`), "r");
    try {
      const buffer = Buffer.alloc(handoffChunk);
      const { bytesRead } = await handle.read(buffer, 0, handoffChunk, offset);
      return buffer.subarray(0, bytesRead).toString("base64");
    } finally {
      await handle.close();
    }
  }
}
