import type { AgentProvider } from "../../../shared/agents";
import type { AccountProvider } from "../../../shared/agent-accounts";
import type { SentComposerSettings } from "../../../shared/projects";
import type { useComposerSend } from "./useComposerSend";
import type { NextGuess } from "./useNextGuess";

/** What the strips above the input may send through the composer. */
export interface ComposerNoticeActions {
  sendGoal: ReturnType<typeof useComposerSend>["sendGoal"];
}

/** What the conversation the composer writes to is doing, and allows. */
export interface ComposerConversation {
  /** An answer is coming; a message now queues, or steers it. */
  running: boolean;
  /** Nothing can go out now. */
  busy: boolean;
  /** The agent holding its context; the composer runs it until one is picked here. */
  agent?: AgentProvider;
  /** This conversation's own latest sent settings, once its history loads. */
  lastSent?: SentComposerSettings;
  /** The agent whose last answer proposed a plan, offered to build it. */
  planner?: AgentProvider;
  /** The thread, once it exists, and the accounts it keeps; see shared/agent-accounts. */
  chatId?: string;
  /**
   * Compacting first, offered when a message to this agent would find a big
   * conversation's prompt cache cold: Send does as Settings say, and the box
   * beside it flips that.
   */
  compactOffer?: { provider: AgentProvider; tokens: number };
  accounts?: Partial<Record<AccountProvider, string>>;
  /** The message the agent guessed comes next, offered while the draft is empty. */
  prediction?: NextGuess;
}
