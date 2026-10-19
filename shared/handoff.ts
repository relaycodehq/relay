/**
 * Handing a thread off to another computer that runs Relay: a Mac mini at
 * home, a server. The two pair over the phone bridge (shared/remote), this
 * computer as the client. The thread's worktree branch goes across as a git
 * bundle, the conversation as JSON, both in chunks over the encrypted link;
 * the other computer continues in a fresh agent session, briefed by the
 * outgoing agent's handoff note. Bringing it back is the same the other way.
 */
import { z } from "zod";
import { agentProviderSchema, type AgentProvider } from "./agents";
import type { UpdateState } from "./updates";
import type { ApiMethod } from "./types";
import type {
  AgentActivity,
  ChatMessage,
  ChatScope,
  ChatSummary,
  ProjectChat,
  ProjectChatSend,
} from "./projects";

export const worktreeFirst =
  "Only a thread in its own worktree can move to another computer.";

/** Why this thread can't move to another computer, if it can't. */
export function handoffBlocked(chat: ChatSummary) {
  if (chat.scope.kind === "review")
    return "A deep review stays on this computer.";
  if (chat.cameFrom?.abandonedAt)
    return `${chat.cameFrom.computer} took this thread back; it can't move on from here.`;
  if (chat.cameFrom)
    return `This thread came from ${chat.cameFrom.computer}; bring it back there.`;
  if (!chat.worktree) return worktreeFirst;
  if (chat.empty) return "Send a first message, then hand it off.";
}

/** On the computer that handed the thread off: where it is now. */
export interface ChatSentTo {
  /** The handoff's id; the other computer knows the thread by it. */
  id: string;
  computerId: string;
  computer: string;
  at: number;
  /**
   * sending: stopping, the note, the commit and the transfer are under way.
   * away: the other computer has it. returning: coming back.
   */
  state: "sending" | "away" | "returning";
  /** Why the last step failed; the thread stays where the state says. */
  error?: string;
  /** Coming back, its work clashed with commits made here meanwhile, in these files. */
  conflicts?: string[];
  /**
   * The thread carries on from here while it runs there: what is written
   * there mirrors into it, and sends, stops and answers go across. Set when
   * the other computer speaks `liveHandoffBridge`; with an older one the
   * thread stays still here until it comes back.
   */
  live?: true;
  /** Live: the messages it left with; every one after mirrors the other computer's. */
  kept?: number;
  /**
   * Started there (`HandoffThread.start`): its first message, sent here and
   * answered only there, comes back as that computer's, so `kept` is 0.
   * Taken back without it, the thread keeps that message.
   */
  start?: true;
  /**
   * Live, and its folder's calls run there too (`folderHandoffBridge`): its
   * changes, files, history and Git actions are what's on that computer.
   */
  folder?: true;
  /**
   * Sending, its project isn't on that computer yet, and an agent there is
   * setting it up: that agent's thread there, by the id it follows with.
   * Sends, stops and answers go to it until the project is there and the
   * handoff goes on. See `ThreadSetup`.
   */
  setup?: string;
  /**
   * Its project lives on that computer (`Project.computer`): the thread was
   * started there, in the project's folder, and never comes back here.
   */
  home?: true;
}

/**
 * How the computer a thread went to was readied for it: Relay's clone of
 * its project there and, when that failed, the agent that set it up. Kept
 * beside the thread's messages, which a live handoff mirrors, and shown
 * after the first `after` of them.
 */
export interface ThreadSetup {
  computer: string;
  after: number;
  at: number;
  state: "cloning" | "agent" | "done" | "dropped";
  ended?: number;
  /** What git said when Relay's own clone failed, so the agent took over. */
  error?: string;
  /** The project's name, as it's called there once it's there, and its folder there. */
  project: string;
  folder?: string;
  /** The agent's thread there, as it mirrors here; the first is Relay's request. */
  messages: ChatMessage[];
}

/** Waiting on an agent setting its project up on the computer it's going to; it talks to that agent meanwhile. */
export const inSetup = (chat: Pick<ChatSummary, "sentTo">) =>
  !!chat.sentTo?.setup &&
  chat.sentTo.state === "sending" &&
  !chat.sentTo.error;

/**
 * What runs and waits in a live handoff's thread on the other computer, laid
 * over the thread as saved here.
 */
export type HandoffLive = Pick<
  ChatSummary,
  | "runningAgents"
  | "blocked"
  | "asking"
  | "pending"
  | "stopped"
  | "limitResume"
  | "goal"
> &
  Pick<ProjectChat, "requests" | "queue" | "scheduled"> & {
    running?: true;
    /** How long the running turn has run; the sender turns it into `runningSince`. */
    runningFor?: number;
    waiting?: true;
    queuePaused?: true;
  };

/** A live handoff's thread as written on the other computer since it arrived. */
/** The thread runs on the computer it was handed to and is followed live from here. */
export const liveAway = (chat: Pick<ChatSummary, "sentTo">) =>
  !!chat.sentTo?.live && chat.sentTo.state === "away";

export interface HandoffChat {
  /** Those the caller holds at the same version come as their ids. */
  messages: (ChatMessage | string)[];
  live: HandoffLive;
}

/**
 * Calls on a thread, its id first, that a live handoff runs on the computer
 * the thread is on. The rest (reading it, triage, notes, its name) stay here.
 */
export const handoffChatMethods = [
  "sendProjectChat",
  "resumeProjectChat",
  "compactProjectChat",
  "reloadProjectChatSession",
  "rerunWorktreeSetup",
  "projectChatQueueAction",
  "respondProjectChat",
  "answerProjectChatQuestion",
  "setProjectChatQuestionDismissed",
  "cancelProjectChat",
  "resolveStoppedWork",
  "setLimitResume",
  "stopProjectChatPending",
  "projectChatAgents",
  "projectChatContext",
  "projectChatAgent",
  "stopProjectChatAgent",
  "projectChatImage",
  "projectChatQueuedImages",
  "projectChatReadImage",
  "closeWatchNote",
] as const satisfies readonly ApiMethod[];
export type HandoffChatMethod = (typeof handoffChatMethods)[number];

/**
 * Calls on the folder a live handoff's thread works in, its workspace id
 * first: its changes, files, history and Git actions. They run on the
 * computer the thread is on from `folderHandoffBridge`, against the worktree
 * there; with an older one they stay here.
 */
export const handoffFolderMethods = [
  "projectWorkingTree",
  "projectWorkingDiff",
  "projectIgnoredDiff",
  "projectDismissIgnored",
  "projectGitAction",
  "projectCommitMessage",
  "projectPlanCommitSplit",
  "projectApplyCommitSplit",
  "projectBranchPulls",
  "projectMergePlan",
  "projectMergeBranch",
  "projectDeleteBranch",
  "projectCatchUp",
  "projectPreparePull",
  "projectCreatePull",
  "projectHistory",
  "projectCommit",
  "projectCommitDiff",
  "projectFiles",
  "projectFileInfo",
  "projectDirectory",
  "projectThumbnail",
  "projectImage",
  "projectFile",
  "saveProjectFile",
  "createProjectEntry",
  "renameProjectEntry",
  "trashProjectEntry",
  "localBlame",
  "inspectLocalSymbol",
] as const satisfies readonly ApiMethod[];
/**
 * Calls about a project that lives on another computer (`Project.computer`),
 * its id first, that run on that computer (`projectCall`): its checkout's
 * folder calls, and its branches, commands, agents' defaults and icon.
 */
export const remoteProjectMethods = [
  ...handoffFolderMethods,
  "projectBranches",
  "projectBranchCounts",
  "projectChangeBranch",
  "projectCommands",
  "agentDefaults",
  "projectIcon",
] as const satisfies readonly ApiMethod[];
export type RemoteProjectMethod = (typeof remoteProjectMethods)[number];
/**
 * Calls on a live handoff's worktree, the thread's id first, that run there
 * from `folderHandoffBridge` too; so do the files its agents changed in
 * other repositories, which are on that computer's disk.
 */
export const handoffWorktreeMethods = [
  "projectWorktree",
  "projectWorktreeDiff",
  "threadElsewhere",
  "threadElsewhereDiff",
  "threadElsewhereCommit",
] as const satisfies readonly ApiMethod[];
/**
 * Calls that open or point at a thread's files on this computer's disk. For a
 * live handoff's thread they'd open the copy it left behind, so they're
 * refused; its folder argument or id comes first, as above.
 */
export const handoffHereOnlyMethods = [
  "projectAbsolutePath",
  "revealProjectPath",
  "openProjectPath",
  "revealProjectWorktree",
] as const satisfies readonly ApiMethod[];
export type HandoffHereOnlyMethod = (typeof handoffHereOnlyMethods)[number];
export type HandoffMethod =
  | HandoffChatMethod
  | (typeof handoffFolderMethods)[number]
  | (typeof handoffWorktreeMethods)[number];
/** Every call a live handoff runs on the other computer. */
export const handoffMethods = [
  ...handoffChatMethods,
  ...handoffFolderMethods,
  ...handoffWorktreeMethods,
] as const satisfies readonly HandoffMethod[];

/** A handoff the user took back without the other computer's say; it can't return anymore. */
export interface ChatAbandonedHandoff {
  id: string;
  computer: string;
  at: number;
  /** It carried on here after this message, without the code changed there since `since`. */
  ranHere?: { after: string; since: number };
}

/** On the computer that took a thread over: where it came from. */
export interface ChatCameFrom {
  id: string;
  computer: string;
  /** The paired device that sent it; only it may take it back. */
  deviceId: string;
  at: number;
  /** Messages that came with it; everything after was written here. */
  carried: number;
  /** The commit it arrived at, which a hand-back bundles from. */
  tip: string;
  /** Handed back: it lives on the other computer again, and stays still here. */
  returnedAt?: number;
  /** The note written for the last hand-back, while nothing came after it. */
  backNote?: string;
  /** The computer it came from took the thread back without this one; its work here stays here. */
  abandonedAt?: number;
  /**
   * Started here, in a project the other computer shows as its own
   * (`ChatSentTo.home`): it works in this project's folder and never goes back.
   */
  home?: true;
}

/**
 * The next main-conversation turn's briefing after a handoff, used once.
 * `fresh`: the agent has no session here, so it hears the user's own
 * messages instead of the usual recent history.
 */
export interface ChatHandover {
  computer: string;
  fresh: boolean;
  note?: { provider: AgentProvider; body: string };
  /** The prompt that starts the thread here, by id; it's marked `handedOver`. */
  kickoff?: string;
  /** It carries on here without what `computer` changed in the code. */
  left?: true;
  /** Its note already went on with the thread to another computer; a retry doesn't pass it again. */
  passedOn?: true;
}

/** A send that waits for the computer a live thread is on; `error` when it turned it down. */
export interface HeldSend {
  input: ProjectChatSend;
  at: number;
  error?: string;
}

/** The settings the next turn goes out with, as the last one did. */
export type HandoffSettings = Pick<
  ProjectChatSend,
  "provider" | "choice" | "runtimeMode" | "interactionMode" | "contextWindow"
>;

/**
 * One message as it crosses between computers, in either direction. The
 * paired computer is trusted like a paired phone, which runs agents with
 * full access; this only keeps a peer on another version, or a broken one,
 * from writing messages into the thread that nothing can read. Fields only
 * one side knows pass through untouched.
 */
export const handoffMessageSchema = z
  .object({
    id: z.string().max(200),
    role: z.enum(["user", "assistant"]),
    body: z.string().max(2_000_000),
    status: z.enum(["complete", "failed", "streaming", "cancelled"]),
    created: z.number(),
    version: z.number(),
    provider: agentProviderSchema.optional(),
    parentId: z.string().max(200).nullish(),
  })
  .loose();
export const handoffMessagesSchema = z.array(handoffMessageSchema).max(20_000);

/** The conversation half of a handoff; the code travels as a bundle beside it. */
export interface HandoffThread {
  /** The computer handing it off, as its name. */
  from: string;
  /** `owner/name` of the project's Git remotes; how the other side finds its clone. */
  repositories: string[];
  title: string;
  scope: ChatScope;
  settings: HandoffSettings;
  messages: ChatMessage[];
  git: HandoffGit;
  /**
   * Nothing answered it here yet: its first message runs there as the
   * thread's first turn, in its own words, instead of being handed over
   * with a note. From `startHandoffBridge`.
   */
  start?: true;
}

interface HandoffGit {
  /** The branch as it's named on the sending side, `refs/heads/…` in the bundle. */
  branch: string;
  /** The commit the work stands at, handoff commit included. */
  tip: string;
  /** Whether a bundle comes along; without one the tip is already on the Git remote. */
  bundle: boolean;
  /** The branch the worktree came from, and where its own work starts. */
  from?: string;
  start?: string;
}

/**
 * A thread ready to come back. What was written there (a `ChatMessage[]`
 * as JSON) and the bundle are downloaded in parts; sizes in bytes, a 0
 * bundle when the tip didn't move.
 */
export interface HandBack {
  tip: string;
  branch: string;
  thread: number;
  bundle: number;
}

/** The other computer's view of a handed-off thread. */
export interface HandoffRemoteStatus {
  title: string;
  running: boolean;
  waiting: boolean;
  asking?: true;
  blocked?: true;
  settled: boolean;
  updated: number;
  /** The start of the latest answer written there, for the strip. */
  latest?: string;
  /** The latest turn there ended in this error. */
  failed?: string;
  returned: boolean;
  /**
   * What the peek shows; a Relay from before them leaves them out. The
   * latest turn's own calls, not its subagents', the last few of them.
   */
  recent?: AgentActivity[];
  /** How many calls the latest turn made. */
  calls?: number;
  /** The latest thing its agent said between calls. */
  says?: string;
  provider?: AgentProvider;
  model?: string;
  /** What its agent asks while it waits. */
  question?: string;
  /** How long the running turn has run; the sender turns it into `runningSince`. */
  runningFor?: number;
  /** When the running turn started, on this computer's clock. */
  runningSince?: number;
}
/** Calls a status carries; the peek shows as many. */
export const remoteRecentCalls = 6;

/** Say this and send the whole history: the other side lacks the base commits. */
export const needsFullBundle = "HANDOFF_NEEDS_FULL_BUNDLE";
/** Raw bytes per upload or download call; base64 and sealing keep a frame well under 8 MB. */
export const handoffChunk = 1536 * 1024;
export const maxHandoffBundle = 1024 * 1024 * 1024;
export const maxHandoffThread = 64 * 1024 * 1024;

/** A computer this one hands work to. */
/**
 * How a computer is reached that isn't over the network: a pipe its own
 * command opens, `ssh <host>` with this computer's SSH setup or wsl.exe
 * into a WSL distribution, running `relay pipe` there.
 */
/** A `Host` in an SSH config, with where it goes when the config says. */
export interface SshHost {
  host: string;
  hostName?: string;
  user?: string;
}
export type ComputerRoute =
  { kind: "ssh"; host: string } | { kind: "wsl"; distro: string };
export const computerRouteSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ssh"),
    // A host or `user@host`, or an alias from ~/.ssh/config; never an option.
    host: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.@:[\]%-]{1,255}$/, "That isn't an SSH host.")
      .refine((host) => !host.startsWith("-"), "That isn't an SSH host."),
  }),
  z.object({
    kind: z.literal("wsl"),
    distro: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/, "That isn't a WSL distribution."),
  }),
]);

export interface PairedComputer {
  id: string;
  name: string;
  status: "connecting" | "online" | "offline" | "denied";
  detail?: string;
  /** Where it's reached on the tailnet. */
  address?: string;
  /** Reached through a pipe instead of the network. */
  route?: ComputerRoute;
  /** A WSL distribution nothing needed yet: it wakes on first use. */
  asleep?: true;
  /** A WSL distribution WSL stopped (`wsl --shutdown`): offline until `wakeComputer`. */
  stopped?: true;
  /** Its Relay, as it last said; unknown while it's offline. */
  version?: string;
  /** Its bridge is older than this computer's: threads can't go there until it updates. */
  outdated?: boolean;
  update?: UpdateState;
}

/** What a computer taking threads says about itself. */
export interface ComputerInfo {
  version: string;
  bridge: number;
  update: UpdateState;
}

/** Where a thread that left this computer stands, as Settings lists it. */
export type AwayState =
  | "sending"
  | "working"
  | "waiting"
  | "finished"
  | "stopped"
  | "returning"
  | "failed"
  | "unknown";
export interface AwayThread {
  chatId: string;
  projectId: string;
  project: string;
  title: string;
  state: AwayState;
  /** When it left, or when it finished. */
  since: number;
  error?: string;
  /** Failed on its way there or back, without clashing files: the step to try again. */
  retry?: "send" | "return";
}
/** Settings → Computers: this computer, and each paired one with its threads there. */
export interface ComputersOverview {
  name: string;
  computers: (PairedComputer & { threads: AwayThread[] })[];
}

/** One computer in the thread's hand-off menu. */
export interface HandoffTarget {
  id: string;
  name: string;
  online: boolean;
  /** Its project with the same repository, when it has one. */
  project?: { id: string; name: string };
  /** Why it can't take the thread; shown in place of the project. */
  problem?: string;
  /** It lacks the repository but can clone it as the thread goes: the repository's owner/name. */
  clone?: string;
}

/** The thread's handoff as its strip shows it. */
export interface HandoffView {
  sentTo: ChatSentTo;
  online: boolean;
  remote?: HandoffRemoteStatus;
  /** Its project's clone on that computer, under way. */
  cloning?: { step: string; progress: number | null };
}

export interface ComputersApi {
  pairedComputers(): Promise<PairedComputer[]>;
  computersOverview(): Promise<ComputersOverview>;
  /** Pairs with the link another computer shows under Settings → Computers. */
  pairComputer(link: string): Promise<PairedComputer[]>;
  /** Pairs with the Relay a route reaches, over SSH or into WSL. */
  connectComputer(route: ComputerRoute): Promise<PairedComputer[]>;
  /** The WSL distributions on this computer; none off Windows. */
  wslDistros(): Promise<string[]>;
  /** The hosts this computer's ~/.ssh/config names, to suggest for Over SSH. */
  sshHosts(): Promise<SshHost[]>;
  /** Starts a WSL distribution WSL stopped again, and connects to it. */
  wakeComputer(id: string): Promise<PairedComputer[]>;
  forgetComputer(id: string): Promise<PairedComputer[]>;
  handoffTargets(chatId: string): Promise<HandoffTarget[]>;
  /** The folders in `dir` on a paired computer, `~` its home folder. */
  computerFolders(
    computerId: string,
    dir: string,
  ): Promise<import("./remote").ComputerFolders>;
  /** Adds a folder on a paired computer as a project that lives there. */
  addRemoteProject(
    computerId: string,
    path: string,
  ): Promise<import("./projects").Project>;
  /** The paired computers a new thread in the project can start on, or why each can't. */
  startTargets(projectId: string): Promise<HandoffTarget[]>;
  /**
   * Starts a new thread on another computer: its first message is kept
   * here unanswered and the thread goes there, where it's answered.
   */
  startProjectChatOn(
    chatId: string,
    input: ProjectChatSend,
    computerId: string,
  ): Promise<void>;
  /**
   * For a thread whose project an agent is setting up on the computer it's
   * going to: the folder there that holds a clone, added there as its
   * project when it does. False when it doesn't hold the repository.
   */
  setupFolder(chatId: string, folder: string): Promise<boolean>;
  /** Gives up on the setup a thread waits for there; it stays, and starts, here. */
  startThreadHere(chatId: string): Promise<void>;
  /** Starts the handoff; the thread's `sentTo` follows it from there. */
  handOffThread(chatId: string, computerId: string): Promise<void>;
  /** Sends a handoff that failed on its way again. */
  retryHandoff(chatId: string): Promise<void>;
  handoffView(chatId: string): Promise<HandoffView | null>;
  /** Every thread that's on another computer, or on its way, by chat id. */
  handoffViews(): Promise<Record<string, HandoffView>>;
  /** `park` brings it back even if its work clashes, left at its handoff ref. */
  bringBackThread(chatId: string, park?: boolean): Promise<void>;
  /** Keeps a thread whose handoff failed here; refused unless the other side says it never got it. */
  keepThreadHere(chatId: string): Promise<void>;
  /**
   * Unlocks a thread that's away, as it was when it left, without the other
   * computer. What was done there stays there; it is told when it can be.
   */
  abandonHandoff(chatId: string): Promise<void>;
  /**
   * Carries on a live thread here while its computer is offline: the
   * conversation stays, the code is as it left, and what waited goes out
   * here. That computer is told when it can be. What fails to go out, and
   * all after it, waits again; called once the thread is here, it sends those.
   */
  runThreadHere(chatId: string): Promise<void>;
  /** Drops a send that waits for the computer a live thread is on. */
  dropHeldSend(chatId: string, sendId: string): Promise<void>;
  /** Has a paired computer update Relay and restart; it reconnects by itself. */
  updateComputer(id: string): Promise<UpdateState>;
}
