import type { ExtensionRef, ThemeSearchPage, VsCodeTheme } from "./open-vsx";
import type { ProjectApi } from "./projects";
import type { DevOpsApi } from "./devops";
import type { ClockifyApi } from "./clockify";
import type { PluginsApi } from "./plugins";
import type { LiveSyncApi } from "./live-sync";
import type { TaskApi } from "./tasks";
import type { TerminalApi } from "./terminals";
import type { WorkingTreeApi } from "./working-tree";
import type { RoomApi as importRoomApi } from "./rooms";
import type { AISettings, ClaudeModel, CodexModel } from "./settings";
import type { ProviderUsage } from "./provider-usage";
import type { AgentProvider, UsageProvider } from "./agents";
import type { ReleaseNote, UpdateState } from "./updates";
import type { DictationModelState } from "./dictation";
import type { AgentVersions } from "./agent-updates";
import type {
  SourceControlKind,
  SourceControlProvider,
  TeaSetup,
} from "./source-control";
import type { LineQuestion } from "./questions";
import type {
  ProjectCheckInfo,
  ProjectCheckState,
  SymbolQuery,
  SymbolResult,
} from "./checks";
import type { TriageState } from "./triage";
import type { PhoneRemoteApi } from "./remote";
import type { ComputersApi } from "./handoff";
interface User {
  id: number;
  login: string;
  full_name?: string;
}
export interface Account {
  id: string;
  server: string;
  user: User;
  persistent: boolean;
}
export interface Repo {
  owner: string;
  name: string;
}
export interface PullRef extends Repo {
  number: number;
}
export interface BlameQuery {
  revision: string;
  path: string;
  line: number;
}
export interface LineBlame {
  commit: string;
  author: string;
  email: string;
  authoredAt: string;
  summary: string;
  shallow: boolean;
}
export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  updated_at: string;
  user: User;
  repository: { name: string; owner: string; full_name: string };
  labels: { id: number; name: string; color: string }[];
  comments: number;
  pull_request?: { merged: boolean };
}
interface Branch {
  ref: string;
  sha: string;
  repo: {
    owner: User;
    name: string;
    full_name: string;
    clone_url: string;
  } | null;
}
export interface Pull extends PullRef {
  id: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  merged: boolean;
  html_url: string;
  head: Branch;
  base: Branch;
  merge_base: string;
  user: User;
  additions: number;
  deletions: number;
  changed_files: number;
  updated_at: string;
  labels: Issue["labels"];
  comments: number;
}
/** A project's pull request as its list shows it: the pull, with the fields an issue search carries. */
export interface ProjectPull extends Pull {
  repository: Issue["repository"];
  pull_request: { merged: boolean };
}
export interface ChangedFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}
export interface Review {
  id: number;
  body: string;
  state: string;
  user: User;
  submitted_at: string;
  commit_id: string;
  comments_count: number;
  dismissed?: boolean;
  stale?: boolean;
}
export interface ReviewComment {
  id: number;
  body: string;
  path: string;
  position: number;
  original_position: number;
  commit_id: string;
  user: User;
  created_at: string;
  html_url: string;
  pull_request_review_id: number;
  resolver?: User | null;
}
export interface Discussion {
  id: number;
  body: string;
  user: User;
  created_at: string;
  html_url: string;
}
export type Side = "additions" | "deletions";
export interface Draft {
  id: string;
  path: string;
  line: number;
  side: Side;
  body: string;
  revision: string;
  createdAt: string;
}
export interface LineMark {
  id: string;
  path: string;
  start: number;
  end: number;
  side: Side;
  revision: string;
}
export interface Progress {
  reviewBody?: string;
  read: Record<string, string>;
  drafts: Draft[];
  marks: LineMark[];
}
export interface Page<T> {
  items: T[];
  nextPage: number | null;
  total?: number;
}
export interface FilePair {
  old: { name: string; contents: string; cacheKey: string } | null;
  next: { name: string; contents: string; cacheKey: string } | null;
  binary: boolean;
  /** Data URLs for a binary change to an image; null where the side is absent. */
  images?: { old: string | null; next: string | null };
}
export interface LocalFolder {
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  remoteMatches: boolean;
}
export type SidebarView = "threads" | "activity";
export interface Bootstrap {
  account: Account | null;
  platform: string;
  loginRestore: "idle" | "unlocking" | "failed";
  savedServer?: string;
  /** Last sidebar view, kept in app data so it survives updates. */
  sidebarView?: SidebarView;
  pendingUrl?: string;
  workspace: WorkspaceState;
}
export interface WorkspaceState {
  pull: PullRef | null;
  file: string | null;
  filter: "review_requested" | "assigned" | "created" | "all";
  query: string;
  state: "open" | "closed" | "all";
}
export const emptyWorkspace = (): WorkspaceState => ({
  pull: null,
  file: null,
  filter: "review_requested",
  query: "",
  state: "open",
});
export interface LocalFile {
  path: string;
  branch: string;
  head: string;
  contents: string;
  original: string;
  version: string;
}
export interface Api
  extends
    importRoomApi,
    WorkingTreeApi,
    LiveSyncApi,
    ProjectApi,
    DevOpsApi,
    PluginsApi,
    ClockifyApi,
    TaskApi,
    TerminalApi,
    PhoneRemoteApi,
    ComputersApi {
  inspectSymbol(
    ref: PullRef,
    head: string,
    query: SymbolQuery,
  ): Promise<SymbolResult>;
  projectCheckInfo(ref: PullRef): Promise<ProjectCheckInfo | null>;
  projectCheckState(
    ref: PullRef,
    head: string,
  ): Promise<ProjectCheckState | null>;
  startProjectChecks(
    ref: PullRef,
    head: string,
    targetId: string,
  ): Promise<ProjectCheckState>;
  stopProjectChecks(ref: PullRef): Promise<void>;
  pauseProjectChecks(ref: PullRef, paused: boolean): Promise<void>;
  updateCheckBuffer(
    ref: PullRef,
    head: string,
    path: string,
    text: string | null,
  ): Promise<void>;
  triageState(
    ref: PullRef,
    head: string,
    base: string,
  ): Promise<TriageState | null>;
  startTriage(ref: PullRef, head: string, base: string): Promise<TriageState>;
  cancelTriage(ref: PullRef, head: string, base: string): Promise<void>;
  groupPaths(
    ref: PullRef,
    head: string,
    base: string,
    id: string,
  ): Promise<string[]>;
  aiSettings(): Promise<AISettings>;
  saveAISettings(settings: AISettings): Promise<AISettings>;
  smartProjectNames(): Promise<boolean>;
  saveSmartProjectNames(enabled: boolean): Promise<boolean>;
  /** Plugged in, Relay keeps the computer from idling to sleep; on battery only while it has work or a paired device. */
  keepAwake(): Promise<boolean>;
  saveKeepAwake(enabled: boolean): Promise<boolean>;
  /** Days without activity before a thread settles by itself; null never. */
  autoSettleDays(): Promise<number | null>;
  saveAutoSettleDays(days: number | null): Promise<number | null>;
  saveSidebarView(view: SidebarView): Promise<void>;
  /** The agent last picked for a new thread, here or on the phone; null before either has. */
  newThreadAgent(): Promise<AgentProvider | null>;
  saveNewThreadAgent(provider: AgentProvider): Promise<void>;
  /** Each agent's model a new thread starts on, here or on the phone. */
  newThreadModels(): Promise<import("./new-thread-models").NewThreadModels>;
  saveNewThreadModel(
    provider: AgentProvider,
    model: import("./new-thread-models").NewThreadModel,
  ): Promise<void>;
  /** `force` skips the cached reading, for an explicit refresh; `account` is the usual sign-in when left out. */
  providerUsage(
    provider: UsageProvider,
    force?: boolean,
    account?: string,
  ): Promise<ProviderUsage>;
  /** Claude Code and Codex accounts; see shared/agent-accounts. */
  agentAccounts(): Promise<import("./agent-accounts").AgentAccountsState>;
  /** Opens the CLI's browser sign-in for a new account; it's listed once that finishes. */
  addAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    label: string,
  ): Promise<void>;
  signInAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    id: string,
  ): Promise<void>;
  cancelAgentAccountSignIn(): Promise<void>;
  renameAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    id: string,
    label: string,
  ): Promise<void>;
  removeAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    id: string,
  ): Promise<void>;
  moveAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    id: string,
    by: -1 | 1,
  ): Promise<void>;
  /** The account new threads start on. */
  useAgentAccount(
    provider: import("./agent-accounts").AccountProvider,
    id: string,
  ): Promise<void>;
  setAccountAutoSwitch(on: boolean): Promise<void>;
  /** Runs the thread's `provider` on another account from its next turn. */
  setThreadAccount(
    chatId: string,
    provider: import("./agent-accounts").AccountProvider,
    id: string,
  ): Promise<import("./projects").ChatSummary>;
  /** Credit on the OpenRouter key OpenCode runs on; `force` skips the cache. */
  openRouterCredit(
    force?: boolean,
  ): Promise<import("./openrouter-credit").OpenRouterCredit>;
  /** An agent's models; Codex's and Claude's carry their own extra fields. */
  agentModels<P extends import("./agents").AgentProvider>(
    provider: P,
  ): Promise<
    P extends "codex"
      ? CodexModel[]
      : P extends "claude"
        ? ClaudeModel[]
        : import("./agents").AgentModel[]
  >;
  /** What an agent runs in this project where a thread leaves the model on Default. */
  agentDefaults(
    projectId: string,
    provider: import("./agents").AgentProvider,
  ): Promise<import("./agents").AgentDefaults | null>;
  askAboutLines(ref: PullRef, question: LineQuestion): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  retryLoginRestore(): Promise<void>;
  cancelLoginRestore(): Promise<void>;
  saveWorkspace(workspace: WorkspaceState): Promise<void>;
  connect(server: string, token: string): Promise<Account>;
  disconnect(): Promise<void>;
  search(
    filter: WorkspaceState["filter"],
    q: string,
    state: WorkspaceState["state"],
    page: number,
  ): Promise<Page<Issue>>;
  pull(ref: PullRef): Promise<Pull>;
  files(ref: PullRef, page: number): Promise<Page<ChangedFile>>;
  blame(ref: PullRef, query: BlameQuery): Promise<LineBlame>;
  contents(
    ref: PullRef,
    file: ChangedFile,
    head: string,
    base: string,
  ): Promise<FilePair>;
  /** Paths changed between two commits, or null when Gitea can't say. */
  changedBetween(
    ref: PullRef,
    from: string,
    to: string,
  ): Promise<string[] | null>;
  reviews(ref: PullRef, page: number): Promise<Page<Review>>;
  reviewComments(ref: PullRef, id: number): Promise<ReviewComment[]>;
  discussion(ref: PullRef, page: number): Promise<Page<Discussion>>;
  progress(ref: PullRef): Promise<Progress>;
  saveProgress(ref: PullRef, progress: Progress): Promise<void>;
  submitReview(
    ref: PullRef,
    head: string,
    event: "COMMENT" | "APPROVED" | "REQUEST_CHANGES",
    body: string,
    drafts: Draft[],
  ): Promise<Review>;
  resolveComment(ref: PullRef, id: number, resolved: boolean): Promise<void>;
  reply(ref: PullRef, id: number, body: string): Promise<void>;
  comment(ref: PullRef, body: string): Promise<void>;
  folder(ref: Repo): Promise<LocalFolder | null>;
  linkFolder(ref: Repo): Promise<LocalFolder | null>;
  readLocalFile(ref: PullRef, head: string, path: string): Promise<LocalFile>;
  saveLocalFile(
    ref: PullRef,
    head: string,
    path: string,
    version: string,
    contents: string,
  ): Promise<{ version: string }>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  writeClipboardImage(dataUrl: string): Promise<void>;
  /** Where a dropped file sits on disk; empty when no file is behind it. */
  pathForFile(file: File): string;
  launchCodex(
    ref: PullRef,
    head: string,
    path: string,
    line: number,
    side: Side,
    comment: string,
  ): Promise<void>;
  openExternal(url: string): Promise<void>;
  updateState(): Promise<UpdateState>;
  /** Looks for a newer release now; rejects with the reason when it can't tell. */
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  /** Quits and hands over to the new version, which starts by itself. */
  installUpdate(): Promise<UpdateState>;
  /** Every published release's notes, newest first. */
  releaseNotes(): Promise<ReleaseNote[]>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  dictationState(): Promise<DictationModelState>;
  downloadDictationModel(): Promise<DictationModelState>;
  cancelDictationDownload(): Promise<void>;
  removeDictationModel(): Promise<DictationModelState>;
  /** Asks the system for the microphone where it needs asking; false when refused. */
  dictationMicrophone(): Promise<boolean>;
  /**
   * Posts a port to the speech engine to the page as a "relay:dictation-port"
   * window message; false when the model isn't downloaded.
   */
  connectDictation(): Promise<boolean>;
  /** Starts loading the model so the first words don't wait for it. */
  warmDictation(): Promise<void>;
  onDictationState(callback: (state: DictationModelState) => void): () => void;
  /** The agent CLIs as last checked, and whether newer ones are out. */
  agentVersions(): Promise<AgentVersions>;
  /** Looks again now, asking the registries afresh. */
  checkAgentVersions(): Promise<AgentVersions>;
  /** Updates an agent's CLI with whatever installed it. */
  updateAgent(provider: AgentProvider): Promise<AgentVersions>;
  /** Asks for an agent CLI and links it if it says its version; null if cancelled. */
  linkAgent(provider: AgentProvider): Promise<AgentVersions | null>;
  /** Forgets the linked CLI and finds one again. */
  unlinkAgent(provider: AgentProvider): Promise<AgentVersions>;
  /** The source control hosts with their tools, versions and sign-ins, looked up now. */
  sourceControl(): Promise<SourceControlProvider[]>;
  setSourceControlEnabled(
    kind: SourceControlKind,
    enabled: boolean,
  ): Promise<SourceControlProvider[]>;
  /**
   * Links a host's CLI (`gh`, `tea`, `az`) if it says it is one: the program at
   * `path`, or one chosen in a file dialog when it's left out. Null if cancelled.
   */
  linkSourceControlCli(
    kind: SourceControlKind,
    path?: string,
  ): Promise<SourceControlProvider[] | null>;
  /** Forgets the linked CLI and finds one again. */
  unlinkSourceControlCli(
    kind: SourceControlKind,
  ): Promise<SourceControlProvider[]>;
  /** The `tea` CLI and the servers it is logged in to. */
  teaSetup(): Promise<TeaSetup>;
  /** Signs in to Gitea with the token `tea` holds for one of its logins. */
  connectWithTea(login: string): Promise<Account>;
  /** Signs in to Cursor in the browser, downloading its SDK first if needed. */
  signInCursor(): Promise<AgentVersions>;
  signOutCursor(): Promise<AgentVersions>;
  onAgentVersions(callback: (state: AgentVersions) => void): () => void;
  onAgentAccounts(
    callback: (state: import("./agent-accounts").AgentAccountsState) => void,
  ): () => void;
  /** Syncs native chrome and the dock icon with the in-app theme. */
  applyAppearance(appearance: {
    mode: "system" | "light" | "dark";
    background: string;
    icon: string;
  }): Promise<void>;
  /** Colours Linux's native window controls; see lib/titlebar-tint.ts. */
  tintTitleBar(colors: { color: string; symbolColor: string }): Promise<void>;
  /** Zooms the window to the interface size, on top of the user's own zoom. */
  setInterfaceScale(scale: number): Promise<void>;
  /** Keys for the View menu's items that Settings changed, as accelerators. */
  setMenuShortcuts(menu: Record<string, string[]>): Promise<void>;
  /** Lets menu keys through to the page while Settings records a shortcut. */
  ignoreMenuShortcuts(ignore: boolean): Promise<void>;
  /**
   * A page of colour-theme extensions on Open VSX from `offset`; an empty
   * query lists popular ones.
   */
  searchThemes(query: string, offset?: number): Promise<ThemeSearchPage>;
  /** The colour themes an Open VSX extension contributes. */
  fetchThemes(extension: ExtensionRef): Promise<VsCodeTheme[]>;
  /** Threads needing attention, shown on the app icon; 0 clears it. */
  setBadge(count: number): Promise<void>;
  /** The Windows caption buttons, which the renderer draws itself. */
  windowControl(action: "minimize" | "toggleMaximize" | "close"): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  parseUrl(url: string): Promise<PullRef>;
  onOpenUrl(callback: (url: string) => void): () => void;
}
/** Request/response methods; the `on…` members subscribe to main-process events. */
/** What the page asks the main process for; the rest the preload answers itself. */
export type ApiMethod = Exclude<keyof Api, `on${string}` | "pathForFile">;
export const emptyProgress = (): Progress => ({
  read: {},
  drafts: [],
  marks: [],
});
export const revisionOf = (p: Pull) => `${p.merge_base}:${p.head.sha}`;
