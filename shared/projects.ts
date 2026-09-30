import {
  runtimeModeSchema,
  interactionModeSchema,
  type AgentRequest,
  type AgentResponse,
} from "./agent-modes";
import { lineQuestionSchema } from "./questions";
import { z } from "zod";
import { agentProviderSchema, type AgentProvider } from "./agents";
import { idSchema } from "./rooms";
import { aiSettingsSchema } from "./settings";
import { refSchema, filePathSchema } from "./validation";
import type { TurnModel } from "./turn-model";
import type { DirListing, FileInfo } from "./project-files";
import type { FilePair, LocalFile, Page, Issue, Repo } from "./types";
import type { GitAction, WorkingTree, ChangeArea } from "./working-tree";
import type {
  DeepReviewStart,
  DeepReviewState,
  FindingStatus,
  ReviewerTask,
} from "./deep-review";
import {
  ultraplanKindSchema,
  type ThinkerTask,
  type UltraplanState,
} from "./ultraplan";
export interface Project {
  /** Sidebar-only folder path; never a filesystem location. */
  folder?: string;
  id: string;
  path: string;
  name: string;
  repository: ({ server: string } & Repo) | null;
  added: number;
  /** Live: the folder isn't a Git repository, so it has no branches, changes or history. Never saved. */
  plain?: true;
  /** A Scratchpad chat's own folder in Relay's data, listed under Scratchpad instead of Projects. */
  scratch?: true;
}
/** `relay-releases` → `Relay Releases`; letters after the first stay as typed. */
export const projectTitle = (folder: string) =>
  folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ") || folder;
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
/** Where a new thread works: the project's own checkout, or a worktree of its own. */
export const chatWorkspaceSchema = z.enum(["checkout", "worktree"]);
export type ChatWorkspace = z.infer<typeof chatWorkspaceSchema>;
/** A thread that works in its own git worktree, leaving the checkout alone. */
export interface ChatWorktree {
  /** Unset until the first message makes the worktree. */
  path?: string;
  branch?: string;
  /** The checkout's branch it was made from; its changes are what that branch lacks. */
  from?: string;
  /** The checkout's commit when the worktree was made. */
  head?: string;
  /** Where its branch starts: `head`, or for older worktrees a snapshot of the checkout's uncommitted edits. */
  start?: string;
  /** Older worktrees count their changes from here instead of from `from`. */
  base?: string;
  /** Its PR was merged on the Git host. Older worktrees may hold other values. */
  landed?: { at: number; by: string };
  pr?: { number: number; url: string };
  /** Removed; the next message makes a fresh one from the checkout. */
  removedAt?: number;
}
export interface AgentWorktree {
  path: string;
  branch?: string;
  /** When Relay first saw it. */
  at: number;
}
export interface WorktreeStatus {
  branch?: string;
  path?: string;
  /** The branch it merges into. */
  from?: string;
  /** What it has that `from` doesn't yet, committed or not. */
  files: TurnFileChange[];
  /** Everything it committed is in `from` now, or its PR was merged. */
  landed?: { by: "merge" | "pr" };
  pr?: ChatWorktree["pr"];
  removed: boolean;
}
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
  provider?: AgentProvider;
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
  /** Set on threads that work in their own worktree; fixed when the thread starts. */
  worktree?: ChatWorktree;
  /** Worktrees the agent made itself with git, still on disk when last checked. */
  agentWorktrees?: AgentWorktree[];
  /** One-shot wake-ups Relay sends itself; Claude's own copies ended when Relay closed. */
  heldWakeups?: HeldWakeup[];
  /** Work that ended when Relay closed, until picked back up or dismissed. */
  stopped?: { at: number; items: StoppedWork[] };
  /** When the earliest message scheduled with Send later goes out. */
  nextSend?: number;
  /** A deep review's reviewer; its thread shows inside the review, never on its own. */
  reviewer?: ReviewerTask;
  /** An Ultraplan's thinker; its thread shows inside the council, never on its own. */
  thinker?: ThinkerTask;
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
  | {
      kind: "task";
      id: string;
      description: string;
      since: number;
      /** A subagent or workflow, which reports back, unlike a dev server. */
      agent?: boolean;
    }
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
export type { AgentProvider };
/** Local marker: the outgoing agent wrote this note for the one taking over. */
interface AgentHandoff {
  from: AgentProvider;
  to: AgentProvider;
}
export interface ChatMessage {
  /** Local marker: this answer compacted the provider session instead of replying. */
  compaction?: boolean;
  /** Local: what a compaction left the agent with, when the provider hands it back readable. */
  compactSummary?: string;
  handoff?: AgentHandoff;
  /** Local marker: the lead's brief for an Ultraplan council, shown inside it. */
  brief?: boolean;
  /** Local marker: the agent started this turn itself, e.g. when a background task ended. */
  unprompted?: boolean;
  context?: ContextUsage;
  /** Local: the model and settings this answer ran on. */
  model?: TurnModel;
  /** Local proposed-plan action; shared chats receive the final text only. */
  proposedPlan?: boolean;
  /** Local marker: the saved Codex session already received this steering prompt. */
  steered?: boolean;
  /**
   * Local marker: a `/btw` question, asked beside the main conversation. It
   * roots a side thread its agent answers without changing anything, and the
   * main session never hears it.
   */
  side?: boolean;
  images?: ChatImage[];
  activity?: AgentActivity[];
  trace?: AgentTrace[];
  /** Local: files this turn's agent changed in the checkout, from snapshots before and after it. */
  changes?: TurnFileChange[];
  /** Local: where the agent's session stood after this answer, so a side conversation can fork from it. */
  forkPoint?: ForkPoint;
  /** Local: the turn failed because Claude's login expired or was revoked. */
  signIn?: "claude";
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
  provider: AgentProvider;
  error?: string;
  version: number;
}
/** A provider session and the point in it (a turn, entry or message) to continue from. */
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
export const isImagePath = (path: string) =>
  /\.(?:png|jpe?g|gif|webp)$/i.test(path);
/** Images the agent looked at during a turn, subagents included, by path in first-read order. */
export function turnImages(message: ChatMessage): string[] {
  const calls = message.trace
    ? message.trace.flatMap((e) => (e.kind === "activity" ? [e.activity] : []))
    : (message.activity ?? []);
  return [
    ...new Set(
      calls
        .filter(
          (a) =>
            a.kind === "read" &&
            a.status === "complete" &&
            isImagePath(a.label),
        )
        .map((a) => a.label),
    ),
  ];
}
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
interface QueuedChatMessage {
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
  /** Each agent's session on the main conversation. */
  sessions?: AgentSessions;
  /** Local: a forked thread's last copied answer, whose session its agent continues. */
  forkedAt?: string;
  sharedCursor?: number;
  /** Local: checkout rollbacks the next agent turn should hear about. */
  checkoutNotes?: string[];
  /** Local: the scope each agent session last heard, by `provider:branch`. */
  scopeHeard?: Record<string, string>;
  deepReview?: DeepReviewState;
  /** Ultraplan councils, by the user message each one works on. */
  ultraplans?: Record<string, UltraplanState>;
  /** Each agent's session on a side conversation, by its root message. */
  replySessions?: Record<string, AgentSessions>;
}
/** An agent's session on a conversation, and the last message it heard there. */
export interface AgentSession {
  thread?: string;
  through?: string;
}
type AgentSessions = Partial<Record<AgentProvider, AgentSession>>;
/**
 * Saves from before the agent registry kept Claude's session and Codex's
 * (`provider…`, or bare on a side conversation) in fields of their own.
 */
export function migrateAgentSessions(chat: ProjectChat): boolean {
  type Legacy = {
    claudeThread?: string;
    claudeThrough?: string;
    providerThread?: string;
    providerThrough?: string;
    thread?: string;
    through?: string;
  };
  let changed = false;
  const move = (
    from: Legacy,
    to: AgentSessions,
    provider: AgentProvider,
    thread: "claudeThread" | "providerThread" | "thread",
    through: "claudeThrough" | "providerThrough" | "through",
  ) => {
    if (!(thread in from) && !(through in from)) return;
    const session: AgentSession = {
      ...(from[thread] ? { thread: from[thread] } : {}),
      ...(from[through] ? { through: from[through] } : {}),
    };
    if (session.thread || session.through) to[provider] ??= session;
    delete from[thread];
    delete from[through];
    changed = true;
  };
  const main = chat as ProjectChat & Legacy;
  const sessions = main.sessions ?? {};
  move(main, sessions, "claude", "claudeThread", "claudeThrough");
  move(main, sessions, "codex", "providerThread", "providerThrough");
  if (Object.keys(sessions).length) main.sessions = sessions;
  for (const [root, side] of Object.entries(chat.replySessions ?? {})) {
    const legacy = side as AgentSessions & Legacy;
    const next: AgentSessions = { ...side };
    delete (next as Legacy).claudeThread;
    delete (next as Legacy).claudeThrough;
    delete (next as Legacy).thread;
    delete (next as Legacy).through;
    move(legacy, next, "claude", "claudeThread", "claudeThrough");
    move(legacy, next, "codex", "thread", "through");
    chat.replySessions![root] = next;
  }
  return changed;
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
    /** Claude on a 200k window; left out, the CLI picks (1M on most models). */
    contextWindow: z.literal("200k").optional(),
    provider: agentProviderSchema,
    runtimeMode: runtimeModeSchema,
    interactionMode: interactionModeSchema,
    parentId: idSchema.nullable().optional(),
    /** Asks `/btw`: starts a side thread instead of a turn of the main one. */
    side: z.literal(true).optional(),
    viewing: filePathSchema.optional(),
    selection: lineQuestionSchema.optional(),
    images: z.array(pastedImageSchema).max(3).optional(),
    /** Plan this with a council of thinkers first; see shared/ultraplan. */
    ultraplan: ultraplanKindSchema.optional(),
    /** Deep review findings this message asks the lead to fix. */
    fixes: z
      .array(z.string().regex(/^F\d{1,3}$/))
      .max(50)
      .optional(),
  })
  .strict();
export type ProjectChatSend = z.infer<typeof projectChatSendSchema>;
/** Which agent carries on a stopped answer, and how; see resumeProjectChat. */
export const resumeSettingsSchema = projectChatSendSchema
  .pick({
    provider: true,
    choice: true,
    contextWindow: true,
    runtimeMode: true,
    interactionMode: true,
  })
  .strict();
export type ResumeSettings = z.infer<typeof resumeSettingsSchema>;
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
  /** Left out, the agent and settings of the stopped answer's message carry on. */
  resumeProjectChat(id: string, settings?: ResumeSettings): Promise<void>;
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
  /** Places a group before sibling `before`, or last among its siblings. */
  moveProjectGroup(path: string, before: string | null): Promise<void>;
  moveProject(id: string, folder: string, before: string | null): Promise<void>;
  renameProject(id: string, name: string): Promise<Project>;
  /** Opens the project's folder in Finder. */
  revealProject(id: string): Promise<void>;
  triageProjectChat(id: string, triage: ChatTriage): Promise<ChatSummary>;
  renameProjectChat(id: string, title: string): Promise<ChatSummary>;
  /** A new thread holding the conversation up to this answer. */
  forkProjectChat(id: string, messageId: string): Promise<ChatSummary>;
  projectCommands(
    id: string,
    provider: AgentProvider,
  ): Promise<import("./commands").ProviderCommand[]>;
  projectBranchPulls(
    where: string,
  ): Promise<import("./pull-request-create").BranchPull[]>;
  /** CI on the thread's branch (its worktree's, with `chatId`); null when there's none to show. */
  projectCiStatus(
    id: string,
    chatId?: string,
  ): Promise<import("./ci").CiStatus | null>;
  /** `where` is a workspace id: a thread's worktree opens its PR from its own branch. */
  projectPreparePull(
    where: string,
  ): Promise<import("./pull-request-create").PullRequestPlan>;
  projectCreatePull(
    where: string,
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
  /** The subagents Claude started in the thread's live sessions. */
  projectChatAgents(id: string): Promise<import("./subagents").SubagentRun[]>;
  /** One agent's whole run; null once its session is gone. */
  projectChatAgent(
    id: string,
    agentId: string,
  ): Promise<import("./subagents").SubagentDetail | null>;
  /** Stops one agent; Claude hears it was stopped. */
  stopProjectChatAgent(id: string, agentId: string): Promise<void>;
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

  // Calls taking `where` accept a workspace id (see shared/workspaces.ts):
  // the checkout, or a thread's worktree.
  localCheckInfo(where: string): Promise<import("./checks").ProjectCheckInfo>;
  localCheckState(
    where: string,
    head: string,
  ): Promise<import("./checks").ProjectCheckState | null>;
  startLocalChecks(
    where: string,
    head: string,
    target: string,
  ): Promise<import("./checks").ProjectCheckState>;
  stopLocalChecks(where: string): Promise<void>;
  pauseLocalChecks(where: string, paused: boolean): Promise<void>;
  updateLocalCheckBuffer(
    where: string,
    head: string,
    path: string,
    text: string | null,
  ): Promise<void>;
  inspectLocalSymbol(
    where: string,
    head: string,
    query: import("./checks").SymbolQuery,
  ): Promise<import("./checks").SymbolResult>;
  localBlame(
    where: string,
    query: import("./types").BlameQuery,
  ): Promise<import("./types").LineBlame>;

  projects(): Promise<Project[]>;
  addProject(): Promise<Project | null>;
  /** The Scratchpad project for a new chat: the unused one, or a fresh folder. */
  createScratch(): Promise<Project>;
  /** Threads in every Scratchpad folder, in one list for the sidebar. */
  scratchChats(): Promise<ChatSummary[]>;
  linkProject(id: string): Promise<Project>;
  projectFiles(where: string): Promise<string[]>;
  projectFile(where: string, path: string): Promise<LocalFile>;
  /** One level of a folder from disk ("" is the root), ignored files included. */
  projectDirectory(where: string, dir: string): Promise<DirListing>;
  projectFileInfo(where: string, path: string): Promise<FileInfo>;
  /** An image file as a data URL. */
  projectImage(where: string, path: string): Promise<string>;
  /** An image scaled down for a grid; small ones and vector ones as they are. */
  projectThumbnail(where: string, path: string): Promise<string>;
  /** Opens a folder in Finder, or selects a file in its folder; "" is the root. */
  revealProjectPath(where: string, path: string): Promise<void>;
  /** Opens a file in the app the system picks for it. */
  openProjectPath(where: string, path: string): Promise<void>;
  createProjectEntry(
    where: string,
    path: string,
    kind: "file" | "dir",
  ): Promise<void>;
  renameProjectEntry(where: string, from: string, to: string): Promise<void>;
  /** Moves to the Trash, so it can be put back. */
  trashProjectEntry(where: string, path: string): Promise<void>;
  saveProjectFile(
    where: string,
    path: string,
    head: string,
    version: string,
    contents: string,
  ): Promise<{ version: string }>;
  projectWorkingTree(where: string): Promise<WorkingTree>;
  projectWorkingDiff(
    where: string,
    path: string,
    area: ChangeArea,
  ): Promise<FilePair>;
  projectGitAction(where: string, action: GitAction): Promise<WorkingTree>;
  /** A generated message for committing just these changed files. */
  projectCommitMessage(where: string, paths: string[]): Promise<string>;
  /** A model's split of every uncommitted change into commits, not yet made. */
  projectPlanCommitSplit(
    where: string,
    note?: string,
  ): Promise<import("./commit-split").CommitSplitPlan>;
  projectApplyCommitSplit(
    where: string,
    split: import("./commit-split").ApplyCommitSplit,
  ): Promise<WorkingTree>;
  /** Merging the current branch into `base`, the default branch when omitted. */
  projectMergePlan(
    where: string,
    base?: string,
  ): Promise<import("./branch-merge").MergePlan>;
  projectMergeBranch(
    where: string,
    input: import("./branch-merge").MergeBranch,
  ): Promise<import("./branch-merge").MergeResult>;
  projectDeleteBranch(where: string, name: string): Promise<void>;
  /** Merges `base` into the current branch; conflicts stay marked in its folder. */
  projectCatchUp(where: string, base: string): Promise<{ conflicts: string[] }>;
  projectHistory(
    where: string,
    scope: import("./history").HistoryScope,
    limit: number,
  ): Promise<import("./history").CommitLog>;
  projectCommit(
    where: string,
    sha: string,
  ): Promise<import("./history").CommitDetail>;
  /** One file as a commit left it, against its first parent. */
  projectCommitDiff(
    where: string,
    sha: string,
    path: string,
  ): Promise<FilePair>;
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
  createProjectChat(
    id: string,
    scope: ChatScope,
    workspace?: ChatWorkspace,
  ): Promise<ChatSummary>;
  projectWorktree(chatId: string): Promise<WorktreeStatus>;
  /** One file as the worktree has it, against where its branch forks. */
  projectWorktreeDiff(chatId: string, path: string): Promise<FilePair>;
  removeProjectWorktree(chatId: string): Promise<void>;
  revealProjectWorktree(chatId: string): Promise<void>;
  /** Opens a worktree the thread's agent made, by its path in `agentWorktrees`. */
  revealAgentWorktree(chatId: string, path: string): Promise<void>;
  projectChat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  projectChatImage(id: string, imageId: string): Promise<string>;
  /** An image file the agent read during the turn `messageId`, as a data URL. */
  projectChatReadImage(
    id: string,
    messageId: string,
    path: string,
  ): Promise<string>;
  /** Shows that image file in Finder. */
  revealProjectChatReadImage(
    id: string,
    messageId: string,
    path: string,
  ): Promise<void>;
  /** Shows a file a turn changed in Finder; a null `messageId` means a worktree file. */
  revealProjectTurnFile(
    chatId: string,
    messageId: string | null,
    path: string,
  ): Promise<void>;
  sendProjectChat(id: string, input: ProjectChatSend): Promise<void>;
  cancelProjectChat(id: string): Promise<void>;
  startDeepReview(id: string, config: DeepReviewStart): Promise<void>;
  /** Runs the council's thinkers that didn't finish, then the lead. */
  resumeUltraplan(id: string, request: string): Promise<void>;
  /** Runs the reviewers that didn't finish, then the lead. */
  resumeDeepReview(id: string): Promise<void>;
  setDeepReviewFinding(
    id: string,
    findingId: string,
    status: Extract<FindingStatus, "open" | "dismissed">,
  ): Promise<void>;
  /** Recent commits on the checked-out branch, newest first. */
  onProjectChat(
    callback: (event: {
      chatId: string;
      message: ChatMessage;
      title?: string;
    }) => void,
  ): () => void;
}
