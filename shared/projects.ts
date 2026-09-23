import {
  runtimeModeSchema,
  interactionModeSchema,
  type AgentRequest,
  type AgentResponse,
} from "./agent-modes";
import { lineQuestionSchema } from "./questions";
import { z } from "zod";
import { idSchema } from "./rooms";
import { aiSettingsSchema } from "./settings";
import { refSchema, filePathSchema } from "./validation";
import type { FilePair, LocalFile, Page, Issue, Repo } from "./types";
import type { GitAction, WorkingTree, ChangeArea } from "./working-tree";
import type {
  DeepReviewStart,
  DeepReviewState,
  FindingStatus,
  ReviewerTask,
} from "./deep-review";
export interface Project {
  /** Sidebar-only folder path; never a filesystem location. */
  folder?: string;
  id: string;
  path: string;
  name: string;
  repository: ({ server: string } & Repo) | null;
  added: number;
}
/** A project's sidebar name, typed in place. */
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Name the project.")
  .max(80)
  .refine((value) => !/[\x00-\x1f]/.test(value), "Use a plain name.");
export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("pr"), ref: refSchema }).strict(),
  // What a deep review covers is fixed when it starts; see `deepReview`.
  z.object({ kind: z.literal("review") }).strict(),
]);
export type ChatScope = z.infer<typeof chatScopeSchema>;
export interface ChatSummary {
  id: string;
  projectId: string;
  title: string;
  /** Named by the user; the prompt excerpt and generated titles never replace it. */
  renamed?: boolean;
  scope: ChatScope;
  created: number;
  updated: number;
  shared?: { roomId: string; server: string; memberId: string };
  /** Provider of the latest answer, for the activity card. */
  provider?: "codex" | "claude";
  /** No messages yet; absent on summaries saved before this field existed. */
  empty?: boolean;
  /** Settled until a newer update; see shared/chat-activity. */
  settledAt?: number;
  snoozedAt?: number;
  snoozedUntil?: number;
  /** Archived threads are hidden from the sidebar. */
  archivedAt?: number;
  /** Branch checked out when the latest message was sent. */
  branch?: string;
  /** One-shot wake-ups Relay sends itself; Claude's own copies ended when Relay closed. */
  heldWakeups?: HeldWakeup[];
  /** Work that ended when Relay closed, until picked back up or dismissed. */
  stopped?: { at: number; items: StoppedWork[] };
  /** When the earliest message scheduled with Send later goes out. */
  nextSend?: number;
  /** A deep review's reviewer; its thread shows inside the review, never on its own. */
  reviewer?: ReviewerTask;
  /** Live state added by list(); never persisted. */
  running?: boolean;
  runningSince?: number;
  waiting?: boolean;
  /** Work Claude left running that will start its next turn by itself. */
  pending?: ChatPending[];
}
export interface HeldWakeup {
  id: string;
  prompt: string;
  at: number;
  /** The reply thread whose Claude session scheduled it. */
  parentId?: string;
}
/** `parentId` is the side conversation whose Claude session ran it. */
export type StoppedWork = ChatPending & { parentId?: string };
export type ChatPending =
  | { kind: "task"; id: string; description: string; since: number }
  | {
      kind: "wakeup";
      id: string;
      prompt: string;
      recurring: boolean;
      /** When a one-shot wake-up fires. */
      at?: number;
    };
export const chatTriageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("settle") }).strict(),
  z.object({ kind: z.literal("unsettle") }).strict(),
  z
    .object({
      kind: z.literal("snooze"),
      until: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("wake") }).strict(),
  z.object({ kind: z.literal("archive") }).strict(),
]);
export type ChatTriage = z.infer<typeof chatTriageSchema>;
/** How full the provider session's context window was after this answer. */
export interface ContextUsage {
  usedTokens: number;
  maxTokens?: number;
  /** Tokens processed across the whole session, when the provider reports it. */
  totalTokens?: number;
  /** When the newest request last touched the provider's prompt cache. */
  cache?: PromptCache;
}
/** Each cache hit restarts the entry's lifetime, so it goes cold `ttlMs` after `at`. */
export interface PromptCache {
  at: number;
  ttlMs: number;
}
export type AgentProvider = "codex" | "claude";
/** Local marker: the outgoing agent wrote this note for the one taking over. */
export interface AgentHandoff {
  from: AgentProvider;
  to: AgentProvider;
}
export interface ChatMessage {
  /** Local marker: this answer compacted the provider session instead of replying. */
  compaction?: boolean;
  handoff?: AgentHandoff;
  /** Local marker: the agent started this turn itself, e.g. when a background task ended. */
  unprompted?: boolean;
  context?: ContextUsage;
  /** Local proposed-plan action; shared chats receive the final text only. */
  proposedPlan?: boolean;
  /** Local marker: the saved Codex session already received this steering prompt. */
  steered?: boolean;
  images?: ChatImage[];
  activity?: AgentActivity[];
  trace?: AgentTrace[];
  /** Local: files this turn's agent changed in the checkout, from snapshots before and after it. */
  changes?: TurnFileChange[];
  /** Local: where the agent's session stood after this answer, so a side conversation can fork from it. */
  forkPoint?: ForkPoint;
  ended?: number;
  author?: string;
  authorId?: string;
  seq?: number;
  parentId?: string | null;
  pending?: boolean;
  id: string;
  role: "user" | "assistant";
  body: string;
  status: "complete" | "streaming" | "failed" | "cancelled";
  created: number;
  provider: "codex" | "claude";
  error?: string;
  version: number;
}
/** A provider session and its last turn (Codex) or entry (Claude) to continue from. */
export interface ForkPoint {
  thread: string;
  at: string;
}
export interface TurnFileChange {
  path: string;
  additions: number;
  deletions: number;
  binary?: boolean;
  /** Local: rolled back by this snapshot, which redo restores from. */
  revertedBy?: string;
}
export interface ChatImage {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
}
const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const pastedImageSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mimeType: imageMimeSchema,
    dataUrl: z
      .string()
      .max(1_100_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export interface AgentActivity {
  id: string;
  kind: "command" | "file" | "read" | "search" | "web" | "agent" | "tool";
  label: string;
  status: "running" | "complete" | "failed";
  detail?: string;
  /** The agent call this one ran inside, when a subagent made it. */
  parentId?: string;
  /** A running agent's latest status line, e.g. "Reading auth.ts · 12 tools". */
  progress?: string;
}
/** Private turn events. Sharing serializes only the final answer body. */
export type AgentTrace =
  | { kind: "commentary"; id: string; text: string }
  | { kind: "activity"; id: string; activity: AgentActivity };
export function replyRoot(messages: ChatMessage[], id: string): ChatMessage {
  const seen = new Set<string>();
  let current = messages.find((m) => m.id === id);
  while (current?.parentId) {
    if (seen.has(current.id)) throw new Error("Invalid reply chain.");
    seen.add(current.id);
    current = messages.find((m) => m.id === current!.parentId);
  }
  if (!current)
    throw new Error("Reply target is missing from this conversation.");
  return current;
}
export interface QueuedChatMessage {
  input: ProjectChatSend;
  created: number;
  error?: string;
}
/** Sent with Send later; goes out at `at`, or queues if an answer is running. */
export interface ScheduledChatMessage extends QueuedChatMessage {
  at: number;
}
export interface ProjectChat extends ChatSummary {
  requests?: AgentRequest[];
  queue?: QueuedChatMessage[];
  scheduled?: ScheduledChatMessage[];
  queuePaused?: boolean;
  lastInput?: ProjectChatSend;
  messages: ChatMessage[];
  claudeThread?: string;
  claudeThrough?: string;
  providerThread?: string;
  providerThrough?: string;
  sharedCursor?: number;
  /** Local: checkout rollbacks the next agent turn should hear about. */
  checkoutNotes?: string[];
  /** Local: the scope each agent session last heard, by `provider:branch`. */
  scopeHeard?: Record<string, string>;
  deepReview?: DeepReviewState;
  replySessions?: Record<
    string,
    {
      thread?: string;
      through?: string;
      claudeThread?: string;
      claudeThrough?: string;
    }
  >;
}
/** Message id → version the renderer already holds. */
export type KnownMessages = Record<string, number>;
export const knownMessagesSchema = z
  .record(z.string().max(200), z.number().int().nonnegative())
  .refine((known) => Object.keys(known).length <= 20000);
/** A chat where messages the caller already holds at the same version are sent as their ids. */
export interface ProjectChatPatch extends Omit<ProjectChat, "messages"> {
  messages: (ChatMessage | string)[];
}
/** Rebuilds a patched chat, reusing the previous message objects it only named. */
export function applyChatPatch(
  patch: ProjectChatPatch,
  previous: ProjectChat | undefined,
): ProjectChat {
  const held = new Map(previous?.messages.map((m) => [m.id, m]));
  return {
    ...patch,
    messages: patch.messages.map((m) => {
      if (typeof m !== "string") return m;
      const kept = held.get(m);
      if (!kept) throw new Error("Conversation update is missing a message.");
      return kept;
    }),
  };
}
export const projectChatSendSchema = z
  .object({
    delivery: z.enum(["queue", "steer"]).optional(),
    /** Send later: hold the message until this time. */
    sendAt: z.number().int().positive().optional(),
    id: idSchema,
    body: z.string().trim().min(1).max(32000),
    choice: aiSettingsSchema.shape.questions,
    provider: z.enum(["codex", "claude"]),
    runtimeMode: runtimeModeSchema,
    interactionMode: interactionModeSchema,
    parentId: idSchema.nullable().optional(),
    viewing: filePathSchema.optional(),
    selection: lineQuestionSchema.optional(),
    images: z.array(pastedImageSchema).max(3).optional(),
    /** Deep review findings this message asks the lead to fix. */
    fixes: z
      .array(z.string().regex(/^F\d{1,3}$/))
      .max(50)
      .optional(),
  })
  .strict();
export type ProjectChatSend = z.infer<typeof projectChatSendSchema>;
export interface ProjectApi {
  respondProjectChat(
    id: string,
    requestId: string,
    response: AgentResponse,
  ): Promise<void>;
  /** `move` puts the message at `index` in the queue. Scheduled messages take `remove` and `steer`, which sends them now. */
  projectChatQueueAction(
    id: string,
    action: "remove" | "steer" | "move",
    messageId: string,
    index?: number,
  ): Promise<void>;
  resumeProjectChat(id: string): Promise<void>;
  /** Claude also takes instructions for what the summary should keep. */
  compactProjectChat(
    id: string,
    parentId?: string | null,
    instructions?: string,
  ): Promise<void>;
  /** The project's own icon as a data URL, or null to keep the folder icon. */
  projectIcon(id: string): Promise<string | null>;
  projectGroups(): Promise<string[]>;
  createProjectGroup(path: string): Promise<void>;
  renameProjectGroup(from: string, to: string): Promise<void>;
  removeProjectGroup(path: string): Promise<void>;
  moveProject(id: string, folder: string, before: string | null): Promise<void>;
  renameProject(id: string, name: string): Promise<Project>;
  /** Opens the project's folder in Finder. */
  revealProject(id: string): Promise<void>;
  setProjectChatScope(id: string, scope: ChatScope): Promise<ChatSummary>;
  triageProjectChat(id: string, triage: ChatTriage): Promise<ChatSummary>;
  renameProjectChat(id: string, title: string): Promise<ChatSummary>;
  projectCommands(
    id: string,
    provider: "codex" | "claude",
  ): Promise<import("./commands").ProviderCommand[]>;
  projectBranchPulls(
    id: string,
  ): Promise<import("./pull-request-create").BranchPull[]>;
  projectPreparePull(
    id: string,
  ): Promise<import("./pull-request-create").PullRequestPlan>;
  projectCreatePull(
    id: string,
    input: import("./pull-request-create").CreatePullRequest,
  ): Promise<import("./pull-request-create").CreatedPullRequest>;
  projectBranches(id: string): Promise<import("./branches").BranchList>;
  projectChangeBranch(
    id: string,
    action: import("./branches").BranchAction,
  ): Promise<import("./branches").BranchList>;
  /** Sends Claude what stopped when Relay closed, or forgets it. */
  resolveStoppedWork(id: string, action: "resume" | "dismiss"): Promise<void>;
  /** Stops a background task Claude left running, or cancels its wake-up. */
  stopProjectChatPending(id: string, pendingId: string): Promise<void>;
  projectChatPresence(
    id: string,
    value: { path: string | null; viewed: number; total: number } | null,
  ): Promise<import("./rooms").Presence[]>;
  joinProjectConversation(
    projectId: string,
    url: string,
  ): Promise<ChatSummary | null>;
  shareProjectChat(id: string): Promise<ChatSummary>;
  projectChatShareInfo(
    id: string,
  ): Promise<{ server: string | null; project: string; messages: number }>;
  syncProjectChat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  projectChatInvite(id: string): Promise<{ url: string; expiresAt: number }>;
  sharedProjectChats(id: string): Promise<ChatSummary[]>;
  openSharedProjectChat(
    projectId: string,
    roomId: string,
  ): Promise<ChatSummary>;

  localCheckInfo(id: string): Promise<import("./checks").ProjectCheckInfo>;
  localCheckState(
    id: string,
    head: string,
  ): Promise<import("./checks").ProjectCheckState | null>;
  startLocalChecks(
    id: string,
    head: string,
    target: string,
  ): Promise<import("./checks").ProjectCheckState>;
  stopLocalChecks(id: string): Promise<void>;
  pauseLocalChecks(id: string, paused: boolean): Promise<void>;
  updateLocalCheckBuffer(
    id: string,
    head: string,
    path: string,
    text: string | null,
  ): Promise<void>;
  inspectLocalSymbol(
    id: string,
    head: string,
    query: import("./checks").SymbolQuery,
  ): Promise<import("./checks").SymbolResult>;
  localBlame(
    id: string,
    query: import("./types").BlameQuery,
  ): Promise<import("./types").LineBlame>;

  projects(): Promise<Project[]>;
  addProject(): Promise<Project | null>;
  linkProject(id: string): Promise<Project>;
  projectFiles(id: string): Promise<string[]>;
  projectFile(id: string, path: string): Promise<LocalFile>;
  saveProjectFile(
    id: string,
    path: string,
    head: string,
    version: string,
    contents: string,
  ): Promise<{ version: string }>;
  projectWorkingTree(id: string): Promise<WorkingTree>;
  projectWorkingDiff(
    id: string,
    path: string,
    area: ChangeArea,
  ): Promise<FilePair>;
  projectGitAction(id: string, action: GitAction): Promise<WorkingTree>;
  /** One file as an agent turn left it, against how the turn found it. */
  projectTurnDiff(
    chatId: string,
    messageId: string,
    path: string,
  ): Promise<FilePair>;
  /**
   * Rolls a turn's files back, or redoes that rollback; all of them when
   * `paths` is null. Conflicts come back unwritten unless `force`.
   */
  rewindProjectTurn(
    chatId: string,
    messageId: string,
    paths: string[] | null,
    mode: "revert" | "redo",
    force: boolean,
  ): Promise<{ conflicts: string[] }>;
  projectPulls(id: string, state: string, page: number): Promise<Page<Issue>>;
  projectChats(id: string): Promise<ChatSummary[]>;
  createProjectChat(id: string, scope: ChatScope): Promise<ChatSummary>;
  projectChat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  projectChatImage(id: string, imageId: string): Promise<string>;
  sendProjectChat(id: string, input: ProjectChatSend): Promise<void>;
  cancelProjectChat(id: string): Promise<void>;
  startDeepReview(id: string, config: DeepReviewStart): Promise<void>;
  /** Runs the reviewers that didn't finish, then the lead. */
  resumeDeepReview(id: string): Promise<void>;
  setDeepReviewFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ): Promise<void>;
  /** Recent commits on the checked-out branch, newest first. */
  projectRecentCommits(id: string): Promise<{ sha: string; subject: string }[]>;
  onProjectChat(
    callback: (event: {
      chatId: string;
      message: ChatMessage;
      title?: string;
    }) => void,
  ): () => void;
}
