import { createHash } from "node:crypto";
import { structuredPatch } from "diff";
import { z } from "zod";
import { chatIsEmpty } from "../../shared/chat-activity";
import {
  knownMessagesSchema,
  type ChatMessage,
  type ChatSummary,
  type KnownMessages,
  type Project,
  type ProjectChatPatch,
} from "../../shared/projects";
import {
  phoneDesktopMethods,
  remoteBridgeVersion,
  maxRemoteHistory,
  remoteHistory,
  type ComputerMethod,
  type PhoneAppearance,
  type PhoneAppRelease,
  type PhoneDesktopMethod,
  type RemoteApi,
  type RemoteChatSummary,
  type RemoteDiff,
  type RemoteDiffLine,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteProjectIcon,
} from "../../shared/remote";
import { idSchema } from "../../shared/rooms";
import type { ApiMethod, FilePair } from "../../shared/types";
import type { SpeechService } from "./phone-dictation";

/** What the bridge needs from the desktop; main.ts wires it to the real services. */
export interface RemoteHost {
  projects(): Promise<Project[]>;
  projectPath(projectId: string): string;
  chats(projectId: string): ChatSummary[];
  chat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  /** The desktop's own dispatch, which validates every call's arguments. */
  dispatch(method: ApiMethod, args: unknown[]): Promise<unknown>;
  name(): string;
  /** This Relay's version, which the phone compares with its own. */
  version?(): string;
  appearance?(): PhoneAppearance | undefined;
  /** The phone app's code this build carries, if any; see ./phone-app. */
  phoneApp?: {
    release(): Promise<PhoneAppRelease | undefined>;
    chunk(path: string, offset: number): Promise<string>;
  };
  /** The speech engine phones dictate with. */
  dictation?: SpeechService;
  /** Takes threads other computers hand over; see ../handoff/receiver. */
  handoffs?: {
    handle(
      method: ComputerMethod,
      args: unknown[],
      device: { id: string; name: string },
    ): Promise<unknown>;
  };
}

const pathSchema = z.string().min(1).max(1000);
const knownIconsSchema = z
  .record(idSchema, z.string().max(64).nullable())
  .refine((known) => Object.keys(known).length <= 1000);
const diffSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("turn"),
      chatId: idSchema,
      messageId: idSchema,
      path: pathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("working"),
      where: z.string().max(80),
      path: pathSchema,
      area: z.enum(["staged", "unstaged"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("commit"),
      where: z.string().max(80),
      sha: z.string().max(64),
      path: pathSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("worktree"), chatId: idSchema, path: pathSchema })
    .strict(),
]);
const maxDiffLines = 3000;
/** Streaming answers go out at most this often; the phone doesn't need every token. */
const streamMs = 150;

/** The phone's API: a few calls of its own, and an allowlist of the desktop's. */
export class RemoteBridge {
  private streams = new Map<
    string,
    { timer: NodeJS.Timeout; event: Extract<RemoteEvent, { kind: "message" }> }
  >();
  private lastChats = "";
  private poll?: NodeJS.Timeout;
  private polls = 0;
  /** Unknown until a phone asks for the overview; nothing is watched before that. */
  private projectIds?: string[];
  constructor(
    private host: RemoteHost,
    private broadcast: (event: RemoteEvent) => void,
  ) {}
  /** Calls about one phone, and a computer's, go through phone-remote, which knows who asks. */
  private api: Omit<RemoteApi, "reportApp" | "dictate" | ComputerMethod> = {
    overview: async () => {
      const [projects, phoneApp] = await Promise.all([
        this.host.projects(),
        this.host.phoneApp?.release(),
      ]);
      this.projectIds = projects.map((p) => p.id);
      return {
        name: this.host.name(),
        bridge: remoteBridgeVersion,
        ...(this.host.version ? { version: this.host.version() } : {}),
        ...(phoneApp ? { phoneApp } : {}),
        ...(this.host.dictation
          ? { dictation: this.host.dictation.status() }
          : {}),
        ...(this.host.appearance?.()
          ? { appearance: this.host.appearance() }
          : {}),
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.folder ? { folder: p.folder } : {}),
          ...(p.scratch ? { scratch: true } : {}),
          ...(p.plain ? { plain: true } : {}),
        })),
        chats: this.summaries(),
      };
    },
    chat: async (id, known, history = remoteHistory) => {
      const patch = await this.host.chat(id, known);
      const summary = this.host.chats(patch.projectId).find((c) => c.id === id);
      const last = patch.lastInput;
      return {
        id: patch.id,
        projectId: patch.projectId,
        title: patch.title,
        scope: patch.scope,
        messages: patch.messages.slice(-history),
        earlier: Math.max(0, patch.messages.length - history),
        requests: patch.requests,
        queuePaused: patch.queuePaused,
        running: !!summary?.running,
        root:
          patch.worktree?.path && !patch.worktree.removedAt
            ? patch.worktree.path
            : this.host.projectPath(patch.projectId),
        queue: (patch.queue ?? []).map((q) => ({
          id: q.input.id,
          body: q.input.body,
          ...(q.input.images?.length ? { images: q.input.images.length } : {}),
          ...(q.error ? { error: q.error } : {}),
        })),
        scheduled: (patch.scheduled ?? []).map((q) => ({
          id: q.input.id,
          body: q.input.body,
          at: q.at,
          ...(q.input.images?.length ? { images: q.input.images.length } : {}),
          ...(q.error ? { error: q.error } : {}),
        })),
        ...(patch.worktree ? { worktree: patch.worktree } : {}),
        ...(patch.stopped ? { stopped: patch.stopped } : {}),
        ...(summary?.pending ? { pending: summary.pending } : {}),
        ...(last
          ? {
              settings: {
                provider: last.provider,
                choice: last.choice,
                runtimeMode: last.runtimeMode,
                interactionMode: last.interactionMode,
                ...(last.contextWindow
                  ? { contextWindow: last.contextWindow }
                  : {}),
              },
              lastParentId: last.parentId ?? null,
            }
          : {}),
      };
    },
    diff: async (source) => {
      const [method, args]: [ApiMethod, unknown[]] =
        source.kind === "turn"
          ? ["projectTurnDiff", [source.chatId, source.messageId, source.path]]
          : source.kind === "working"
            ? ["projectWorkingDiff", [source.where, source.path, source.area]]
            : source.kind === "commit"
              ? ["projectCommitDiff", [source.where, source.sha, source.path]]
              : ["projectWorktreeDiff", [source.chatId, source.path]];
      return toRemoteDiff(
        source.path,
        (await this.host.dispatch(method, args)) as FilePair,
      );
    },
    desktop: async (method, args) => {
      const value = await this.host.dispatch(method, args);
      // Sends, stops and triage move thread states; say so without waiting for the watch.
      this.refresh();
      return value;
    },
    phoneAppFile: async (path, offset) => {
      if (!this.host.phoneApp) throw new Error("This Relay has no phone app to hand out.");
      return this.host.phoneApp.chunk(path, offset);
    },
    projectIcons: async (known) => {
      const projects = await this.host.projects();
      const changed: Record<string, RemoteProjectIcon> = {};
      // A few at a time: the first look walks each project's folders.
      for (let i = 0; i < projects.length; i += 4)
        await Promise.all(
          projects.slice(i, i + 4).map(async ({ id }) => {
            const dataUrl = (await this.host
              .dispatch("projectIcon", [id])
              .catch(() => null)) as string | null;
            const hash = dataUrl
              ? createHash("sha256").update(dataUrl).digest("hex").slice(0, 16)
              : null;
            if (known[id] === hash) return;
            changed[id] = hash && dataUrl ? { hash, dataUrl } : { hash: null };
          }),
        );
      return changed;
    },
  };
  async handle(method: RemoteMethod, args: unknown[]): Promise<unknown> {
    const a = this.api;
    switch (method) {
      case "overview":
        return a.overview();
      case "chat":
        return a.chat(
          idSchema.parse(args[0]),
          args[1] == null ? undefined : knownMessagesSchema.parse(args[1]),
          args[2] == null
            ? undefined
            : z.number().int().min(1).max(maxRemoteHistory).parse(args[2]),
        );
      case "diff":
        return a.diff(diffSourceSchema.parse(args[0]));
      case "desktop":
        return a.desktop(
          z.enum(phoneDesktopMethods).parse(args[0]) as PhoneDesktopMethod,
          z.array(z.unknown()).max(10).parse(args[1]),
        );
      case "projectIcons":
        return a.projectIcons(knownIconsSchema.parse(args[0] ?? {}));
      case "phoneAppFile":
        return a.phoneAppFile(
          z.string().max(200).parse(args[0]),
          z.number().int().min(0).parse(args[1]),
        );
      default:
        throw new Error("Phones can't do that.");
    }
  }
  /** Relays a chat event, holding back streaming updates to one per message every `streamMs`. */
  chatEvent(event: { chatId: string; message: ChatMessage; title?: string }) {
    const next = { kind: "message" as const, ...event };
    const held = this.streams.get(event.message.id);
    if (event.message.status === "streaming") {
      if (held) held.event = next;
      else
        this.streams.set(event.message.id, {
          event: next,
          timer: setTimeout(() => {
            const latest = this.streams.get(event.message.id);
            this.streams.delete(event.message.id);
            if (latest) this.broadcast(latest.event);
          }, streamMs),
        });
      return;
    }
    if (held) {
      clearTimeout(held.timer);
      this.streams.delete(event.message.id);
    }
    this.broadcast(next);
    this.refresh();
  }
  /** Watches thread states while a phone is connected; they aren't all evented. */
  setWatching(watching: boolean) {
    if (!watching) {
      clearInterval(this.poll);
      this.poll = undefined;
      this.lastChats = "";
      return;
    }
    this.poll ??= setInterval(() => {
      // New projects are rare; threads move all the time.
      if (++this.polls % 15 === 0)
        void this.host
          .projects()
          .then((projects) => (this.projectIds = projects.map((p) => p.id)))
          .catch(() => {});
      this.refresh();
    }, 2000);
  }
  /** Tells phones when a thread starts, finishes, or starts waiting on them. */
  refresh() {
    if (!this.projectIds) return;
    const chats = this.summaries();
    const signature = JSON.stringify(chats);
    if (signature === this.lastChats) return;
    this.lastChats = signature;
    this.broadcast({ kind: "chats", chats });
  }
  dispose() {
    this.setWatching(false);
    for (const held of this.streams.values()) clearTimeout(held.timer);
    this.streams.clear();
  }
  private summaries() {
    return (this.projectIds ?? [])
      .flatMap((id) => {
        try {
          return this.host.chats(id);
        } catch {
          return [];
        }
      })
      .filter((c) => !c.archivedAt && !chatIsEmpty(c))
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 300)
      .map(summary);
  }
}

function summary(c: ChatSummary): RemoteChatSummary {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    scope: c.scope.kind,
    updated: c.updated,
    created: c.created,
    ...(c.provider ? { provider: c.provider } : {}),
    ...(c.running ? { running: true, runningSince: c.runningSince } : {}),
    ...(c.waiting ? { waiting: true } : {}),
    ...(c.settledAt ? { settledAt: c.settledAt } : {}),
    ...(c.seenAt ? { seenAt: c.seenAt } : {}),
    ...(c.snoozedUntil
      ? { snoozedUntil: c.snoozedUntil, snoozedAt: c.snoozedAt }
      : {}),
    ...(c.branch ? { branch: c.branch } : {}),
    ...(c.worktree ? { worktree: true } : {}),
    ...(c.pending?.length ? { pending: c.pending } : {}),
    ...(c.nextSend ? { nextSend: c.nextSend } : {}),
    ...(c.empty ? { empty: true } : {}),
  };
}

export function toRemoteDiff(path: string, pair: FilePair): RemoteDiff {
  if (pair.binary) return { path, binary: true, hunks: [], truncated: false };
  const patch = structuredPatch(
    pair.old?.name ?? path,
    pair.next?.name ?? path,
    pair.old?.contents ?? "",
    pair.next?.contents ?? "",
    undefined,
    undefined,
    { context: 3 },
  );
  let budget = maxDiffLines,
    truncated = false;
  const hunks: RemoteDiff["hunks"] = [];
  for (const h of patch.hunks) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    let old = h.oldStart,
      next = h.newStart;
    const lines: RemoteDiffLine[] = [];
    for (const raw of h.lines) {
      if (raw.startsWith("\\")) continue;
      if (budget-- <= 0) {
        truncated = true;
        break;
      }
      const text = raw.slice(1);
      if (raw[0] === "+") lines.push({ kind: "add", text, new: next++ });
      else if (raw[0] === "-") lines.push({ kind: "del", text, old: old++ });
      else lines.push({ kind: "same", text, old: old++, new: next++ });
    }
    hunks.push({
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      lines,
    });
  }
  return { path, binary: false, hunks, truncated };
}
