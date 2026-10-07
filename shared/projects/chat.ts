import type { AgentRequest } from "../agent-modes";
import type { AgentProvider } from "../agents";
import type { DeepReviewState } from "../deep-review";
import type { ChatHandover } from "../handoff";
import type { UltraplanState } from "../ultraplan";
import type { ChatMessage } from "./messages";
import type { ProjectChatSend } from "./send";
import type { ChatSummary } from "./threads";

interface QueuedChatMessage {
  input: ProjectChatSend;
  created: number;
  error?: string;
}
/** Sent with Send later; goes out at `at`, or queues if an answer is running. */
export interface ScheduledChatMessage extends QueuedChatMessage {
  at: number;
}
export interface ProjectChat extends ChatSummary {
  requests?: AgentRequest[];
  queue?: QueuedChatMessage[];
  scheduled?: ScheduledChatMessage[];
  queuePaused?: boolean;
  lastInput?: ProjectChatSend;
  messages: ChatMessage[];
  /** Each agent's session on the main conversation. */
  sessions?: AgentSessions;
  /** Local: a forked thread's last copied answer, whose session its agent continues. */
  forkedAt?: string;
  /** Local: checkout rollbacks the next agent turn should hear about. */
  checkoutNotes?: string[];
  /** Local: the scope each agent session last heard, by `provider:branch`. */
  scopeHeard?: Record<string, string>;
  /**
   * Local: moved from the project folder into its worktree; `owed` are the
   * sessions not yet told. `copied` when the worktree got a copy of the
   * folder's edits and the folder kept its own.
   */
  movedIn?: { from: string; to: string; owed: string[]; copied?: true };
  /** Local: how the worktree's setup went, for the next turn's agent, when it failed or recovered. */
  setupNote?: string;
  deepReview?: DeepReviewState;
  /** Ultraplan councils, by the user message each one works on. */
  ultraplans?: Record<string, UltraplanState>;
  /** Each agent's session on a side conversation, by its root message. */
  replySessions?: Record<string, AgentSessions>;
  /** Local: what the next turn hears about a handoff between computers. */
  handover?: ChatHandover;
  /** Local: on a thread that came from another computer, each carried message's id there by its id here. */
  carriedIds?: Record<string, string>;
}
/** An agent's session on a conversation, and the last message it heard there. */
export interface AgentSession {
  thread?: string;
  through?: string;
}
type AgentSessions = Partial<Record<AgentProvider, AgentSession>>;
/**
 * Saves from before the agent registry kept Claude's session and Codex's
 * (`provider…`, or bare on a side conversation) in fields of their own.
 */
export function migrateAgentSessions(chat: ProjectChat): boolean {
  type Legacy = {
    claudeThread?: string;
    claudeThrough?: string;
    providerThread?: string;
    providerThrough?: string;
    thread?: string;
    through?: string;
  };
  let changed = false;
  const move = (
    from: Legacy,
    to: AgentSessions,
    provider: AgentProvider,
    thread: "claudeThread" | "providerThread" | "thread",
    through: "claudeThrough" | "providerThrough" | "through",
  ) => {
    if (!(thread in from) && !(through in from)) return;
    const session: AgentSession = {
      ...(from[thread] ? { thread: from[thread] } : {}),
      ...(from[through] ? { through: from[through] } : {}),
    };
    if (session.thread || session.through) to[provider] ??= session;
    delete from[thread];
    delete from[through];
    changed = true;
  };
  const main = chat as ProjectChat & Legacy;
  const sessions = main.sessions ?? {};
  move(main, sessions, "claude", "claudeThread", "claudeThrough");
  move(main, sessions, "codex", "providerThread", "providerThrough");
  if (Object.keys(sessions).length) main.sessions = sessions;
  for (const [root, side] of Object.entries(chat.replySessions ?? {})) {
    const legacy = side as AgentSessions & Legacy;
    const next: AgentSessions = { ...side };
    delete (next as Legacy).claudeThread;
    delete (next as Legacy).claudeThrough;
    delete (next as Legacy).thread;
    delete (next as Legacy).through;
    move(legacy, next, "claude", "claudeThread", "claudeThrough");
    move(legacy, next, "codex", "thread", "through");
    chat.replySessions![root] = next;
  }
  return changed;
}
