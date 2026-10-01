import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  handoffChunk,
  needsFullBundle,
  type ComputerInfo,
  type AwayThread,
  type ComputersOverview,
  type HandoffRemoteStatus,
  type HandoffTarget,
  type HandoffThread,
  type HandoffView,
} from "../../shared/handoff";
import type { ChatMessage, ChatSummary } from "../../shared/projects";
import { remoteBridgeVersion, type HandoffPart } from "../../shared/remote";
import type { RemoteClient } from "../../shared/remote-client";
import { agentMention } from "../../shared/rooms";
import { git } from "../git";
import { portableMessages, type ProjectChats } from "../project-chats";
import type { Projects } from "../projects";
import type { Store } from "../store";
import { computerName, type Computers } from "./computers";
import {
  bundleBranch,
  fetchBundle,
  hasCommit,
  landReturned,
  repositoryNames,
} from "./git";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What a Relay from before bridge 10 answers a call it doesn't know. */
const unknownCall = "Phones can't do that.";

/**
 * Handing this computer's threads to the paired ones and bringing them back.
 * Each step leaves the thread's `sentTo` saying where it stands, with the
 * error when one failed, so a retry picks up with the same handoff id.
 */
export class Handoffs {
  private jobs = new Map<string, Promise<void>>();
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
    computers.onOnline((id) => void this.acknowledge(id));
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
            : remote.waiting
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
  /** Gives up on a handoff that never arrived, keeping the thread here. */
  async keepHere(chatId: string) {
    const sentTo = this.summary(chatId).sentTo;
    if (!sentTo) return;
    if (sentTo.state !== "sending" || this.jobs.has(chatId))
      throw new Error(
        `${sentTo.computer} has this thread. Bring it back instead.`,
      );
    const status = await this.remote(sentTo, true).catch(() => undefined);
    if (status) {
      await this.chats.updateSentTo(chatId, sentTo.id, {
        state: "away",
        error: undefined,
      });
      throw new Error(
        `${sentTo.computer} got this thread after all. Bring it back instead.`,
      );
    }
    await this.chats.updateSentTo(chatId, sentTo.id, null);
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
  /** Stop, note and commit here, then the thread and its code across. */
  private async send(chatId: string, id: string, computerId: string) {
    const folder = join(this.dir, id);
    try {
      const { name } = this.computers.get(computerId);
      const { chat, root, tip } = await this.chats.leave(chatId, name);
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
      if (outdated(await this.info(computerId, client, true)))
        throw new Error(
          `${name} runs an older Relay. Update it from Settings → Computers, then try again.`,
        );
      const thread: HandoffThread = {
        from: computerName(),
        repositories,
        title: chat.title,
        scope: chat.scope,
        settings: {
          provider: agentMention(input.body)?.provider ?? input.provider,
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
      await this.chats.updateSentTo(chatId, id, {
        state: "away",
        error: undefined,
      });
      await rm(folder, { recursive: true, force: true });
    } catch (e) {
      await this.chats.updateSentTo(chatId, id, { error: message(e) });
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
    try {
      const path = this.summary(chatId).worktree?.path;
      if (!path)
        throw new Error("The thread's worktree is gone on this computer.");
      const client = await this.computers.connected(computerId);
      const back = await client.call("handBack", id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const json = join(folder, "thread");
      await download(client, id, "thread", back.thread, json);
      const messages = JSON.parse(
        await readFile(json, "utf8"),
      ) as ChatMessage[];
      if (!Array.isArray(messages))
        throw new Error("The thread came back unreadable.");
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
          await this.chats.updateSentTo(chatId, id, {
            error: `Its work and what was committed here meanwhile both change ${conflicts.join(", ")}. It's kept at ${ref}.`,
            conflicts,
          });
          return;
        }
        await git(path, ["update-ref", "-d", ref]).catch(() => {});
      }
      await this.chats.returned(chatId, id, messages);
      this.statuses.delete(id);
      await rm(folder, { recursive: true, force: true });
      await this.acknowledge(computerId, id);
    } catch (e) {
      await this.chats.updateSentTo(chatId, id, { error: message(e) });
    }
  }
  /** Tells the other computer its copies came back, including any it missed. */
  private async acknowledge(computerId: string, id?: string) {
    let computer;
    try {
      computer = this.computers.get(computerId);
    } catch {
      return;
    }
    const ids = [
      ...new Set([...(computer.unacknowledged ?? []), ...(id ? [id] : [])]),
    ];
    if (!ids.length) return;
    const left: string[] = [];
    for (const each of ids) {
      try {
        const client = await this.computers.connected(computerId);
        await client.call("handedBack", each);
      } catch {
        left.push(each);
      }
    }
    await this.computers.setUnacknowledged(computerId, left);
  }
}

/** Too old to take threads from this computer: before bridge 10, or behind this one's. */
export const outdated = (info: ComputerInfo | null | undefined) =>
  info === null || (!!info && info.bridge < remoteBridgeVersion);

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
