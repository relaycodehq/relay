import type { AgentResponse } from "../agent-modes";
import type { AgentProvider } from "../agents";
import type { MergeBranch, MergePlan, MergeResult } from "../branch-merge";
import type { BranchAction, BranchList } from "../branches";
import type {
  ProjectCheckInfo,
  ProjectCheckState,
  SymbolQuery,
  SymbolResult,
} from "../checks";
import type { CiStatus } from "../ci";
import type { ProviderCommand } from "../commands";
import type { ContextReport } from "../context-report";
import type { WatchClose, WatchReview, WatchSpendSummary } from "../watch";
import type { ApplyCommitSplit, CommitSplitPlan } from "../commit-split";
import type {
  DeepReviewStart,
  FindingStatus,
  ReviewSetup,
} from "../deep-review";
import type { ProjectChatEvent, ProjectChatsEvent } from "../events";
import type { CommitDetail, CommitLog, HistoryScope } from "../history";
import type { DirListing, FileInfo } from "../project-files";
import type {
  BranchPull,
  CreatedPullRequest,
  CreatePullRequest,
  PullRequestPlan,
} from "../pull-request-create";
import type {
  TerminalSession,
  TerminalSessionPick,
} from "../terminal-sessions";
import type { SubagentDetail, SubagentRun } from "../subagents";
import type {
  BlameQuery,
  FilePair,
  LineBlame,
  LocalFile,
  Page,
  ProjectPull,
} from "../types";
import type {
  ChangeArea,
  GitAction,
  RebaseResult,
  WorkingTree,
} from "../working-tree";
import type { Project, ProjectSettings } from "./project";
import type { ResumeSettings, ProjectChatSend } from "./send";
import type { KnownMessages, ProjectChatPatch } from "./sync";
import type {
  ChatScope,
  ChatSummary,
  ChatTriage,
  ChatWorkspace,
} from "./threads";
import type { WorktreeBranch, WorktreeMove, WorktreeStatus } from "./worktrees";

// Calls taking `where` accept a workspace id (see shared/workspaces.ts):
// the checkout, or a thread's worktree.

export interface ProjectApi
  extends
    ProjectListApi,
    ProjectChatApi,
    ProjectCouncilApi,
    ProjectWorktreeApi,
    ProjectFilesApi,
    ProjectGitApi,
    ProjectChecksApi {}

/** The sidebar's projects, their groups and Scratchpad. */
export interface ProjectListApi {
  projects(): Promise<Project[]>;
  addProject(): Promise<Project | null>;
  /** The Scratchpad project for a new chat: the unused one, or a fresh folder. */
  createScratch(): Promise<Project>;
  /** Threads in every Scratchpad folder, in one list for the sidebar. */
  scratchChats(): Promise<ChatSummary[]>;
  linkProject(id: string): Promise<Project>;
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
  /** Takes the project out of Relay; its folder on disk is left alone. */
  removeProject(id: string): Promise<void>;
  saveProjectSettings(id: string, settings: ProjectSettings): Promise<Project>;
  /** Opens the project's folder in Finder. */
  revealProject(id: string): Promise<void>;
}

/** A project's threads: the list, the conversation and its turns. */
/** The thread carrying on a terminal session; `created` when it was just made. */
export interface ContinuedSession {
  chat: ChatSummary;
  created: boolean;
}

export interface ProjectChatApi {
  projectChats(id: string): Promise<ChatSummary[]>;
  createProjectChat(
    id: string,
    scope: ChatScope,
    workspace?: ChatWorkspace,
    /** The new worktree's branch, when the user named it. */
    branch?: string,
  ): Promise<ChatSummary>;
  projectChat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  sendProjectChat(id: string, input: ProjectChatSend): Promise<void>;
  cancelProjectChat(id: string): Promise<void>;
  respondProjectChat(
    id: string,
    requestId: string,
    response: AgentResponse,
  ): Promise<void>;
  answerProjectChatQuestion(
    id: string,
    messageId: string,
    itemId: string,
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
  /**
   * Restarts the thread's agent on the same conversation, so it loads skills,
   * plugins and instructions changed since it started.
   */
  reloadProjectChatSession(id: string): Promise<void>;
  /** Runs the project's setup command again in the thread's worktree, in the row of setup run `messageId`. */
  rerunWorktreeSetup(id: string, messageId: string): Promise<void>;
  triageProjectChat(id: string, triage: ChatTriage): Promise<ChatSummary>;
  renameProjectChat(id: string, title: string): Promise<ChatSummary>;
  /** A thread another thread's agent started stands on its own from now on. */
  detachProjectChat(id: string): Promise<ChatSummary>;
  /** Marks the thread read up to `seenAt`, for the desktop and every phone. */
  markProjectChatSeen(id: string, seenAt: number): Promise<void>;
  /** A new thread holding the conversation up to this answer, or up to the latest finished one. */
  forkProjectChat(id: string, messageId?: string): Promise<ChatSummary>;
  /** Claude Code and Codex sessions run in a terminal in the project's folder, newest first. */
  terminalSessions(projectId: string): Promise<TerminalSession[]>;
  /** A thread carrying on a terminal session; the one that already does, if any. */
  continueTerminalSession(
    projectId: string,
    pick: TerminalSessionPick,
    workspace?: ChatWorkspace,
    branch?: string,
  ): Promise<ContinuedSession>;
  /** Names the thread again from the whole conversation; replaces a name you typed too. */
  regenerateProjectChatTitle(id: string): Promise<ChatSummary>;
  projectCommands(
    id: string,
    provider: AgentProvider,
  ): Promise<ProviderCommand[]>;
  /** Sends Claude what stopped when Relay closed, or forgets it. */
  resolveStoppedWork(id: string, action: "resume" | "dismiss"): Promise<void>;
  /** Turns off resuming the answer a usage limit stopped once it lifts, or back on. */
  setLimitResume(id: string, on: boolean): Promise<void>;
  /** Stops a background task Claude left running, or cancels its wake-up. */
  stopProjectChatPending(id: string, pendingId: string): Promise<void>;
  /** The subagents Claude started in the thread's live sessions. */
  projectChatAgents(id: string): Promise<SubagentRun[]>;
  /** What fills the window of Claude's live session, counted as /context does; null without one. */
  projectChatContext(
    id: string,
    parentId?: string | null,
  ): Promise<ContextReport | null>;
  /** One agent's whole run; null once its session is gone. */
  projectChatAgent(id: string, agentId: string): Promise<SubagentDetail | null>;
  /** Stops one agent; Claude hears it was stopped. */
  stopProjectChatAgent(id: string, agentId: string): Promise<void>;
  projectChatImage(id: string, imageId: string): Promise<string>;
  /** The screenshots of a queued or scheduled message, to take it back with them. */
  projectChatQueuedImages(
    id: string,
    messageId: string,
  ): Promise<NonNullable<ProjectChatSend["images"]>>;
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
  /** Shows a file a turn changed in Finder; a null `messageId` means a worktree file. */
  revealProjectTurnFile(
    chatId: string,
    messageId: string | null,
    path: string,
  ): Promise<void>;
  onProjectChat(callback: (event: ProjectChatEvent) => void): () => void;
  /** A project's thread list, pushed whenever any of its threads reads differently. */
  onProjectChats(callback: (event: ProjectChatsEvent) => void): () => void;
}

/** Deep reviews and Ultraplan councils, run inside a thread. */
export interface ProjectCouncilApi {
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
  /**
   * Takes a watch note out of its turn; "known" also keeps its topic from
   * coming up again. `read` says its details were open.
   */
  closeWatchNote(
    id: string,
    messageId: string,
    noteId: string,
    how: WatchClose,
    read: boolean,
  ): Promise<void>;
  /** What "Flag what I'd miss" spent this past week, by thread. */
  watchSpend(): Promise<WatchSpendSummary | undefined>;
  /** This past week's notes with what was done with each; development builds. */
  watchReview(): Promise<WatchReview>;
  /** Has a helper model grade the notes not graded yet; spends on the helper's account. */
  judgeWatchNotes(): Promise<WatchReview>;
}

/** A thread's own worktree, and the ones its agent made. */
export interface ProjectWorktreeApi {
  projectWorktree(chatId: string): Promise<WorktreeStatus>;
  /** The branch a new thread's worktree would get for `prompt`, or whether `branch` can be made. */
  worktreeBranch(
    projectId: string,
    prompt: string,
    branch?: string,
  ): Promise<WorktreeBranch>;
  /** One file as the worktree has it, against where its branch forks. */
  projectWorktreeDiff(chatId: string, path: string): Promise<FilePair>;
  removeProjectWorktree(chatId: string): Promise<void>;
  /** What moving a checkout thread into its own worktree would take, or why it can't. */
  projectWorktreeMove(chatId: string): Promise<WorktreeMove>;
  moveProjectChatToWorktree(chatId: string): Promise<ChatSummary>;
  revealProjectWorktree(chatId: string): Promise<void>;
  /** Opens a worktree the thread's agent made, by its path in `agentWorktrees`. */
  revealAgentWorktree(chatId: string, path: string): Promise<void>;
}

export interface ProjectFilesApi {
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
}

/** Changes, commits, branches and pull requests. */
export interface ProjectGitApi {
  projectWorkingTree(where: string): Promise<WorkingTree>;
  projectWorkingDiff(
    where: string,
    path: string,
    area: ChangeArea,
  ): Promise<FilePair>;
  /** A gitignored file an agent wrote, against how it was before the agent's first write. */
  projectIgnoredDiff(where: string, path: string): Promise<FilePair>;
  /** Takes gitignored files off the Changes list. */
  projectDismissIgnored(where: string, paths: string[]): Promise<WorkingTree>;
  projectGitAction(where: string, action: GitAction): Promise<WorkingTree>;
  /** A generated message for committing just these changed files. */
  projectCommitMessage(where: string, paths: string[]): Promise<string>;
  /** A model's split of every uncommitted change into commits, not yet made. */
  projectPlanCommitSplit(
    where: string,
    note?: string,
  ): Promise<CommitSplitPlan>;
  projectApplyCommitSplit(
    where: string,
    split: ApplyCommitSplit,
  ): Promise<WorkingTree>;
  /** Merging the current branch into `base`, the default branch when omitted. */
  projectMergePlan(where: string, base?: string): Promise<MergePlan>;
  projectMergeBranch(where: string, input: MergeBranch): Promise<MergeResult>;
  projectDeleteBranch(where: string, name: string): Promise<void>;
  /** Merges `base` into the current branch; conflicts stay marked in its folder. */
  projectCatchUp(where: string, base: string): Promise<{ conflicts: string[] }>;
  /** Rebases the checkout's commits onto its upstream, if `head` is still where they end. */
  projectRebase(where: string, head: string): Promise<RebaseResult>;
  projectHistory(
    where: string,
    scope: HistoryScope,
    limit: number,
  ): Promise<CommitLog>;
  projectCommit(where: string, sha: string): Promise<CommitDetail>;
  /** One file as a commit left it, against its first parent. */
  projectCommitDiff(
    where: string,
    sha: string,
    path: string,
  ): Promise<FilePair>;
  projectBranches(id: string): Promise<BranchList>;
  projectChangeBranch(id: string, action: BranchAction): Promise<BranchList>;
  projectBranchPulls(where: string): Promise<BranchPull[]>;
  /** CI on the thread's branch (its worktree's, with `chatId`); null when there's none to show. */
  projectCiStatus(id: string, chatId?: string | null): Promise<CiStatus | null>;
  /** `where` is a workspace id: a thread's worktree opens its PR from its own branch. */
  projectPreparePull(where: string): Promise<PullRequestPlan>;
  projectCreatePull(
    where: string,
    input: CreatePullRequest,
  ): Promise<CreatedPullRequest>;
  projectPulls(
    id: string,
    state: "open" | "closed" | "all",
    page: number,
  ): Promise<Page<ProjectPull>>;
}

/** Type checks, symbols and blame on the working copy. */
export interface ProjectChecksApi {
  localCheckInfo(where: string): Promise<ProjectCheckInfo>;
  localCheckState(
    where: string,
    head: string,
  ): Promise<ProjectCheckState | null>;
  startLocalChecks(
    where: string,
    head: string,
    target: string,
  ): Promise<ProjectCheckState>;
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
    query: SymbolQuery,
  ): Promise<SymbolResult>;
  localBlame(where: string, query: BlameQuery): Promise<LineBlame>;
}
