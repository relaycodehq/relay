import { createHash } from "node:crypto";
import { structuredPatch } from "diff";
import { z } from "zod";
import { chatIsEmpty } from "../../shared/chat-activity";
import {
  knownMessagesSchema,
  projectChatSendSchema,
  type AgentActivity,
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
  phoneDetailPreview,
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
import { sentAgent } from "../../shared/recipient";
import { chatOrder } from "../../shared/remote-delta";
import { queuedForPhone } from "../../shared/remote-queued";
import { idSchema } from "../../shared/validation";
import type { ApiMethod, FilePair } from "../../shared/types";
import type { SubagentDetail, SubagentRun } from "../../shared/subagents";
import type { SpeechService } from "./phone-dictation";
import type { VoiceService } from "./phone-read-aloud";

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
  /** `dataUrl` at most `max` pixels on its longer side; without it phones get images whole. */
  shrinkImage?(dataUrl: string, max: number): string;
  /** The speech engine phones dictate with. */
  dictation?: SpeechService;
  /** The voice phones hear answers in. */
  readAloud?: VoiceService;
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
const activityIdSchema = z.string().min(1).max(200);
const knownIconsSchema = z
  .record(idSchema, z.string().max(64).nullable())
  .refine((known) => Object.keys(known).length <= 1000);
const imageSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("attached"),
      chatId: idSchema,
      imageId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("read"),
      chatId: idSchema,
      messageId: idSchema,
      path: pathSchema,
    })
    .strict(),
]);
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
const signatureSchema = z.string().regex(/^[a-f0-9]{64}$/);
const maxDiffLines = 3000;
/** Streaming answers go out at most this often; the phone doesn't need every token. */
const streamMs = 150;
const sendKey = (chatId: string, id: string) => JSON.stringify([chatId, id]);

/** The phone's API: a few calls of its own, and an allowlist of the desktop's. */
export class RemoteBridge {
  private streams = new Map<
    string,
    { timer: NodeJS.Timeout; event: Extract<RemoteEvent, { kind: "message" }> }
  >();
  private lastChats = "";
  // Kept across phone reconnects, until dispatch finishes (which may be making a worktree).
  private sends = new Map<string, Promise<unknown>>();
  // A taken-back queue item no longer holds its id. Its lost answer still counts as a receipt.
  private acceptedSends = new Set<string>();
  private watching = false;
  /** Unknown until a phone asks for the overview; nothing is watched before that. */
  private projectIds?: string[];
  constructor(
    private host: RemoteHost,
    private broadcast: (event: RemoteEvent) => void,
  ) {}
  /** Calls about one phone, and a computer's, go through phone-remote, which knows who asks. */
  private api: Omit<
    RemoteApi,
    "reportApp" | "dictate" | "readAloud" | ComputerMethod
  > = {
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
        ...(this.host.readAloud
          ? { readAloud: this.host.readAloud.ready() }
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
          ...(p.settings?.workspace ? { workspace: p.settings.workspace } : {}),
        })),
        chats: this.summaries(),
      };
    },
    chat: async (id, known, history = remoteHistory, sendId) => {
      const key = sendId === undefined ? undefined : sendKey(id, sendId);
      const sending = () => key !== undefined && this.sends.has(key);
      const inFlight = sendId !== undefined && sending();
      const patch = await this.host.chat(id, known);
      const summary = this.host.chats(patch.projectId).find((c) => c.id === id);
      const last = patch.lastInput;
      const sendPending = inFlight || (sendId !== undefined && sending());
      return {
        id: patch.id,
        projectId: patch.projectId,
        title: patch.title,
        scope: patch.scope,
        ...(sendId !== undefined
          ? {
              sendPending,
              hasSend:
                sendPending ||
                (key !== undefined && this.acceptedSends.has(key)) ||
                patch.messages.some(
                  (m) => (typeof m === "string" ? m : m.id) === sendId,
                ) ||
                patch.queue?.some((q) => q.input.id === sendId) === true ||
                patch.scheduled?.some((s) => s.input.id === sendId) === true,
            }
          : {}),
        messages: patch.messages
          .slice(-history)
          .map((m) => (typeof m === "string" ? m : forPhone(m))),
        earlier: Math.max(0, patch.messages.length - history),
        requests: patch.requests,
        queuePaused: patch.queuePaused,
        running: !!summary?.running,
        root:
          patch.worktree?.path && !patch.worktree.removedAt
            ? patch.worktree.path
            : this.host.projectPath(patch.projectId),
        queue: (patch.queue ?? []).map(queuedForPhone),
        scheduled: (patch.scheduled ?? []).map((q) => ({
          ...queuedForPhone(q),
          at: q.at,
        })),
        ...(patch.worktree ? { worktree: patch.worktree } : {}),
        ...(patch.stopped ? { stopped: patch.stopped } : {}),
        ...(summary?.pending ? { pending: summary.pending } : {}),
        ...(last
          ? {
              settings: {
                provider: sentAgent(last),
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
    activityDetail: async (chatId, messageId, activityId) => {
      const message = (await this.host.chat(chatId)).messages.find(
        (m): m is ChatMessage => typeof m !== "string" && m.id === messageId,
      );
      return (
        messageActivity(message).find((a) => a.id === activityId)?.detail ??
        null
      );
    },
    image: async (source, max) => {
      const dataUrl = (await this.host.dispatch(
        ...((source.kind === "attached"
          ? ["projectChatImage", [source.chatId, source.imageId]]
          : [
              "projectChatReadImage",
              [source.chatId, source.messageId, source.path],
            ]) as [ApiMethod, unknown[]]),
      )) as string;
      return this.host.shrinkImage?.(dataUrl, max) ?? dataUrl;
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
    subagents: async (chatId, known) => {
      const runs = (
        (await this.host.dispatch("projectChatAgents", [
          chatId,
        ])) as SubagentRun[]
      ).map(({ brief: _, ...run }) => run);
      const signature = digest(runs);
      return signature === known ? null : { signature, runs };
    },
    subagentRun: async (chatId, agentId, known) => {
      const value = (await this.host.dispatch("projectChatAgent", [
        chatId,
        agentId,
      ])) as SubagentDetail | null;
      const run = value ? forPhoneRun(value) : null;
      const signature = digest(run);
      return signature === known ? null : { signature, run };
    },
    desktop: async (method, args) => {
      const send =
        method === "sendProjectChat"
          ? {
              chatId: idSchema.parse(args[0]),
              id: projectChatSendSchema.parse(args[1]).id,
            }
          : undefined;
      const key = send && sendKey(send.chatId, send.id);
      if (key && this.acceptedSends.has(key)) return;
      // A reconnect may retry before worktree creation finishes: both await the same send.
      let job = key ? this.sends.get(key) : undefined;
      if (!job) {
        job = this.host.dispatch(method, args);
        if (key) this.sends.set(key, job);
      }
      try {
        let value = await job;
        if (key) this.acceptedSends.add(key);
        if (method === "projectChatAgent" && value)
          value = forPhoneRun(value as SubagentDetail);
        // Sends, stops and triage move thread states; phones hear before the call returns.
        this.refresh();
        return value;
      } finally {
        if (key && this.sends.get(key) === job) this.sends.delete(key);
      }
    },
    phoneAppFile: async (path, offset) => {
      if (!this.host.phoneApp)
        throw new Error("This Relay has no phone app to hand out.");
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
          args[3] == null ? undefined : idSchema.parse(args[3]),
        );
      case "activityDetail":
        return a.activityDetail(
          idSchema.parse(args[0]),
          idSchema.parse(args[1]),
          activityIdSchema.parse(args[2]),
        );
      case "diff":
        return a.diff(diffSourceSchema.parse(args[0]));
      case "image":
        return a.image(
          imageSourceSchema.parse(args[0]),
          z.number().int().min(16).max(4096).parse(args[1]),
        );
      case "subagents":
        return a.subagents(
          idSchema.parse(args[0]),
          args[1] == null ? undefined : signatureSchema.parse(args[1]),
        );
      case "subagentRun":
        return a.subagentRun(
          idSchema.parse(args[0]),
          activityIdSchema.parse(args[1]),
          args[2] == null ? undefined : signatureSchema.parse(args[2]),
        );
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
    const next = {
      kind: "message" as const,
      ...event,
      message: forPhone(event.message),
    };
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
  }
  /** Follows thread states while a phone is connected. */
  setWatching(watching: boolean) {
    this.watching = watching;
    if (!watching) this.lastChats = "";
  }
  /** A project's thread list changed; one new since the overview joins the watch. */
  chatsChanged(projectId: string) {
    if (!this.watching || !this.projectIds) return;
    if (this.projectIds.includes(projectId)) return this.refresh();
    void this.host
      .projects()
      .then((projects) => {
        this.projectIds = projects.map((p) => p.id);
        this.refresh();
      })
      .catch(() => {});
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
    return (
      (this.projectIds ?? [])
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
        .map(summary)
        // Ties included, the order a phone rebuilds a patched list in.
        .sort(chatOrder)
    );
  }
}

const messageActivity = (m: ChatMessage | undefined): AgentActivity[] =>
  m?.trace
    ? m.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (m?.activity ?? []);

/**
 * Tool output is most of a thread's weight (8.5 of 11.9 MB over 40 real
 * threads), and the phone shows it only in a fold you open; it gets the
 * start and the end, and `activityDetail` the rest when the fold opens.
 */
function cutDetail(a: AgentActivity): AgentActivity {
  const detail = a.detail;
  if (!detail || detail.length <= phoneDetailPreview) return a;
  const half = phoneDetailPreview / 2;
  return {
    ...a,
    detail: `${detail.slice(0, half)}\n…\n${detail.slice(-half)}`,
    detailCut: detail.length - phoneDetailPreview,
  };
}

export function forPhone(m: ChatMessage): ChatMessage {
  if (m.trace)
    return {
      ...m,
      trace: m.trace.map((e) =>
        e.kind === "activity" ? { ...e, activity: cutDetail(e.activity) } : e,
      ),
    };
  if (m.activity) return { ...m, activity: m.activity.map(cutDetail) };
  return m;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** An agent's run, its tool output cut as a thread's; the phone has no `activityDetail` for it. */
function forPhoneRun(run: SubagentDetail): SubagentDetail {
  return {
    ...run,
    trace: run.trace.map((e) => {
      if (e.kind !== "activity") return e;
      const { detailCut: _, ...activity } = cutDetail(e.activity);
      return { ...e, activity };
    }),
  };
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
    ...(c.asking ? { asking: true } : {}),
    ...(c.blocked ? { blocked: true } : {}),
    ...(c.settledAt ? { settledAt: c.settledAt } : {}),
    ...(c.autoSettled ? { autoSettled: true } : {}),
    ...(c.markedUnread ? { markedUnread: true } : {}),
    ...(c.seenAt ? { seenAt: c.seenAt } : {}),
    ...(c.snoozedUntil
      ? { snoozedUntil: c.snoozedUntil, snoozedAt: c.snoozedAt }
      : {}),
    ...(c.branch ? { branch: c.branch } : {}),
    ...(c.worktree ? { worktree: true } : {}),
    ...(c.pending?.length ? { pending: c.pending } : {}),
    ...(c.nextSend ? { nextSend: c.nextSend } : {}),
    ...(c.queueMark ? { queueMark: c.queueMark } : {}),
    ...(c.empty ? { empty: true } : {}),
    ...(c.goal ? { goal: c.goal } : {}),
    ...(c.startedBy ? { startedBy: c.startedBy } : {}),
    ...(c.limitResume ? { limitResume: c.limitResume } : {}),
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
