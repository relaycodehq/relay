// On the computer that took threads over: the calls the computers they came
// from make to follow them live and drive them from there.
import { z } from "zod";
import {
  handoffFolderMethods,
  handoffMethods,
  type HandoffRemoteStatus,
} from "../../shared/handoff";
import type {
  ComputerThread,
  ComputerThreadList,
} from "../../shared/computer-threads";
import { chatActivitySection } from "../../shared/chat-activity";
import {
  chatTriageSchema,
  knownMessagesSchema,
  type ChatSummary,
} from "../../shared/projects";
import { idSchema } from "../../shared/validation";
import { workspaceId } from "../../shared/workspaces";
import type { ComputerMethod } from "../../shared/remote";
import type { LiveFeed } from "./live-feed";
import type { ReceiverHost } from "./receiver";
import { fromHome } from "./setup-agent";

const folderMethods = new Set<string>(handoffFolderMethods);

/** The calls a computer makes to follow and drive threads here. */
const liveThreadMethods = [
  "handoffChat",
  "handoffCall",
  "handoffStatus",
  "computerThreads",
  "threadTriage",
  "threadRender",
] as const satisfies readonly ComputerMethod[];

type LiveThreadMethod = (typeof liveThreadMethods)[number];

export const isLiveThreadMethod = (
  method: ComputerMethod,
): method is LiveThreadMethod =>
  (liveThreadMethods as readonly string[]).includes(method);

export class LiveThreads {
  constructor(
    private host: ReceiverHost,
    private feed: LiveFeed,
    /** The arrival under way for a handoff, if one is. */
    private arriving: (id: string) => Promise<unknown> | undefined,
  ) {}

  handle(method: LiveThreadMethod, args: unknown[], deviceId: string) {
    switch (method) {
      case "handoffChat":
        return this.chat(args, deviceId);
      case "handoffCall":
        return this.call(args, deviceId);
      case "handoffStatus":
        return this.statuses(args);
      case "computerThreads":
        return this.list(deviceId);
      case "threadTriage":
        return this.triage(args, deviceId);
      case "threadRender":
        return this.render(args, deviceId);
    }
  }

  /** This computer's own threads, latest first, for the device to list. */
  private async list(deviceId: string): Promise<ComputerThreadList> {
    const projects = (await this.host.projects()).filter(
      (p) => !p.scratch && !p.computer && !p.removed,
    );
    const threads = projects
      .flatMap((p) => this.host.chats.list(p.id))
      .flatMap((c) => {
        const id = followedBy(c, deviceId);
        return id ? [listed(c, id)] : [];
      })
      .sort((a, b) => b.updated - a.updated)
      .slice(0, maxListed);
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        folder: fromHome(p.path),
        ...(p.plain ? { plain: true as const } : {}),
      })),
      threads,
    };
  }

  /** The thread a handoff from the device made here; no other device's. */
  fromDevice(id: string, deviceId: string) {
    const chat = this.host.chats.handoffs.handedOver(id);
    if (!chat || chat.cameFrom?.deviceId !== deviceId)
      throw new Error("This computer has no such thread from you.");
    return chat;
  }

  /**
   * A thread the device may follow and drive, by the id it knows it by: one
   * it handed here, or one of this computer's own.
   */
  private async followable(id: string, deviceId: string) {
    if (this.host.chats.handoffs.handedOver(id))
      return this.fromDevice(id, deviceId);
    const own = await this.own(id);
    if (!own) throw new Error("This computer has no such thread.");
    return own;
  }

  /** One of this computer's own threads, which any paired computer may follow. */
  private async own(id: string) {
    for (const p of await this.host.projects()) {
      const chat = this.host.chats.list(p.id).find((c) => c.id === id);
      if (chat) return ownThread(chat) ? chat : undefined;
    }
  }

  /** The thread as written here; the device follows it live from now on (`handoffChat`). */
  private async chat(args: unknown[], deviceId: string) {
    const id = idSchema.parse(args[0]);
    const chat = await this.followable(id, deviceId);
    const known =
      args[1] == null ? undefined : knownMessagesSchema.parse(args[1]);
    return this.feed.follow(chat, known, { handoffId: id, deviceId });
  }

  /** One of `handoffMethods` on the thread, as its own window would call it (`handoffCall`). */
  private async call(args: unknown[], deviceId: string) {
    const chat = await this.followable(idSchema.parse(args[0]), deviceId);
    const method = z.enum(handoffMethods).parse(args[1]);
    const rest = z.array(z.unknown()).max(9).parse(args[2]).slice(1);
    if (!this.host.dispatch) throw new Error("This Relay can't do that.");
    // A folder call names the thread's worktree as this computer has it.
    const first = folderMethods.has(method)
      ? workspaceId(chat.projectId, chat.id)
      : chat.id;
    return this.host.dispatch(method, [
      first,
      ...(await this.host.chats.liveHandoff.inbound(chat.id, rest)),
    ]);
  }

  /** Settles, snoozes or wakes the thread here, as its own Activity would. */
  private async triage(args: unknown[], deviceId: string) {
    const chat = await this.followable(idSchema.parse(args[0]), deviceId);
    const triage = chatTriageSchema.parse(args[1]);
    if (!this.host.dispatch) throw new Error("This Relay can't do that.");
    await this.host.dispatch("triageProjectChat", [chat.id, triage]);
  }

  /** A page one of the thread's answers showed, for the device to show it there too. */
  private async render(args: unknown[], deviceId: string) {
    const chat = await this.followable(idSchema.parse(args[0]), deviceId);
    const renderId = z.uuid().parse(args[1]);
    const page = z.number().int().min(0).parse(args[2]);
    return this.host.chats.renderPage(chat.id, renderId, page);
  }

  /** How each thread stands here, by handoff id; null for one that isn't here (`handoffStatus`). */
  private async statuses(args: unknown[]) {
    const ids = z.array(idSchema).max(200).parse(args[0]);
    const result: Record<string, HandoffRemoteStatus | null> = {};
    for (const id of ids) {
      // Asked mid-arrival, "no such thread" would be a lie a moment later.
      await this.arriving(id)?.catch(() => undefined);
      const found =
        this.host.chats.handoffs.handedOver(id) ?? (await this.own(id));
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
        ...(await this.host.chats.handoffs.latestTurn(found.id)),
        returned: !!live.cameFrom?.returnedAt,
      };
    }
    return result;
  }
}

/** The most threads a list carries; older ones aren't worth the bytes. */
const maxListed = 500;

/** Started here and still here: not handed here, nor handed on, nor a deep review's reviewer. */
const ownThread = (chat: ChatSummary) =>
  !chat.cameFrom && !chat.sentTo && !chat.reviewer;

/**
 * What the device follows the thread by, if it lists it: a thread of this
 * computer's own, or one that device handed here. Not a thread another
 * computer handed here, nor one this computer handed on, nor a deep review.
 */
/** The id the device follows the thread by, when it may follow it. */
export function followedBy(chat: ChatSummary, deviceId: string) {
  if (chat.archivedAt || chat.scope.kind === "review") return;
  if (ownThread(chat)) return chat.id;
  const from = chat.cameFrom;
  if (!from || chat.sentTo) return;
  const stillHere = !from.returnedAt && !from.abandonedAt && !from.setup;
  if (from.deviceId === deviceId && stillHere) return from.id;
}

function listed(chat: ChatSummary, id: string): ComputerThread {
  return {
    id,
    projectId: chat.projectId,
    title: chat.title,
    scope: chat.scope,
    updated: chat.updated,
    ...(chat.branch ? { branch: chat.branch } : {}),
    ...(chat.provider ? { provider: chat.provider } : {}),
    ...(chat.running
      ? {
          running: true as const,
          runningFor: Date.now() - (chat.runningSince ?? Date.now()),
        }
      : {}),
    ...(chat.waiting ? { waiting: true as const } : {}),
    ...(chat.asking ? { asking: true as const } : {}),
    ...(chat.blocked ? { blocked: true as const } : {}),
    section: chatActivitySection(chat, Date.now()),
  };
}
