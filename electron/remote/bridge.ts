import { structuredPatch } from "diff";
import { z } from "zod";
import {
  agentResponseSchema,
  runtimeModeSchema,
} from "../../shared/agent-modes";
import type { AgentResponse } from "../../shared/agent-modes";
import {
  agentMentionPattern,
  agentProviderSchema,
  type AgentProvider,
} from "../../shared/agents";
import { chatIsEmpty } from "../../shared/chat-activity";
import {
  knownMessagesSchema,
  type ChatMessage,
  type ChatSummary,
  type ChatTriage,
  type KnownMessages,
  type Project,
  type ProjectChatPatch,
  type ProjectChatSend,
} from "../../shared/projects";
import {
  remoteHistory,
  type RemoteApi,
  type RemoteChatSummary,
  type RemoteDiff,
  type RemoteDiffLine,
  type RemoteEvent,
  type RemoteMethod,
} from "../../shared/remote";
import { idSchema } from "../../shared/rooms";
import {
  codexQuestionChoice,
  type AISettings,
  type ModelChoice,
} from "../../shared/settings";
import type { FilePair } from "../../shared/types";

/** What the bridge needs from the desktop; main.ts wires it to the real services. */
export interface RemoteHost {
  projects(): Promise<Project[]>;
  projectPath(projectId: string): string;
  chats(projectId: string): ChatSummary[];
  chat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  create(projectId: string): Promise<ChatSummary>;
  send(id: string, input: ProjectChatSend): Promise<void>;
  cancel(id: string): Promise<void>;
  respond(id: string, requestId: string, response: AgentResponse): void;
  turnDiff(chatId: string, messageId: string, path: string): Promise<FilePair>;
  triage(id: string, triage: ChatTriage): Promise<unknown>;
  aiSettings(): AISettings;
  name(): string;
}

const bodySchema = z.string().trim().min(1).max(32000);
const pathSchema = z.string().min(1).max(1000);
const maxDiffLines = 3000;
/** Streaming answers go out at most this often; the phone doesn't need every token. */
const streamMs = 150;

/** The phone's API: a fixed set of thread actions, each validated here. */
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
  private api: RemoteApi = {
    overview: async () => {
      const projects = await this.host.projects();
      this.projectIds = projects.map((p) => p.id);
      return {
        name: this.host.name(),
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.scratch ? { scratch: true } : {}),
          ...(p.plain ? { plain: true } : {}),
        })),
        chats: this.summaries(),
      };
    },
    chat: async (id, known) => {
      const patch = await this.host.chat(id, known);
      const summary = this.host.chats(patch.projectId).find((c) => c.id === id);
      const last = patch.lastInput;
      return {
        id: patch.id,
        projectId: patch.projectId,
        title: patch.title,
        messages: patch.messages.slice(-remoteHistory),
        earlier: Math.max(0, patch.messages.length - remoteHistory),
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
        })),
        ...(last
          ? {
              agent: {
                provider: last.provider,
                runtimeMode: last.runtimeMode,
              },
            }
          : {}),
      };
    },
    send: async (chatId, message) => {
      const { lastInput } = await this.host.chat(chatId);
      const provider =
        lastInput?.provider ?? this.host.aiSettings().threadProvider;
      await this.host.send(chatId, {
        id: message.id,
        body: addressed(message.body, provider),
        provider,
        // The phone goes on with the thread's agent, model and modes as last sent.
        choice: lastInput?.choice ?? this.defaultChoice(provider),
        runtimeMode: lastInput?.runtimeMode ?? "full-access",
        interactionMode: lastInput?.interactionMode ?? "default",
        ...(lastInput?.contextWindow
          ? { contextWindow: lastInput.contextWindow }
          : {}),
        ...(message.parentId ? { parentId: message.parentId } : {}),
      });
      this.refresh();
    },
    startChat: async (projectId, input) => {
      const chat = await this.host.create(projectId);
      await this.host.send(chat.id, {
        id: input.id,
        body: addressed(input.body, input.provider),
        provider: input.provider,
        choice: this.defaultChoice(input.provider),
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
      });
      this.refresh();
      return summary(
        this.host.chats(projectId).find((c) => c.id === chat.id) ?? chat,
      );
    },
    stop: (chatId) => this.host.cancel(chatId),
    respond: async (chatId, requestId, response) => {
      this.host.respond(chatId, requestId, response);
      this.refresh();
    },
    turnDiff: async (chatId, messageId, path) =>
      toRemoteDiff(path, await this.host.turnDiff(chatId, messageId, path)),
    settle: async (chatId, settled) => {
      await this.host.triage(chatId, { kind: settled ? "settle" : "unsettle" });
      this.refresh();
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
        );
      case "send":
        return a.send(
          idSchema.parse(args[0]),
          z
            .object({
              id: idSchema,
              body: bodySchema,
              parentId: idSchema.optional(),
            })
            .strict()
            .parse(args[1]),
        );
      case "startChat":
        return a.startChat(
          idSchema.parse(args[0]),
          z
            .object({
              id: idSchema,
              body: bodySchema,
              provider: agentProviderSchema,
              runtimeMode: runtimeModeSchema,
            })
            .strict()
            .parse(args[1]),
        );
      case "stop":
        return a.stop(idSchema.parse(args[0]));
      case "respond":
        return a.respond(
          idSchema.parse(args[0]),
          idSchema.parse(args[1]),
          agentResponseSchema.parse(args[2]),
        );
      case "turnDiff":
        return a.turnDiff(
          idSchema.parse(args[0]),
          idSchema.parse(args[1]),
          pathSchema.parse(args[2]),
        );
      case "settle":
        return a.settle(idSchema.parse(args[0]), z.boolean().parse(args[1]));
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
  private defaultChoice(provider: AgentProvider): ModelChoice {
    // An empty model follows the project's defaults, as the desktop's Default does.
    return provider === "codex"
      ? codexQuestionChoice(this.host.aiSettings())
      : { model: "", fast: false, reasoningEffort: "" };
  }
}

/** Only a leading mention makes an agent answer; the desktop's composer adds it the same way. */
const addressed = (body: string, provider: AgentProvider) =>
  agentMentionPattern.test(body) ? body : `@${provider} ${body}`;

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
    ...(c.snoozedUntil
      ? { snoozedUntil: c.snoozedUntil, snoozedAt: c.snoozedAt }
      : {}),
    ...(c.branch ? { branch: c.branch } : {}),
    ...(c.worktree ? { worktree: true } : {}),
    ...(c.pending?.length ? { pending: c.pending } : {}),
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
