import type { RunImportOffer } from "../import-offer";
import type { AgentResponse } from "../agent-modes";
import type { AgentProvider } from "../agents";
import type { MergeBranch, MergePlan, MergeResult } from "../branch-merge";
import type {
  BranchAction,
  BranchChanges,
  BranchCounts,
  BranchList,
} from "../branches";
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
import type { HelperPick } from "../settings";
import type { ElsewhereChanges } from "../elsewhere";
import type {
  DeepReviewStart,
  ResumeReview,
  ReviewSetup,
} from "../deep-review";
import type { FindingStatus } from "../findings";
import type { ThreadNote } from "../thread-notes";
import type { ProjectChatEvent, ProjectChatsEvent } from "../events";
import type { NewsItem } from "../thread-news";
import type { CommitDetail, CommitLog, HistoryScope } from "../history";
import type { DirListing, FileInfo, FilePreview } from "../project-files";
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
import type { AddingJob, AddingStart, GithubRepos, NewProject } from "./adding";
import type {
  ImportApp,
  ImportProject,
  ImportChat,
  ImportSelection,
  ProjectImportResult,
} from "../project-import";
import type {
  FolderEntry,
  FolderInfo,
  FolderPreview,
  LinkSuggestion,
} from "./folders";
import type { LinkedFolder } from "./links";
import type { WorktreeStart } from "./worktrees";
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
    ProjectFoldersApi,
    ProjectChatApi,
    ProjectCouncilApi,
    ProjectWorktreeApi,
    ProjectFilesApi,
    ProjectGitApi,
    ProjectChecksApi {}

/** The sidebar's projects, their groups and Scratchpad. */
export interface ProjectListApi {
  projects(): Promise<Project[]>;
  /** The ids of removed projects, whose threads stay for when they're added again. */
  removedProjects(): Promise<string[]>;
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
  /** Points a project whose folder moved at the folder chosen in a dialog; null when cancelled. */
  locateProject(id: string): Promise<Project | null>;
  saveProjectSettings(id: string, settings: ProjectSettings): Promise<Project>;
  addProjectLinks(id: string, links: LinkedFolder[]): Promise<Project>;
  /** Opens the project's folder in Finder. */
  revealProject(id: string): Promise<void>;
}

/** Folders on disk, to add as projects or link to one. */
export interface ProjectFoldersApi {
  importProjects(app: ImportApp): Promise<ImportProject[]>;
  importProjectChats(
    app: ImportApp,
    key: string,
    folder?: string,
  ): Promise<ImportChat[]>;
  importSelectedProjects(
    app: ImportApp,
    selections: ImportSelection[],
  ): Promise<ProjectImportResult>;
  /** A Scratchpad thread opened to import `app`'s history with an agent, which gets the import tools. */
  startImportThread(
    app: ImportApp,
  ): Promise<{ project: Project; chat: ChatSummary }>;
  /** Imports what the user ticked in the list an agent offered (offer_import), and places the new projects. */
  runImportOffer(
    chatId: string,
    messageId: string,
    input: RunImportOffer,
  ): Promise<ProjectImportResult>;
  inspectFolder(path: string): Promise<FolderInfo>;
  /** The folders inside `dir`, for typing a path; `~` stands for home. */
  listFolders(dir: string): Promise<FolderEntry[]>;
  folderPreview(dir: string, computerId?: string): Promise<FolderPreview>;
  /** Finder's folder picker; null when cancelled. Adds nothing. */
  chooseFolder(title: string): Promise<string | null>;
  /** Folders worth linking to the project: the repositories beside it, then the other projects. */
  linkSuggestions(projectId: string): Promise<LinkSuggestion[]>;
  /** What the add-project palette opens on. */
  addingStart(computerId?: string): Promise<AddingStart>;
  /** Adds the folder at `path`; `setUpGit` runs `git init` in a plain one first. */
  addProjectAt(path: string, setUpGit?: boolean): Promise<Project>;
  /** Clones `remote` into a folder of its name inside `into`, then adds it. */
  cloneProject(remote: string, into: string): Promise<Project>;
  /** Makes the folder, with git and a GitHub repository when asked, then adds it. */
  createProject(spec: NewProject, computerId?: string): Promise<Project>;
  /** Stops the clone or creation under way; it rejects. */
  cancelProjectAdding(computerId?: string): Promise<void>;
  /** The repositories the `gh` login can see. */
  githubRepos(computerId?: string): Promise<GithubRepos>;
  onProjectAdding(callback: (job: AddingJob | null) => void): () => void;
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
    /** Folders linked to it with `/add-dir` before it was made. */
    links?: LinkedFolder[],
    /** Where its worktree starts, when not off the checkout's commit. */
    start?: WorktreeStart,
  ): Promise<ChatSummary>;
  projectChat(id: string, known?: KnownMessages): Promise<ProjectChatPatch>;
  sendProjectChat(id: string, input: ProjectChatSend): Promise<void>;
  /** `steers`: send a steer the agent hasn't read yet right after the stop. */
  cancelProjectChat(id: string, options?: { steers?: boolean }): Promise<void>;
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
  setProjectChatQuestionDismissed(
    id: string,
    messageId: string,
    itemId: string,
    dismissed: boolean,
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
  /** Replaces the folders linked to this thread alone; the agent hears of them on its next turn. */
  setProjectChatLinks(id: string, links: LinkedFolder[]): Promise<ChatSummary>;
  promoteProjectChatLink(
    id: string,
    path: string,
  ): Promise<{ project: Project; chat: ChatSummary }>;
  /** A thread another thread's agent started stands on its own from now on. */
  detachProjectChat(id: string): Promise<ChatSummary>;
  /** Takes back the leave to drive other threads, so its agent asks again. */
  stopProjectChatDriving(id: string): Promise<ChatSummary>;
  /** Marks the thread read up to `seenAt`, for the desktop and every phone. */
  markProjectChatSeen(id: string, seenAt: number): Promise<void>;
  /** A new thread holding the conversation up to this answer, or up to the latest finished one. */
  forkProjectChat(id: string, messageId?: string): Promise<ChatSummary>;
  /** What the user keeps at hand in the thread, oldest first. */
  threadNotes(id: string): Promise<ThreadNote[]>;
  /** Keeps markdown from the thread, kept from message `from`; the note already holding it, if one does. */
  keepThreadNote(id: string, text: string, from?: string): Promise<ThreadNote>;
  /** Pins a whole message as a note that points at it; the pin it already has, if any. */
  pinThreadMessage(id: string, messageId: string): Promise<ThreadNote>;
  /** Ticks item `item` (from 1) of a list note, or unticks it. */
  tickThreadNote(
    id: string,
    note: string,
    item: number,
    done: boolean,
  ): Promise<ThreadNote[]>;
  /** A list note's items in a new order, numbered from 1; items left out are dropped. */
  arrangeThreadNote(
    id: string,
    note: string,
    order: number[],
  ): Promise<ThreadNote[]>;
  removeThreadNote(id: string, note: string): Promise<ThreadNote[]>;
  /** Claude Code and Codex sessions run in a terminal in the project's folder, newest first. */
  terminalSessions(projectId: string): Promise<TerminalSession[]>;
  /** A thread carrying on a terminal session; the one that already does, if any. */
  continueTerminalSession(
    projectId: string,
    pick: TerminalSessionPick,
    workspace?: ChatWorkspace,
    branch?: string,
    links?: LinkedFolder[],
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
  /** What fills the live session's window, counted or estimated; null without one. */
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
  /** Where the player streams a video the answer `messageId` embeds from. */
  projectChatVideo(
    id: string,
    messageId: string,
    path: string,
  ): Promise<string>;
  /** The thread's preview as the turn `messageId` left it, as a JPEG data URL. */
  projectChatPreviewShot(id: string, messageId: string): Promise<string>;
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
  /** What a thread is news of: an answer that finished or failed, a thread that needs you. */
  onThreadNews(callback: (item: NewsItem) => void): () => void;
}

/** Deep reviews, run inside a thread. */
export interface ProjectCouncilApi {
  startDeepReview(id: string, config: DeepReviewStart): Promise<void>;
  /** A short name for a deep review setup, written by a helper agent; null when none could. */
  nameReviewSetup(setup: ReviewSetup): Promise<string | null>;
  /**
   * Runs the reviewers that didn't finish, then the lead. `slot` runs that
   * reviewer's task again before the lead starts; `lead` hands a stopped
   * review to the lead with the reports that are in.
   */
  resumeDeepReview(id: string, only?: ResumeReview): Promise<void>;
  /** Opens or dismisses a finding an answer in the thread published. */
  setFinding(
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
  /** Whether `branch` can be made for a new thread's worktree. */
  worktreeBranch(projectId: string, branch: string): Promise<WorktreeBranch>;
  /** One file as the worktree has it, against where its branch forks. */
  projectWorktreeDiff(chatId: string, path: string): Promise<FilePair>;
  removeProjectWorktree(chatId: string): Promise<void>;
  /** What moving a checkout thread into its own worktree would take, or why it can't. */
  projectWorktreeMove(chatId: string): Promise<WorktreeMove>;
  moveProjectChatToWorktree(chatId: string): Promise<ChatSummary>;
  revealProjectWorktree(chatId: string): Promise<void>;
  /** Opens a worktree the thread's agent made, by its path in `agentWorktrees`. */
  revealAgentWorktree(chatId: string, path: string): Promise<void>;
  /** Selects a worktree owned by this chat, or the project folder with null. */
  selectAgentWorktree(
    chatId: string,
    path: string | null,
  ): Promise<ChatSummary>;
  /** Whether the deleted worktree a thread has selected still has its branch to be made again from. */
  agentWorktreeRecreatable(chatId: string): Promise<boolean>;
  /** Makes that worktree again from its branch and keeps the thread in it. */
  recreateAgentWorktree(chatId: string): Promise<ChatSummary>;
}

export interface ProjectFilesApi {
  projectFiles(where: string): Promise<string[]>;
  projectFile(where: string, path: string): Promise<LocalFile>;
  /** A bounded text excerpt for a file mention, without editor or Git metadata. */
  projectFilePreview(where: string, path: string): Promise<FilePreview>;
  /** One level of a folder from disk ("" is the root), ignored files included. */
  projectDirectory(where: string, dir: string): Promise<DirListing>;
  projectFileInfo(where: string, path: string): Promise<FileInfo>;
  /** An image file as a data URL. */
  projectImage(where: string, path: string): Promise<string>;
  /** Where the player streams a video file from. */
  projectVideo(where: string, path: string): Promise<string>;
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
  /**
   * The calling window now shows `where`'s working tree, or none: Relay says
   * when it may have changed (`relay:working-tree`). False where it can't,
   * and the window polls instead.
   */
  watchWorkingTree(where: string | null): Promise<boolean>;
  projectWorkingDiff(
    where: string,
    path: string,
    area: ChangeArea,
  ): Promise<FilePair>;
  /** A gitignored file an agent wrote, against how it was before the agent's first write. */
  projectIgnoredDiff(where: string, path: string): Promise<FilePair>;
  /** What a thread and the threads it started changed in other repositories, and which of its own folder's files the started ones changed. */
  threadElsewhere(chatId: string): Promise<ElsewhereChanges>;
  /**
   * The calling window now shows this thread's changes elsewhere, or none:
   * Relay says when they may read differently (`relay:elsewhere`). False
   * where it can't watch their repositories, and the window polls instead.
   */
  watchElsewhere(chatId: string | null): Promise<boolean>;
  /** A file changed in another repository, against its HEAD. */
  threadElsewhereDiff(
    chatId: string,
    root: string,
    path: string,
  ): Promise<FilePair>;
  /** Commits what the thread's agents changed in another repository; `revision` is the tree it was listed at. */
  threadElsewhereCommit(
    chatId: string,
    root: string,
    revision: string,
    message: string,
  ): Promise<ElsewhereChanges>;
  /** Takes gitignored files off the Changes list. */
  projectDismissIgnored(where: string, paths: string[]): Promise<WorkingTree>;
  projectGitAction(where: string, action: GitAction): Promise<WorkingTree>;
  /** A generated message for committing just these changed files. */
  /** `pick` overrides the project's saved one; null asks for the app's. */
  projectCommitMessage(
    where: string,
    paths: string[],
    pick?: HelperPick | null,
  ): Promise<string>;
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
  /** Where each branch stands against the bases; slow on a big repository, so apart. */
  projectBranchCounts(id: string): Promise<BranchCounts>;
  /** Uncommitted changes on this local branch; null when it isn't checked out here. */
  projectBranchChanges(
    id: string,
    branch: string,
  ): Promise<BranchChanges | null>;
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
  /** `holder` identifies the window; windows on one folder share its checker. */
  startLocalChecks(
    where: string,
    head: string,
    target: string,
    holder: string,
    paused: boolean,
  ): Promise<ProjectCheckState>;
  stopLocalChecks(where: string, holder: string): Promise<void>;
  pauseLocalChecks(
    where: string,
    paused: boolean,
    holder: string,
  ): Promise<void>;
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
