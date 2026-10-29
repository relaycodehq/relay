// The phone's side of this computer: the calls a phone may make, answered
// from the desktop's services, and what it hears without asking (./phone-feed).
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  knownMessagesSchema,
  projectChatSendSchema,
  type ChatMessage,
  type ProjectComputer,
} from "../../shared/projects";
import {
  phoneDesktopMethods,
  remoteBridgeVersion,
  maxRemoteHistory,
  remoteHistory,
  type ComputerMethod,
  type PhoneDesktopMethod,
  type RemoteApi,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteProjectComputer,
  type RemoteProjectIcon,
} from "../../shared/remote";
import { shortHost } from "../../shared/handoff";
import { RENDER_MAX_PAGES } from "../../shared/html-render";
import { sentAgent } from "../../shared/recipient";
import { queuedForPhone } from "../../shared/remote-queued";
import { waitedOn } from "../../shared/waiting";
import { idSchema } from "../../shared/validation";
import type { ApiMethod, FilePair } from "../../shared/types";
import type { SubagentDetail, SubagentRun } from "../../shared/subagents";
import { draftKeySchema, draftWriteSchema } from "../../shared/drafts";
import { phoneIcon } from "./svg-icon";
import { callIn, forPhone, forPhoneRun, writtenForPhone } from "./for-phone";
import { stepsAsAsked } from "./steps-left-out";
import {
  activityIdSchema,
  callIds,
  diffSourceSchema,
  imageSourceSchema,
  knownIconsSchema,
  newsCursorSchema,
  signatureSchema,
  uploadChunkSchema,
  uploadSizeSchema,
} from "./call-args";
import { diffCall, toRemoteDiff } from "./remote-diff";
import { PhoneFeed } from "./phone-feed";
import { PhoneSends } from "./phone-sends";
import type { RemoteHost } from "./remote-host";

/** The phone's API: a few calls of its own, and an allowlist of the desktop's. */
export class RemoteBridge {
  private feed: PhoneFeed;
  // Sends move thread states; phones hear before the call returns.
  private sends = new PhoneSends(() => this.refresh());

  constructor(
    private host: RemoteHost,
    broadcast: (event: RemoteEvent) => void,
  ) {
    this.feed = new PhoneFeed(host, broadcast);
  }

  /** Calls about one phone, and a computer's, go through phone-remote, which knows who asks. */
  private api: Omit<
    RemoteApi,
    | "reportApp"
    | "dictate"
    | "readAloud"
    | "saveDraft"
    | "uploadFile"
    | "sites"
    | "tunnelAllow"
    | ComputerMethod
  > = {
    overview: async () => {
      const projects = await this.host.projects();
      const chats = this.feed.overview(projects);
      return {
        name: this.host.name(),
        bridge: remoteBridgeVersion,
        ...(this.host.version ? { version: this.host.version() } : {}),
        ...(this.host.dictation
          ? { dictation: this.host.dictation.status() }
          : {}),
        ...(this.host.readAloud
          ? { readAloud: this.host.readAloud.ready() }
          : {}),
        ...(this.host.appearance?.()
          ? { appearance: this.host.appearance() }
          : {}),
        ...(this.host.drafts ? { drafts: this.host.drafts.list() } : {}),
        ...(this.host.present ? { present: this.host.present() } : {}),
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.folder ? { folder: p.folder } : {}),
          ...(p.scratch ? { scratch: true } : {}),
          ...(p.plain ? { plain: true } : {}),
          ...(p.settings?.workspace ? { workspace: p.settings.workspace } : {}),
          ...(p.computer ? { computer: this.computerOf(p.computer) } : {}),
        })),
        chats,
      };
    },
    chat: async (id, known, history = remoteHistory, sendId, steps) => {
      const dispatchedBefore =
        sendId !== undefined && this.sends.dispatching(id, sendId);
      const patch = await this.host.chat(id, known);
      const cost = await this.host.cost?.(id);
      const summary = this.host.chats(patch.projectId).find((c) => c.id === id);
      const last = patch.lastInput;
      return {
        id: patch.id,
        projectId: patch.projectId,
        title: patch.title,
        scope: patch.scope,
        ...(sendId !== undefined
          ? this.sends.receipt(patch, sendId, dispatchedBefore)
          : {}),
        messages: stepsAsAsked(
          patch.messages.slice(-history),
          steps,
          known,
        ).map((m) => (typeof m === "string" ? m : forPhone(m))),
        earlier: Math.max(0, patch.messages.length - history),
        ...(cost ? { cost } : {}),
        requests: patch.requests,
        queuePaused: patch.queuePaused,
        running: !!summary?.running,
        root:
          patch.worktree?.path && !patch.worktree.removedAt
            ? patch.worktree.path
            : this.host.projectPath(patch.projectId),
        queue: (patch.queue ?? []).map((q) => queuedForPhone(q)),
        scheduled: (patch.scheduled ?? []).map((q) => ({
          ...queuedForPhone(q),
          at: q.at,
        })),
        ...(patch.worktree ? { worktree: patch.worktree } : {}),
        ...(patch.workspaceMoves?.length
          ? { workspaceMoves: patch.workspaceMoves }
          : {}),
        ...(patch.stopped ? { stopped: patch.stopped } : {}),
        ...(summary?.pending ? { pending: waitedOn(summary.pending) } : {}),
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
    messageSteps: async (chatId, messageId) => {
      const message = (await this.host.chat(chatId)).messages.find(
        (m): m is ChatMessage => typeof m !== "string" && m.id === messageId,
      );
      if (!message) return null;
      const { trace, activity, traceDropped } = forPhone(message);
      return { trace, activity, traceDropped };
    },
    activityDetail: async (chatId, messageId, id) =>
      callIn(await this.host.chat(chatId), messageId, id)?.detail ?? null,
    activityWritten: async (chatId, messageId, id) =>
      writtenForPhone(callIn(await this.host.chat(chatId), messageId, id)),
    image: async (source, max) => {
      const dataUrl = (await this.host.dispatch(
        ...((source.kind === "attached"
          ? ["projectChatImage", [source.chatId, source.imageId]]
          : source.kind === "preview"
            ? ["projectChatPreviewShot", [source.chatId, source.messageId]]
            : [
                "projectChatReadImage",
                [source.chatId, source.messageId, source.path],
              ]) as [ApiMethod, unknown[]]),
      )) as string;
      return this.host.shrinkImage?.(dataUrl, max) ?? dataUrl;
    },
    news: async (cursor) => {
      if (!this.host.news) throw new Error("This desktop keeps no news.");
      return this.host.news(cursor);
    },
    renderPage: async (chatId, renderId, page) => {
      if (!this.host.renderPage)
        throw new Error("This desktop can't show pages.");
      return this.host.renderPage(chatId, renderId, page);
    },
    diff: async (source) => {
      const [method, args] = diffCall(source);
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
      if (method === "sendProjectChat")
        return this.sends.once(
          idSchema.parse(args[0]),
          projectChatSendSchema.parse(args[1]).id,
          () => this.host.dispatch(method, args),
        );
      // A phone inspects this computer's agent tools; a third argument would pass it on to another.
      if (method === "agentTools") args = args.slice(0, 2);
      // A phone's card can lag the live turn; settled while it runs, it settles once it ends. Done already, it's a plain settle.
      if (
        method === "triageProjectChat" &&
        (args[1] as { kind?: unknown } | undefined)?.kind === "settle"
      )
        args = [args[0], { kind: "settle-when-done" }];
      let value = await this.host.dispatch(method, args);
      if (method === "projectChatAgent" && value)
        value = forPhoneRun(value as SubagentDetail);
      // Stops and triage move thread states; phones hear before the call returns.
      this.refresh();
      return value;
    },
    draftOther: async (key, drop) => this.requireDrafts().other(key, drop),
    sendDraft: async (key, chatId, send) => {
      const drafts = this.requireDrafts();
      // A new thread has no chat id yet. Keep its result under the draft key,
      // including after sending has removed the draft and its desktop extras.
      if (!chatId)
        return this.sends.once(`draft:${key}`, send.id, async () => {
          if (!drafts.holds(key))
            throw new Error(
              "This draft changed on the computer. Check it and send it again.",
            );
          return drafts.sendHeld(key, undefined, send);
        });
      // Nothing of the desktop's left in it: it goes as any send does.
      if (!drafts.holds(key)) {
        await this.api.desktop("sendProjectChat", [chatId, send]);
        return { chatId };
      }
      return this.sends
        .once(chatId, send.id, () => drafts.sendHeld(key, chatId, send))
        .then(() => ({ chatId }));
    },
    projectIcons: async (known) => {
      const projects = await this.host.projects();
      const changed: Record<string, RemoteProjectIcon> = {};
      // A few at a time: the first look walks each project's folders.
      for (let i = 0; i < projects.length; i += 4)
        await Promise.all(
          projects.slice(i, i + 4).map(async ({ id }) => {
            const icon = (await this.host
              .dispatch("projectIcon", [id])
              .catch(() => null)) as string | null;
            const dataUrl = icon && (await phoneIcon(icon));
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

  private requireDrafts() {
    if (!this.host.drafts) throw new Error("This computer keeps no drafts.");
    return this.host.drafts;
  }

  /** `deviceId` is the phone asking, which a draft it writes names. */
  async handle(
    method: RemoteMethod,
    args: unknown[],
    deviceId?: string,
  ): Promise<unknown> {
    const a = this.api;
    switch (method) {
      case "saveDraft":
        if (!deviceId) throw new Error("Only a phone can do that.");
        return this.requireDrafts().write(
          draftWriteSchema.parse(args[0]),
          `phone:${deviceId}`,
        );
      case "uploadFile":
        if (!this.host.uploadFile)
          throw new Error("This computer can't take files.");
        return this.host.uploadFile(...uploadArgs(args));
      case "draftOther":
        return a.draftOther(
          draftKeySchema.parse(args[0]),
          z.boolean().parse(args[1]),
        );
      case "sendDraft":
        return a.sendDraft(
          draftKeySchema.parse(args[0]),
          args[1] == null ? null : idSchema.parse(args[1]),
          projectChatSendSchema.parse(args[2]),
        );
      case "overview":
        return a.overview();
      case "chat":
        return a.chat(...chatArgs(args));
      case "activityDetail":
      case "activityWritten":
        return a[method](...callIds(args));
      case "messageSteps":
        return a.messageSteps(idSchema.parse(args[0]), idSchema.parse(args[1]));
      case "diff":
        return a.diff(diffSourceSchema.parse(args[0]));
      case "image":
        return a.image(
          imageSourceSchema.parse(args[0]),
          z.number().int().min(16).max(4096).parse(args[1]),
        );
      case "news":
        return a.news(
          args[0] == null ? undefined : newsCursorSchema.parse(args[0]),
        );
      case "renderPage":
        return a.renderPage(...renderPageArgs(args));
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
      default:
        throw new Error("Phones can't do that.");
    }
  }

  /** Relays a chat event; see ./phone-feed. */
  chatEvent(event: { chatId: string; message: ChatMessage; title?: string }) {
    this.feed.chatEvent(event);
  }

  /** Follows thread states while a phone is connected. */
  setWatching(watching: boolean) {
    this.feed.setWatching(watching);
  }

  /** A project's thread list changed. */
  chatsChanged(projectId: string) {
    this.feed.chatsChanged(projectId);
  }

  /** Tells phones when a thread starts, finishes, or starts waiting on them. */
  refresh() {
    this.feed.refresh();
  }

  /** Someone came to the computer or left it. */
  presenceChanged() {
    this.feed.presenceChanged();
  }

  dispose() {
    this.feed.dispose();
  }

  /** Where a project on another computer lives, by that computer's name now. */
  private computerOf(computer: ProjectComputer): RemoteProjectComputer {
    const paired = this.host.pairedComputers?.();
    const now = paired?.find((c) => c.id === computer.id);
    return {
      name: shortHost(now?.name ?? computer.name),
      ...(paired && !now ? { gone: true as const } : {}),
    };
  }
}

/** A thread's id, what the phone holds of it, how many messages it wants, the send it waits on and which turns' steps. */
function chatArgs(args: unknown[]): Parameters<RemoteApi["chat"]> {
  return [
    idSchema.parse(args[0]),
    args[1] == null ? undefined : knownMessagesSchema.parse(args[1]),
    args[2] == null
      ? undefined
      : z.number().int().min(1).max(maxRemoteHistory).parse(args[2]),
    args[3] == null ? undefined : idSchema.parse(args[3]),
    args[4] == null ? undefined : z.enum(["all", "latest"]).parse(args[4]),
  ];
}

/** The upload's id, the file's name, its size, where this chunk goes in it and the chunk. */
function uploadArgs(
  args: unknown[],
): Parameters<NonNullable<RemoteHost["uploadFile"]>> {
  return [
    idSchema.parse(args[0]),
    z.string().min(1).max(1000).parse(args[1]),
    uploadSizeSchema.parse(args[2]),
    uploadSizeSchema.parse(args[3]),
    Buffer.from(uploadChunkSchema.parse(args[4]), "base64"),
  ];
}

/** The thread, the page an answer showed and which of its pages. */
function renderPageArgs(args: unknown[]): Parameters<RemoteApi["renderPage"]> {
  return [
    idSchema.parse(args[0]),
    idSchema.parse(args[1]),
    z
      .number()
      .int()
      .min(0)
      .max(RENDER_MAX_PAGES - 1)
      .parse(args[2]),
  ];
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
