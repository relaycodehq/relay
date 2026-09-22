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
export interface Project {
  /** Sidebar-only folder path; never a filesystem location. */
  folder?: string;
  id: string;
  path: string;
  name: string;
  repository: ({ server: string } & Repo) | null;
  added: number;
}
export const chatScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("pr"), ref: refSchema }).strict(),
]);
export type ChatScope = z.infer<typeof chatScopeSchema>;
export interface ChatSummary {
  id: string;
  projectId: string;
  title: string;
  scope: ChatScope;
  created: number;
  updated: number;
  shared?: { roomId: string; server: string; memberId: string };
}
export interface ChatMessage {
  /** Local proposed-plan action; shared chats receive the final text only. */
  proposedPlan?: boolean;
  /** Local marker: the saved Codex session already received this steering prompt. */
  steered?: boolean;
  images?: ChatImage[];
  activity?: AgentActivity[];
  trace?: AgentTrace[];
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
  kind: "command" | "file" | "tool";
  label: string;
  status: "running" | "complete" | "failed";
  detail?: string;
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
export interface ProjectChat extends ChatSummary {
  requests?: AgentRequest[];
  queue?: QueuedChatMessage[];
  queuePaused?: boolean;
  lastInput?: ProjectChatSend;
  messages: ChatMessage[];
  claudeThread?: string;
  claudeThrough?: string;
  providerThread?: string;
  providerThrough?: string;
  sharedCursor?: number;
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
export const projectChatSendSchema = z
  .object({
    delivery: z.enum(["queue", "steer"]).optional(),
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
  })
  .strict();
export type ProjectChatSend = z.infer<typeof projectChatSendSchema>;
export interface ProjectApi {
  respondProjectChat(
    id: string,
    requestId: string,
    response: AgentResponse,
  ): Promise<void>;
  projectChatQueueAction(
    id: string,
    action: "remove" | "steer",
    messageId: string,
  ): Promise<void>;
  resumeProjectChat(id: string): Promise<void>;
  setProjectFolder(id: string, folder: string): Promise<void>;
  setProjectChatScope(id: string, scope: ChatScope): Promise<ChatSummary>;
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
  syncProjectChat(id: string): Promise<ProjectChat>;
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
  projectPulls(id: string, state: string, page: number): Promise<Page<Issue>>;
  projectChats(id: string): Promise<ChatSummary[]>;
  createProjectChat(id: string, scope: ChatScope): Promise<ChatSummary>;
  projectChat(id: string): Promise<ProjectChat>;
  projectChatImage(id: string, imageId: string): Promise<string>;
  sendProjectChat(id: string, input: ProjectChatSend): Promise<void>;
  cancelProjectChat(id: string): Promise<void>;
  onProjectChat(
    callback: (event: {
      chatId: string;
      message: ChatMessage;
      title?: string;
    }) => void,
  ): () => void;
}
