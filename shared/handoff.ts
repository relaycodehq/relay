/**
 * Handing a thread off to another computer that runs Relay: a Mac mini at
 * home, a server. The two pair over the phone bridge (shared/remote), this
 * computer as the client. The thread's worktree branch goes across as a git
 * bundle, the conversation as JSON, both in chunks over the encrypted link;
 * the other computer continues in a fresh agent session, briefed by the
 * outgoing agent's handoff note. Bringing it back is the same the other way.
 */
import type { AgentProvider } from "./agents";
import type { UpdateState } from "./updates";
import type {
  AgentActivity,
  ChatMessage,
  ChatScope,
  ProjectChatSend,
} from "./projects";

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
}

/** The settings the next turn goes out with, as the last one did. */
type HandoffSettings = Pick<
  ProjectChatSend,
  "provider" | "choice" | "runtimeMode" | "interactionMode" | "contextWindow"
>;

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
export interface PairedComputer {
  id: string;
  name: string;
  status: "connecting" | "online" | "offline" | "denied";
  detail?: string;
  /** Where it's reached on the tailnet. */
  address?: string;
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
}

/** The thread's handoff as its strip shows it. */
export interface HandoffView {
  sentTo: ChatSentTo;
  online: boolean;
  remote?: HandoffRemoteStatus;
}

export interface ComputersApi {
  pairedComputers(): Promise<PairedComputer[]>;
  computersOverview(): Promise<ComputersOverview>;
  /** Pairs with the link another computer shows under Settings → Computers. */
  pairComputer(link: string): Promise<PairedComputer[]>;
  forgetComputer(id: string): Promise<PairedComputer[]>;
  handoffTargets(chatId: string): Promise<HandoffTarget[]>;
  /** Starts the handoff; the thread's `sentTo` follows it from there. */
  handOffThread(chatId: string, computerId: string): Promise<void>;
  /** Sends a handoff that failed on its way again. */
  retryHandoff(chatId: string): Promise<void>;
  handoffView(chatId: string): Promise<HandoffView | null>;
  /** Every thread that's on another computer, or on its way, by chat id. */
  handoffViews(): Promise<Record<string, HandoffView>>;
  /** `park` brings it back even if its work clashes, left at its handoff ref. */
  bringBackThread(chatId: string, park?: boolean): Promise<void>;
  /** Keeps a thread whose handoff failed here; refused once the other side has it. */
  keepThreadHere(chatId: string): Promise<void>;
  /** Has a paired computer update Relay and restart; it reconnects by itself. */
  updateComputer(id: string): Promise<UpdateState>;
}
