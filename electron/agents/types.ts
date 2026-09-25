import type {
  RuntimeMode,
  InteractionMode,
  AskAgentRequest,
} from "../../shared/agent-modes";
import type {
  AgentActivity,
  ContextUsage,
  ForkPoint,
} from "../../shared/projects";
import type { CodexReviewTarget } from "../../shared/deep-review";
import type { ProviderCommand } from "../../shared/commands";
import type { AgentDefaults, AgentModel } from "../../shared/agents";
import type { ModelChoice } from "../../shared/settings";

/** One turn of any agent, as a thread, room, title or helper job runs it. */
export interface AgentOptions {
  /** `id` names the chat message the steer came from, for `onSteered`. */
  onControl?: (control: {
    steer: (text: string, id?: string) => Promise<void>;
  }) => void;
  /** The agent read steering message `id`; what follows answers it. */
  onSteered?: (id: string) => void;
  cwd: string;
  prompt: string;
  choice: ModelChoice;
  /** Claude on a 200k window; left out, the CLI picks. Other agents ignore it. */
  contextWindow?: "200k";
  signal: AbortSignal;
  onText: (text: string) => void;
  onCommentary?: (id: string, text: string | null) => void;
  onActivity?: (activity: AgentActivity) => void;
  /** Paths the agent's own file tools are writing, as it reported them. */
  onEdit?: (paths: string[]) => void;
  onTitle?: (title: string) => void;
  onPlan?: (text: string) => void;
  onContext?: (usage: ContextUsage) => void;
  /** Private context for this turn: the agent reads it, the transcript never shows it. */
  context?: () => Promise<string | undefined>;
  /** Compact the resumed session instead of sending `prompt`. */
  compact?: boolean;
  /** Show the turn Claude just started on its own instead of sending `prompt`. */
  adopt?: boolean;
  images?: {
    path: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  }[];
  skills?: { name: string; path: string }[];
  purpose?: "answer" | "title";
  runtimeMode?: RuntimeMode;
  interactionMode?: InteractionMode;
  /** A deep review's reviewer: it may read and run anything but changes no files. */
  readOnly?: boolean;
  /** A `/btw` side thread, forked from the main one while that may still be working. */
  side?: boolean;
  /** Run Codex's own `/review` of this target instead of sending `prompt`. */
  review?: CodexReviewTarget;
  onRequest?: AskAgentRequest;
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

/** What Relay needs from an agent; see `electron/agents/index.ts` for the registry. */
export interface AgentRuntime {
  /** Runs a turn and resolves with its final answer. */
  run(options: AgentOptions): Promise<string>;
  /** Lets go of the live session kept under `key`, if any. */
  closeSession(key: string): Promise<void>;
  /** The models the signed-in agent offers. */
  models(): Promise<AgentModel[]>;
  /** What threads in `root` run where the model or effort is left on Default. */
  defaults(root: string): Promise<AgentDefaults | null>;
  /** Its own slash commands and skills in `root`, for the composer's menu. */
  commands(root: string): Promise<ProviderCommand[]>;
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
    question: string;
    history: { question: string; response: string }[];
    signal: AbortSignal;
  }): Promise<string>;
  /** Relay is quitting. */
  dispose?(): Promise<void>;
}
