import type { PredictionAsked } from "../../shared/prediction";
import type { WatchNote, WatchScope, WatchSpend } from "../../shared/watch";
import type {
  RuntimeMode,
  InteractionMode,
  AskAgentRequest,
  AgentQuestion,
} from "../../shared/agent-modes";
import type {
  AgentActivity,
  ContextUsage,
  ForkPoint,
  LinkedFolder,
  SessionReload,
} from "../../shared/projects";
import type { CodexReviewTarget } from "../../shared/deep-review";
import type { GoalCommand, ThreadGoal } from "../../shared/goal";
import type { ProviderCommand } from "../../shared/commands";
import type { AgentDefaults, AgentModel } from "../../shared/agents";
import type { ModelChoice } from "../../shared/settings";
import type { Streamed, UsageJob, UsageTokens } from "../../shared/usage";
import type { RenderMode } from "../../shared/html-render";
import type { SubagentDetail, SubagentRun } from "../../shared/subagents";
import type { ContextReport } from "../../shared/context-report";

/** What one request of a run used, as the agent reported it. */
export type UsageReport = {
  model: string;
  tokens: UsageTokens;
  /** The agent's own price; left out, Relay prices it at list rates. */
  usd?: number;
  /** Served in fast mode, which bills at a multiple of the list rates. */
  fast?: boolean;
  /** The output it showed, thinking left out, and how long writing it took; left out when it can't be timed. */
  streamed?: Streamed;
  /** A subagent's request, not the agent's own. */
  subagent?: boolean;
};

/** What the run is for; each runtime handles every kind. */
export type AgentJob =
  /** A turn in a thread's session: send `prompt`. */
  | { kind: "prompt" }
  /** Compact the resumed session instead of sending `prompt`. */
  | { kind: "compact" }
  /** Show the turn the agent started on its own instead of sending `prompt`. */
  | { kind: "adopt" }
  /** Run Codex's own `/review` of this target instead of sending `prompt`. */
  | { kind: "review"; target: CodexReviewTarget }
  /** Codex's own `/goal`, through its goal API: set, resume, pause, clear or show. */
  | { kind: "goal"; command: GoalCommand }
  /** A `/btw` side thread, forked from the main one while that may still be working. */
  | { kind: "side" }
  /** A one-off helper job (a thread title, a commit message): no tools, no session, these instructions in place of the chat's own. */
  | { kind: "helper"; instructions: string };

/** A thread turn's side check; see shared/watch. Claude, Codex and OpenCode read it, the others ignore it. */
export type AgentWatch = {
  scope: Exclude<WatchScope, "off">;
  /** Notes the person said they know, in any thread: skipped only when a note says the same. */
  known: string[];
  /** The thread's earlier notes, closed or not, so a restart doesn't forget them. */
  shown?: string[];
  /** Notes this thread's person closed with "I know this": their whole topic is skipped. */
  topics?: string[];
  onNote: (note: WatchNote) => void;
  /** What a check spent, or what the watched session did in a turn. */
  onSpend?: (spend: WatchSpend) => void;
};

/** Guessing the person's next message once a turn's answer is in; see ./predict. */
export type AgentPredict = {
  /** What the person asked this turn, in their own words. */
  request: string;
  onPrediction: (text: string) => void;
  /** Asked once the turn has earned a guess: false skips it after all. */
  allows?: () => boolean | Promise<boolean>;
  /** A guess was asked for, whether or not it came back as one. */
  onAsked?: (asked: PredictionAsked) => void;
};

/** One turn of any agent, as a thread, title or helper job runs it. */
export interface AgentOptions {
  job: AgentJob;
  /** `id` names the chat message the steer came from, for `onSteered`. */
  onControl?: (control: {
    steer: (
      text: string,
      id?: string,
      images?: AgentOptions["images"],
      /** The user's own words within `text`, as `request` is within `prompt`. */
      request?: string,
    ) => Promise<void>;
    /** Pauses or clears the goal the running turn pursues, without stopping the turn. */
    goal?: (command: "pause" | "clear") => Promise<void>;
    /**
     * Moves the running turn to another effort, for an agent that can take
     * one mid-turn; the others take it from their next turn. Whether the
     * running turn took it.
     */
    retune?: (choice: ModelChoice) => Promise<boolean>;
  }) => void;
  /** The agent read steering message `id`; what follows answers it. */
  onSteered?: (id: string) => void;
  /**
   * The agent took steering message `id`, but its turn ended before reading
   * it. With `error`, whether it still reaches the agent can't be told.
   */
  onSteerUnread?: (id: string, error?: Error) => void;
  cwd: string;
  /** Folders beyond `cwd` the user linked, and whether the agent may edit them. */
  links?: LinkedFolder[];
  /** Added to the agent process's environment, e.g. a worktree's RELAY_PORT_OFFSET; read when its process starts. */
  env?: Record<string, string>;
  prompt: string;
  /** The user's own words within `prompt`, apart from what Relay adds around them. */
  request?: string;
  choice: ModelChoice;
  /** The Claude Code or Codex account to run on; left out, the one in use. */
  account?: string;
  /** Claude on a 200k window; left out, the CLI picks. Other agents ignore it. */
  contextWindow?: "200k";
  signal: AbortSignal;
  onText: (text: string) => void;
  onCommentary?: (id: string, text: string | null) => void;
  /** Questions sent as messages, without holding up the agent's turn. */
  onQuestions?: (id: string, questions: AgentQuestion[]) => void;
  onActivity?: (activity: AgentActivity) => void;
  /** Paths the agent's own file tools are writing, as it reported them. */
  onEdit?: (paths: string[]) => void;
  onTitle?: (title: string) => void;
  onPlan?: (text: string) => void;
  onContext?: (usage: ContextUsage) => void;
  /** The thread's native `/goal` changed, as the agent reports it; null once it's gone. */
  onGoal?: (goal: ThreadGoal | null) => void;
  /** The goal the thread showed last, for an agent that reports only its changes. */
  goal?: ThreadGoal;
  /** Dollars the turn cost since the last call, as the agent prices it. */
  onCost?: (usd: number) => void;
  /** Each request the run made, subagents' too; see agents/usage-count. */
  onUsage?: (usage: UsageReport) => void;
  /** Where the Usage page counts the run; left out, `job` decides. */
  usage?: { job?: UsageJob; chat?: string; project?: string };
  /** Private context for this turn: the agent reads it, the transcript never shows it. */
  context?: () => Promise<string | undefined>;
  images?: {
    path: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  }[];
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  /** A deep review's reviewer: it may read and run anything but changes no files. */
  readOnly?: boolean;
  /** Relay's tools for starting and driving other threads, reached as this thread; see electron/relay-mcp. */
  relayTools?: {
    url: string;
    token: string;
    /** How readily the agent is told to show pages; "off" serves it no page tools. */
    renders?: RenderMode;
  };
  onRequest?: AskAgentRequest;
  watch?: AgentWatch;
  predict?: AgentPredict;
  session?: {
    key?: string;
    id?: string;
    /** With no `id` yet: start as a copy of this session, cut after the point. */
    fork?: ForkPoint;
    onId: (id: string) => Promise<void>;
    /** Where the session stands after this turn, for a later `fork`. */
    onPoint?: (at: string) => void;
    /** Claude started a turn between prompts; show it by running an `adopt` turn. */
    onUnprompted?: () => Promise<void>;
  };
}

/** The subagents a live session started, running or back. */
export interface SubagentSource {
  list(): SubagentRun[];
  detail(id: string): SubagentDetail | undefined;
  /** Stops one; the agent that started it hears so and carries on. */
  stop(id: string): Promise<void>;
}

/** What Relay needs from an agent; see `electron/agents/index.ts` for the registry. */
export interface AgentRuntime {
  /** Runs a turn and resolves with its final answer. */
  run(options: AgentOptions): Promise<string>;
  /** Lets go of the live session kept under `key`, if any. */
  closeSession(key: string): Promise<void>;
  /**
   * Restarts the live session under `key` on the same conversation at once,
   * saying what it loaded differently. Without this, reloading closes the
   * session and the next turn resumes it.
   */
  reloadSession?(key: string): Promise<SessionReload | undefined>;
  /** The subagents of the session under `key`, for an agent that starts them. */
  subagents?(key: string): SubagentSource | undefined;
  /** Counts or estimates the live session's context against its last reported usage. */
  contextReport?(
    key: string,
    usage: ContextUsage,
  ): Promise<ContextReport | null>;
  /**
   * Signs the agent in from Relay, for one with no login command; resolves
   * once the user is through.
   */
  signIn?(): Promise<void>;
  /** Signs it out from Relay, for one Relay downloads. */
  signOut?(): Promise<void>;
  /** The models the signed-in agent offers. */
  models(): Promise<AgentModel[]>;
  /**
   * Asks the agent for its models afresh, for one that keeps them until it
   * restarts. `beforeRestart` stops the threads running on it first; they
   * resume after.
   */
  reloadModels?(beforeRestart: () => Promise<void>): Promise<void>;
  /** What threads in `root` run where the model or effort is left on Default. */
  defaults(root: string): Promise<AgentDefaults | null>;
  /** Its own slash commands and skills in `root`, for the composer's menu. */
  commands(root: string): Promise<ProviderCommand[]>;
  /**
   * The commands it has already listed in `root`, without starting it; undefined
   * when it hasn't yet. Settings → Agent tools reads this, so opening it never
   * launches an agent or the MCP servers it starts.
   */
  knownCommands?(root: string): Promise<ProviderCommand[] | undefined>;
  /**
   * Answers a `/btw` side question from the main session's context, without
   * tools and without it entering the session. Without this, a side question
   * runs as a read-only fork of the main session.
   */
  askSide?(options: {
    key: string;
    thread: string;
    cwd: string;
    choice: ModelChoice;
    /** The thread's account; left out, the one in use. */
    account?: string;
    question: string;
    history: { question: string; response: string }[];
    signal: AbortSignal;
    /** What answering it cost, when the agent can tell. */
    onUsage?: (usage: UsageReport) => void;
    usage?: { chat?: string; project?: string };
  }): Promise<string>;
  /**
   * Takes back the sessions that kept running while Relay restarted: those
   * `owns` accepts come back, the rest end. `open` ones were mid-turn and
   * wait for an `adopt` turn; `unprompted` shows a turn one starts later.
   */
  reattach?(
    owns: (key: string) => boolean,
    unprompted: (key: string) => () => Promise<void>,
  ): Promise<{ key: string; open: boolean }[]>;
  /** Relay is quitting. */
  dispose?(): Promise<void>;
  /** Relay is restarting: let go, and leave what the agent host runs going. */
  detach?(): void;
}
