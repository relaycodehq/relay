import type {
  AgentProvider,
  ChatMessage,
  ForkPoint,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import type { AgentError } from "../agents/errors";
import type { AnswerRecorder } from "./answer-recorder";
import type { ChatTurn, turnRules } from "./chat-turn";
import type { ChatCore } from "./core";
import type { ThreadTitles } from "./titles";

export interface TurnRunnerHost {
  /** Claude started a turn of its own in the session. */
  unprompted(
    chat: ProjectChat,
    root: string,
    provider: AgentProvider,
    parentId?: string,
  ): Promise<void>;
  /** A usage limit stopped the reply `messageId`. */
  limited(chatId: string, messageId: string, limit: AgentError): void;
  /** What the thread's agent process is told about its worktree. */
  env(chat: ProjectChat): Promise<Record<string, string>>;
  /** Keeps copies of the images a finished answer shows. */
  keepShown(chat: ProjectChat, message: ChatMessage): Promise<void>;
}

export type Fork = { point: ForkPoint; from?: ChatMessage };

/** One turn being run: what its steps share. */
export interface TurnState {
  chat: ProjectChat;
  root: string;
  input: ProjectChatSend;
  turn: ChatTurn;
  rules: ReturnType<typeof turnRules>;
  abort: AbortController;
  answer: AnswerRecorder;
  provider: AgentProvider;
  /** The message whose replies it answers in; unset in the main conversation. */
  replyTo?: string;
  sessionKey: string;
  account?: string;
  fork?: Fork;
  /** It answers the thread's first prompt, which names the thread. */
  first: boolean;
  /** Where the agent's session stood at the end, to fork from later. */
  point?: string;
  limit?: AgentError;
}

/** What a turn's steps reach beyond the turn itself. */
export interface TurnDeps {
  core: ChatCore;
  titles: ThreadTitles;
  host: TurnRunnerHost;
}
