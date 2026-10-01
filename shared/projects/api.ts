import type { AgentResponse } from "../agent-modes";
import type { AgentProvider } from "../agents";
import type {
  DeepReviewStart,
  FindingStatus,
  ReviewSetup,
} from "../deep-review";
import type { ProjectChatEvent, ProjectChatsEvent } from "../events";
import type { DirListing, FileInfo } from "../project-files";
import type { FilePair, LocalFile, Page, ProjectPull } from "../types";
import type {
  ChangeArea,
  GitAction,
  RebaseResult,
  WorkingTree,
} from "../working-tree";
import type { Project } from "./project";
import type { ResumeSettings, ProjectChatSend } from "./send";
import type { KnownMessages, ProjectChatPatch } from "./sync";
import type {
  ChatScope,
  ChatSummary,
  ChatTriage,
  ChatWorkspace,
} from "./threads";
import type { WorktreeMove, WorktreeStatus } from "./worktrees";

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
  /** Marks the thread read up to `seenAt`, for the desktop and every phone. */
  markProjectChatSeen(id: string, seenAt: number): Promise<void>;
  /** A new thread holding the conversation up to this answer, or up to the latest finished one. */
  forkProjectChat(id: string, messageId?: string): Promise<ChatSummary>;
  /** Names the thread again from the whole conversation; replaces a name you typed too. */
  regenerateProjectChatTitle(id: string): Promise<ChatSummary>;
  projectCommands(
    id: string,
    provider: AgentProvider,
  ): Promise<import("../commands").ProviderCommand[]>;
  projectBranchPulls(
    where: string,
  ): Promise<import("../pull-request-create").BranchPull[]>;
  /** CI on the thread's branch (its worktree's, with `chatId`); null when there's none to show. */
  projectCiStatus(
    id: string,
    chatId?: string | null,
  ): Promise<import("../ci").CiStatus | null>;
  /** `where` is a workspace id: a thread's worktree opens its PR from its own branch. */
  projectPreparePull(
    where: string,
  ): Promise<import("../pull-request-create").PullRequestPlan>;
  projectCreatePull(
    where: string,
    input: import("../pull-request-create").CreatePullRequest,
  ): Promise<import("../pull-request-create").CreatedPullRequest>;
  projectBranches(id: string): Promise<import("../branches").BranchList>;
  projectChangeBranch(
    id: string,
    action: import("../branches").BranchAction,
  ): Promise<import("../branches").BranchList>;
  /** Sends Claude what stopped when Relay closed, or forgets it. */
  resolveStoppedWork(id: string, action: "resume" | "dismiss"): Promise<void>;
  /** Stops a background task Claude left running, or cancels its wake-up. */
  stopProjectChatPending(id: string, pendingId: string): Promise<void>;
  /** The subagents Claude started in the thread's live sessions. */
  projectChatAgents(id: string): Promise<import("../subagents").SubagentRun[]>;
  /** One agent's whole run; null once its session is gone. */
  projectChatAgent(
    id: string,
    agentId: string,
  ): Promise<import("../subagents").SubagentDetail | null>;
  /** Stops one agent; Claude hears it was stopped. */
  stopProjectChatAgent(id: string, agentId: string): Promise<void>;
  projectChatPresence(
    id: string,
    value: { path: string | null; viewed: number; total: number } | null,
  ): Promise<import("../rooms").Presence[]>;
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
  localCheckInfo(where: string): Promise<import("../checks").ProjectCheckInfo>;
  localCheckState(
    where: string,
    head: string,
  ): Promise<import("../checks").ProjectCheckState | null>;
  startLocalChecks(
    where: string,
    head: string,
    target: string,
  ): Promise<import("../checks").ProjectCheckState>;
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
    query: import("../checks").SymbolQuery,
  ): Promise<import("../checks").SymbolResult>;
  localBlame(
    where: string,
    query: import("../types").BlameQuery,
  ): Promise<import("../types").LineBlame>;

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
  /** Where a file sits on disk, whether or not it's there now. */
  projectAbsolutePath(where: string, path: string): Promise<string>;
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
  ): Promise<import("../commit-split").CommitSplitPlan>;
  projectApplyCommitSplit(
    where: string,
    split: import("../commit-split").ApplyCommitSplit,
  ): Promise<WorkingTree>;
  /** Merging the current branch into `base`, the default branch when omitted. */
  projectMergePlan(
    where: string,
    base?: string,
  ): Promise<import("../branch-merge").MergePlan>;
  projectMergeBranch(
    where: string,
    input: import("../branch-merge").MergeBranch,
  ): Promise<import("../branch-merge").MergeResult>;
  projectDeleteBranch(where: string, name: string): Promise<void>;
  /** Merges `base` into the current branch; conflicts stay marked in its folder. */
  projectCatchUp(where: string, base: string): Promise<{ conflicts: string[] }>;
  /** Rebases the checkout's commits onto its upstream, if `head` is still where they end. */
  projectRebase(where: string, head: string): Promise<RebaseResult>;
  projectHistory(
    where: string,
    scope: import("../history").HistoryScope,
    limit: number,
  ): Promise<import("../history").CommitLog>;
  projectCommit(
    where: string,
    sha: string,
  ): Promise<import("../history").CommitDetail>;
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
  projectPulls(
    id: string,
    state: "open" | "closed" | "all",
    page: number,
  ): Promise<Page<ProjectPull>>;
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
  /** What moving a checkout thread into its own worktree would take, or why it can't. */
  projectWorktreeMove(chatId: string): Promise<WorktreeMove>;
  moveProjectChatToWorktree(chatId: string): Promise<ChatSummary>;
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
  /** A short name for a deep review setup, written by a helper agent; null when none could. */
  nameReviewSetup(setup: ReviewSetup): Promise<string | null>;
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
  onProjectChat(callback: (event: ProjectChatEvent) => void): () => void;
  /** A project's thread list, pushed whenever any of its threads reads differently. */
  onProjectChats(callback: (event: ProjectChatsEvent) => void): () => void;
}
