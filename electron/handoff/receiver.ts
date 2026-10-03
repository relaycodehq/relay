import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  handoffChunk,
  handoffMessagesSchema,
  maxHandoffBundle,
  maxHandoffThread,
  needsFullBundle,
  type HandBack,
  type HandoffRemoteStatus,
  type HandoffThread,
} from "../../shared/handoff";
import { chatScopeSchema, projectChatSendSchema } from "../../shared/projects";
import {
  remoteBridgeVersion,
  type ComputerMethod,
  type ComputerProject,
} from "../../shared/remote";
import type { UpdateState } from "../../shared/updates";
import { idSchema } from "../../shared/rooms";
import { git } from "../git/git";
import type { ProjectChats } from "../project-chats";
import { adoptWorktree } from "../git/worktrees";
import {
  bundleBranch,
  fetchBundle,
  fetchRemotes,
  hasCommit,
  repositoryNames,
} from "../git/bundles";

const partSchema = z.enum(["thread", "bundle"]);
const base64 = z
  .string()
  .max(Math.ceil(handoffChunk / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
const shaSchema = z.string().regex(/^[0-9a-f]{40,64}$/);
const branchSchema = z
  .string()
  .max(200)
  .regex(/^[\w./-]+$/)
  .refine((b) => !b.includes("..") && !b.startsWith("-"));
const threadSchema = z
  .object({
    from: z.string().trim().min(1).max(80),
    repositories: z.array(z.string().max(300)).min(1).max(20),
    title: z.string().max(200),
    scope: chatScopeSchema,
    settings: projectChatSendSchema.pick({
      provider: true,
      choice: true,
      runtimeMode: true,
      interactionMode: true,
      contextWindow: true,
    }),
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
  })
  .strict();

export interface ReceiverHost {
  projects(): Promise<import("../../shared/projects").Project[]>;
  root(projectId: string): Promise<string>;
  chats: ProjectChats;
  /** Where threads' worktrees live, as ProjectChats makes them. */
  worktrees: string;
  /** Scratch space for uploads and downloads, a folder per handoff. */
  dir: string;
  /** This Relay's version. */
  version(): string;
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
  constructor(private host: ReceiverHost) {}
  async handle(
    method: ComputerMethod,
    args: unknown[],
    device: { id: string; name: string },
  ): Promise<unknown> {
    switch (method) {
      case "computerProjects":
        return this.projects();
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
          job = this.receive(id, device).finally(() =>
            this.receiving.delete(id),
          );
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
          return await this.handBack(id, device.id);
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
      case "handedBack": {
        const id = idSchema.parse(args[0]);
        const chat = this.mine(id, device.id);
        await this.host.chats.handedBack(chat.id);
        await rm(join(this.host.dir, id), { recursive: true, force: true });
        return;
      }
    }
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
    if (this.receiving.size || this.handingBack.size)
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
      (p) => !p.plain && !p.scratch,
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
    const worktree = await adoptWorktree(
      root,
      this.host.worktrees,
      thread.git.branch.replace(/^relay\//, ""),
      tip,
      { from: thread.git.from, start: thread.git.start },
    );
    await git(root, ["update-ref", "-d", ref]).catch(() => {});
    const chat = await this.host.chats.adopt(
      project.id,
      thread,
      { id, computer: thread.from, deviceId: device.id, at: Date.now(), tip },
      worktree,
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
    if (chat?.cameFrom?.deviceId === deviceId)
      await this.host.chats.handoffAbandoned(chat.id);
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
